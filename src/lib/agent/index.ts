/**
 * The agent — the backend of the always-available agentic chat (multi-block edits).
 *
 * Server-only. One entry point, `runAgent`, that turns a chat message into a conversational reply
 * plus a batch of PROPOSED per-block edits. It never applies anything: the FE reviews the batch
 * (reusing DiffView per edit) and Keeps/Discards it as one grouped, undo-able transaction.
 *
 * The loop, and where each safety rule lives:
 *   1. PLAN   (plan.ts) — pick the minimal, relevant set of blocks + a per-block instruction.
 *                          → the over-edit guard.
 *   2. EDIT   (edit.ts) — rewrite each planned block through the EXACT same guarded editor as
 *                          /api/edit (runEdit: entity-preserving system prompt + forced tool).
 *                          → identical fidelity guardrail, reused per block, never re-implemented.
 *   3. GATE   (entity-gate.ts) — deterministically verify every protected entity survived; on a
 *                          drop, try one bounded repair, then flag anything still broken.
 *                          → the deterministic backstop, on every proposed edit.
 * No-op edits (the instruction didn't apply to that block) are dropped so the review stays clean.
 *
 * SPEND/ABUSE GUARD (limits.ts): /api/chat is public + unauthenticated, so a single request draws
 * every model call — the planner, each block edit, each repair — against ONE hard `maxModelCalls`
 * budget. Edits are spent BEFORE repairs (coverage beats polish; a still-dropped entity ships
 * flagged either way), and once the budget is exhausted we stop calling and say so in the reply.
 */
import type { Block } from '@/lib/types';
import type { DocumentContext } from '@/lib/contracts';
import { runEdit } from '@/lib/edit';
import { isNoChange } from '@/lib/text/diff';
import type { ChatRequest, ChatResponse, ProposedEdit } from './contract';
import { runPlan, type PlannedEdit } from './plan';
import { checkEntityFidelity } from './entity-gate';
import { checkFactEntityGate } from '@/lib/voice-gate';
import { LIMITS, makeCallBudget } from './limits';

/** Edit at most this many blocks concurrently — gentle on the proxy + bounds burst spend. */
const EDIT_CONCURRENCY = 4;
/** Re-try a block once when the guarded edit drops a protected entity, before flagging it. */
const REPAIR_ON_ENTITY_DROP = true;

const warn = (entity: string) => `“${entity}” was changed — normally kept exactly.`;

/** Run async `worker` over `items` with a fixed concurrency cap, preserving input order. */
async function mapPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) {
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

/** A first-pass edit plus what it dropped — carried into the (budget-permitting) repair phase. */
interface EditDraft {
  proposed: ProposedEdit;
  dropped: string[];
  block: Block;
  instruction: string;
  authoritativeInstruction: string;
  extraNames: readonly string[];
  docContext: DocumentContext;
}

/** Phase 1: one guarded edit call (no retry). Returns null for a no-op or a hard failure. */
async function draftEdit(
  block: Block,
  instruction: string,
  authoritativeInstruction: string,
  extraNames: readonly string[],
  docContext: DocumentContext,
): Promise<EditDraft | null> {
  const req = {
    block: { id: block.id, text: block.text, type: block.type },
    instruction,
    docContext,
  };

  let after: string;
  let changeSummary: string | undefined;
  try {
    // The planner's per-block instruction is not factual authority. Only the human's message may
    // authorize a new/changed entity; selected KB facts travel separately through kbContext.
    const res = await runEdit(req, { authoritativeInstruction });
    after = res.newText;
    changeSummary = res.changeSummary;
  } catch {
    return null; // one block failing must not sink the whole batch
  }
  if (isNoChange(block.text, after)) return null;

  const { kept } = checkEntityFidelity(block.text, after, extraNames);
  // `runEdit` has already enforced this same hard gate. Re-evaluate only to keep the existing
  // warning/repair shape honest for any future non-throwing caller: explicitly authorized entity
  // changes are not mislabeled as accidental drops.
  const postGate = checkFactEntityGate({
    before: block.text,
    after,
    authoritativeInstruction,
    extraNames,
  });
  const dropped = postGate.violations
    .filter((violation) => violation.kind.startsWith('dropped'))
    .map((violation) => violation.value);
  const proposed: ProposedEdit = {
    blockId: block.id,
    before: block.text,
    after,
    instruction,
    changeSummary,
    protectedKept: kept,
    warnings: dropped.length ? dropped.map(warn) : undefined,
  };
  return {
    proposed,
    dropped,
    block,
    instruction,
    authoritativeInstruction,
    extraNames,
    docContext,
  };
}

/**
 * Phase 2: retry a draft that dropped a protected entity, forbidding the change. Accept the repair
 * only if it doesn't lose ground; otherwise keep the first-pass edit + its warning. Mutates `d`.
 */
async function repairEdit(d: EditDraft): Promise<void> {
  const req = {
    block: { id: d.block.id, text: d.block.text, type: d.block.type },
    instruction: `${d.instruction}\n\nCRITICAL: keep these EXACTLY as written, unchanged and character-for-character: ${d.dropped.join(
      '; ',
    )}.`,
    docContext: d.docContext,
  };
  try {
    const repaired = await runEdit(req, {
      authoritativeInstruction: d.authoritativeInstruction,
    });
    if (isNoChange(d.block.text, repaired.newText)) return;
    const recheck = checkEntityFidelity(d.block.text, repaired.newText, d.extraNames);
    if (recheck.dropped.length <= d.dropped.length) {
      d.proposed.after = repaired.newText;
      d.proposed.changeSummary = repaired.changeSummary ?? d.proposed.changeSummary;
      d.proposed.protectedKept = recheck.kept;
      d.proposed.warnings = recheck.dropped.length ? recheck.dropped.map(warn) : undefined;
      d.dropped = recheck.dropped;
    }
  } catch {
    // keep the original edit + its warning
  }
}

/** Plan a chat turn, then propose (never apply) the resulting batch of guarded, gated edits. */
export async function runAgent(req: ChatRequest): Promise<ChatResponse> {
  const blocks = req.blocks ?? [];
  const suppliedContext = req.docContext;
  const localSamples = blocks
    .filter((block) => block.type === 'paragraph' && block.text.trim().length >= 120)
    .sort((a, b) => b.text.length - a.text.length)
    .slice(0, 3)
    .map((block) => block.text.trim().slice(0, 600));
  const docContext: DocumentContext = {
    headings:
      suppliedContext?.headings ??
      blocks.filter((block) => block.type === 'heading').map((block) => block.text),
    firm: suppliedContext?.firm,
    docId: suppliedContext?.docId,
    voiceSamples: suppliedContext?.voiceSamples?.length
      ? suppliedContext.voiceSamples
      : localSamples,
    // Resolver-only applicability signal; never copied into the generated prompt.
    docText:
      suppliedContext?.docText ??
      blocks
        .map((block) => block.text)
        .join('\n')
        .slice(0, 50_000),
  };

  // One hard budget for the whole request; the planner is its first spend.
  const budget = makeCallBudget(LIMITS.maxModelCalls);
  budget.take();
  const plan = await runPlan(req.message, blocks, {
    history: req.history,
    selection: req.selection,
    docContext,
  });

  if (plan.edits.length === 0) {
    return { reply: plan.reply, proposedEdits: [] };
  }

  const byId = new Map(blocks.map((b) => [b.id, b]));
  // The firm name is a doc-specific protected name the gate should also defend.
  const extraNames = docContext.firm ? [docContext.firm] : [];

  // Drop planned blocks that don't exist, and skip pathologically large ones before any model
  // call (a huge block can't be truncated safely — see limits.maxBlockChars). Count the skips.
  let oversized = 0;
  const targets = plan.edits.filter((e): e is PlannedEdit => {
    const b = byId.get(e.blockId);
    if (!b) return false;
    if (b.text.length > LIMITS.maxBlockChars) {
      oversized++;
      return false;
    }
    return true;
  });

  // Phase 1 — EDITS first (coverage prioritized over repair polish), each budget-gated.
  let skippedForBudget = 0;
  const drafts = (
    await mapPool(targets, EDIT_CONCURRENCY, async (e) => {
      if (!budget.take()) {
        skippedForBudget++;
        return null;
      }
      return draftEdit(
        byId.get(e.blockId)!,
        e.instruction,
        req.message,
        extraNames,
        docContext,
      );
    })
  ).filter((d): d is EditDraft => d !== null);

  // Phase 2 — REPAIRS for entity drops, only while budget remains.
  if (REPAIR_ON_ENTITY_DROP) {
    await mapPool(
      drafts.filter((d) => d.dropped.length > 0),
      EDIT_CONCURRENCY,
      async (d) => {
        if (!budget.take()) return; // out of budget → ship the flagged first-pass edit as-is
        await repairEdit(d);
      },
    );
  }

  const proposedEdits = drafts.map((d) => d.proposed);

  // Honest notes — no silent caps. Combine the "there's more" signal (hit the per-turn block cap
  // or ran out of call budget) with any oversized-block skips.
  const notes: string[] = [];
  if (skippedForBudget > 0 || plan.edits.length >= LIMITS.maxEditBlocks) {
    const n = proposedEdits.length;
    notes.push(
      `I focused on ${n} section${n === 1 ? '' : 's'} this round — ask me to continue and I’ll keep going.`,
    );
  }
  if (oversized > 0) {
    notes.push(
      `${oversized} section${oversized === 1 ? ' was' : 's were'} too large to edit safely, so I left ${oversized === 1 ? 'it' : 'them'} unchanged.`,
    );
  }
  const reply = notes.length ? `${plan.reply} (${notes.join(' ')})` : plan.reply;

  return { reply, summary: plan.summary, proposedEdits };
}
