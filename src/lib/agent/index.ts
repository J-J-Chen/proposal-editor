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
 */
import type { Block } from '@/lib/types';
import { runEdit } from '@/lib/edit';
import { isNoChange } from '@/lib/text/diff';
import type { ChatRequest, ChatResponse, ProposedEdit } from './contract';
import { runPlan, type PlannedEdit } from './plan';
import { checkEntityFidelity } from './entity-gate';

/** Edit at most this many blocks concurrently — gentle on the proxy + bounds burst spend. */
const EDIT_CONCURRENCY = 4;
/** Re-try a block once when the guarded edit drops a protected entity, before flagging it. */
const REPAIR_ON_ENTITY_DROP = true;

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

/**
 * Edit one planned block through the guardrail, then run the deterministic entity gate. If the
 * edit dropped a protected entity, retry once with the instruction augmented to forbid the change;
 * whatever remains dropped after that is returned as a warning (never silently applied — and never
 * silently discarded either). Returns null for a no-op or a hard failure on this block.
 */
async function editOne(
  block: Block,
  instruction: string,
  extraNames: readonly string[],
  docContext?: { firm?: string },
): Promise<ProposedEdit | null> {
  const req = {
    block: { id: block.id, text: block.text, type: block.type },
    instruction,
    docContext: docContext ? { headings: [], firm: docContext.firm } : undefined,
  };

  let after: string;
  let rationale: string | undefined;
  try {
    const res = await runEdit(req);
    after = res.newText;
    rationale = res.rationale;
  } catch {
    return null; // one block failing must not sink the whole batch
  }
  if (isNoChange(block.text, after)) return null;

  let { kept, dropped } = checkEntityFidelity(block.text, after, extraNames);

  if (dropped.length > 0 && REPAIR_ON_ENTITY_DROP) {
    try {
      const repaired = await runEdit({
        ...req,
        instruction: `${instruction}\n\nCRITICAL: keep these EXACTLY as written, unchanged and character-for-character: ${dropped.join(
          '; ',
        )}.`,
      });
      if (!isNoChange(block.text, repaired.newText)) {
        const recheck = checkEntityFidelity(block.text, repaired.newText, extraNames);
        // Only accept the repair if it didn't lose ground (fewer or equal drops).
        if (recheck.dropped.length <= dropped.length) {
          after = repaired.newText;
          rationale = repaired.rationale ?? rationale;
          kept = recheck.kept;
          dropped = recheck.dropped;
        }
      }
    } catch {
      // keep the original edit + its warning
    }
  }

  if (isNoChange(block.text, after)) return null;

  return {
    blockId: block.id,
    before: block.text,
    after,
    instruction,
    rationale,
    protectedKept: kept,
    warnings: dropped.length ? dropped.map((e) => `“${e}” was changed — normally kept exactly.`) : undefined,
  };
}

/** Plan a chat turn, then propose (never apply) the resulting batch of guarded, gated edits. */
export async function runAgent(req: ChatRequest): Promise<ChatResponse> {
  const blocks = req.blocks ?? [];
  const plan = await runPlan(req.message, blocks, {
    history: req.history,
    selection: req.selection,
  });

  if (plan.edits.length === 0) {
    return { reply: plan.reply, proposedEdits: [] };
  }

  const byId = new Map(blocks.map((b) => [b.id, b]));
  // The firm name is a doc-specific protected name the gate should also defend.
  const extraNames = req.docContext?.firm ? [req.docContext.firm] : [];

  const targets = plan.edits.filter((e): e is PlannedEdit => byId.has(e.blockId));
  const proposedEdits = (
    await mapPool(targets, EDIT_CONCURRENCY, (e) =>
      editOne(byId.get(e.blockId)!, e.instruction, extraNames, req.docContext),
    )
  ).filter((e): e is ProposedEdit => e !== null);

  return { reply: plan.reply, summary: plan.summary, proposedEdits };
}
