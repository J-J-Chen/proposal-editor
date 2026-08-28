/**
 * The suggest service — the LLM half of the proactive "Refine" pass (Track G / CP7).
 *
 * The client-side deterministic scan (src/refine/scan.ts) is the instant FLOOR: leftover
 * placeholders, lowercase names, repeated words. On a clean easy.pdf that floor goes near-empty,
 * so this adds *editorial depth* — the wordy, vague, and inconsistent phrasing a rubric can catch
 * but only a model can spot in prose. The two lists merge on the client (concat + dedupe by id).
 *
 * Server-only (imports the proxy client). Three commitments make it trustworthy, all from
 * docs/decisions.md + the peers' review:
 *  1. GROUNDED why: every suggestion's visible `why`/`evidence` quotes a span copied VERBATIM from
 *     the block's OWN text. We verify the span really occurs in the block and DROP it otherwise —
 *     never free-form LLM justification, and never the KB (the KB must not leak into the UI).
 *  2. NON-AUTHORING model: the model identifies a category and verbatim evidence, but it does not
 *     author the executable edit instruction. The server derives a fact-neutral category seed and
 *     appends the block's protected entities, so a suggestion cannot authorize its own invented fact.
 *  3. SCOPED VOICE, server-side only: known MECO documents use the reviewed, versioned five-PDF
 *     voice profile. Every other firm uses bounded samples from its OWN document. The compiler
 *     labels all examples STYLE ONLY and makes the factual boundary explicit.
 *
 * Anti-gaming: a GENERAL editorial rubric only (no hardcoded fixes for specific proposals/entities),
 * precision over recall, capped list, cached per doc-hash so spend is bounded.
 */
import { AI_MODELS, getAnthropic } from './ai';
import { protectedStrings } from './entities';
import { runEdit } from './edit';
import { isNoChange } from './text/diff';
import {
  compileVoiceGuidance,
  resolveVoiceGuidance,
  voiceCacheKey,
  type ResolvedVoiceGuidance,
} from '@/kb/voice-guidance';
import { sha256 } from '@/parse/hash';
import type { LlmRefineCategory, LlmSuggestion } from './contracts';
import type { DocumentContext } from './contracts';
import type { Block, Doc } from './types';

const CATEGORIES = ['wordiness', 'clarity', 'consistency'] as const;
const MAX_SUGGESTIONS = 6;
const MAX_BLOCKS_REVIEWED = 50; // bound the prompt (easy.pdf is well under this)
const MAX_BLOCK_CHARS = 600; // truncate any one block in the prompt

/** Bump when the rubric/prompt/schema change materially (invalidates the cache). */
export const SUGGEST_VERSION = 4;

/** Validate at most this many candidates concurrently through the guarded editor (gentle on the proxy). */
const VALIDATE_CONCURRENCY = 4;

export const SUGGEST_TOOL = {
  name: 'report_suggestions',
  description: 'Report the editorial suggestions found, grounded in verbatim spans.',
  input_schema: {
    type: 'object' as const,
    properties: {
      suggestions: {
        type: 'array',
        description: `At most ${MAX_SUGGESTIONS}. Omit anything you cannot quote verbatim.`,
        items: {
          type: 'object',
          properties: {
            blockId: { type: 'string', description: 'The id of the block, exactly as listed.' },
            category: {
              type: 'string',
              enum: [...CATEGORIES],
              description:
                'wordiness = wordy/filler/hedging to tighten; clarity = a vague claim lacking ' +
                'specifics; consistency = mixed tense/terminology for the same thing.',
            },
            evidence: {
              type: 'string',
              description:
                'A short span (≤ ~12 words) copied CHARACTER-FOR-CHARACTER from that block, ' +
                'showing the issue. It must appear verbatim in the block.',
            },
            title: {
              type: 'string',
              description: 'Imperative, ≤ 6 words. e.g. "Tighten this sentence".',
            },
          },
          required: ['blockId', 'category', 'evidence', 'title'],
        },
      },
    },
    required: ['suggestions'],
  },
};

export const SUGGEST_SYSTEM_PROMPT = `You are a senior editor reviewing an engineering/architecture firm's OWN proposal for places to sharpen the writing. You return a SHORT, high-precision list — quality over quantity; returning few or none is correct.

Only flag these general editorial issues, and ONLY when you can quote the exact words that show it:
- wordiness: wordy boilerplate, filler, or hedging/passive phrasing that should be tightened.
- clarity: a vague claim lacking specifics (e.g. "various projects", "many years of experience") that would be stronger made concrete.
- consistency: the same thing named two different ways, or mixed tense/terminology.

Hard rules:
1. GROUND EVERYTHING. For each suggestion, copy a short "evidence" span VERBATIM from the block (character-for-character). If you cannot point at exact words, do not raise it.
2. NEVER flag or propose changing any proper noun, person/firm/place name, project or license number, dollar amount, or date — those are fixed facts.
3. No invented issues, no style opinions you can't cite. Precision over recall.
4. Use the resolved VOICE GUIDANCE only to judge whether wording is worth flagging. Voice examples are STYLE ONLY, never fact sources. Do NOT quote or mention them in your output.
5. If a clarity issue would require a missing detail, name, number, project, credential, or technical claim, do not suggest it. The server—not you—derives the executable rewrite instruction.
6. At most ${MAX_SUGGESTIONS} suggestions, at most one per block.

Report your result by calling the report_suggestions tool.`;

/** Bounded document-local register signal for an unmatched firm. */
function deriveVoiceSamples(doc: Doc, k = 3): string[] {
  return doc.blocks
    .filter((b) => b.type === 'paragraph' && b.text.trim().length >= 120)
    .sort((a, b) => b.text.length - a.text.length)
    .slice(0, k)
    .map((b) => b.text.trim().slice(0, MAX_BLOCK_CHARS));
}

/** Prose blocks worth reviewing (headings/tiny fragments excluded). */
function reviewableBlocks(doc: Doc): Block[] {
  return doc.blocks
    .filter(
      (b) =>
        (b.type === 'paragraph' || b.type === 'list-item' || b.type === 'caption') &&
        b.text.trim().length >= 40,
    )
    .slice(0, MAX_BLOCKS_REVIEWED);
}

function buildUserMessage(
  blocks: Block[],
  voice: ResolvedVoiceGuidance,
): string {
  const parts: string[] = [compileVoiceGuidance(voice), ''];
  parts.push('Review these blocks. Refer to each by its bracketed id:', '');
  for (const b of blocks) {
    const text = b.text.trim().replace(/\s+/g, ' ').slice(0, MAX_BLOCK_CHARS);
    parts.push(`[${b.id}] (${b.type}) ${text}`);
  }
  return parts.join('\n');
}

/** Find `evidence` verbatim in the block; tolerate only whitespace differences. Null = not grounded. */
function locateVerbatim(blockText: string, evidence: string): string | null {
  const ev = evidence.trim();
  if (ev.length < 3) return null;
  if (blockText.includes(ev)) return ev;
  const normEv = ev.replace(/\s+/g, ' ');
  const normBlock = blockText.replace(/\s+/g, ' ');
  return normBlock.includes(normEv) ? normEv : null;
}

function whyFor(category: LlmRefineCategory, evidence: string): string {
  const q = `“${evidence}”`;
  switch (category) {
    case 'wordiness':
      return `This could be tightened — for example ${q}.`;
    case 'clarity':
      return `This reads as vague — ${q} would be stronger with specifics.`;
    case 'consistency':
      return `The wording here is inconsistent — ${q}.`;
  }
}

/** Append a deterministic entity-safety clause to a server-authored, fact-neutral instruction. */
function entitySafeInstruction(base: string, blockText: string): string {
  const withStop = /[.!?]$/.test(base) ? base : `${base}.`;
  const protectedList = protectedStrings(blockText);
  const clause = protectedList.length
    ? ` Keep these exactly as written: ${protectedList.join(', ')}. Change nothing else's facts.`
    : ' Preserve every name, number, date, dollar figure, and license/project number exactly as written.';
  return withStop + clause;
}

/** The model may identify an issue, but it never receives factual mutation authority. */
function instructionFor(
  category: LlmRefineCategory,
  blockText: string,
): string {
  let seed: string;
  switch (category) {
    case 'wordiness':
      seed = 'Tighten only the wordy phrasing identified in this block; keep its meaning';
      break;
    case 'clarity':
      seed =
        'Clarify only the vague phrasing identified in this block using facts already present; if no supported clarification is possible, leave it unchanged';
      break;
    case 'consistency':
      seed =
        'Standardize only the inconsistent terminology identified in this block using terminology already present';
      break;
  }
  return entitySafeInstruction(seed, blockText);
}

interface RawItem {
  blockId?: unknown;
  category?: unknown;
  evidence?: unknown;
  title?: unknown;
}

/** A grounded suggestion before its rewrite is validated — everything but the pre-computed `after`. */
type Candidate = Omit<LlmSuggestion, 'after'>;

/** Validate + ground one raw model item into a Candidate, or null to drop it. */
function toSuggestion(raw: RawItem, byId: Map<string, Block>): Candidate | null {
  const blockId = typeof raw.blockId === 'string' ? raw.blockId : '';
  const category = raw.category as LlmRefineCategory;
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  const rawEvidence = typeof raw.evidence === 'string' ? raw.evidence : '';

  const block = byId.get(blockId);
  if (!block) return null;
  if (!CATEGORIES.includes(category)) return null;
  if (!title) return null;

  const evidence = locateVerbatim(block.text, rawEvidence);
  if (!evidence) return null; // not grounded → drop (precision over recall)

  return {
    id: `${category}:${blockId}`,
    blockId,
    category,
    title,
    why: whyFor(category, evidence),
    instruction: instructionFor(category, block.text),
    evidence,
  };
}

// Per-doc cache, keyed by a SERVER-COMPUTED hash of the submitted block content — never the
// client-supplied doc.id. Trusting doc.id would let a client pass another request's id and read
// back that document's cached suggestions/evidence (a cross-request content leak); deriving the
// key from the content actually submitted means you can only ever retrieve suggestions for content
// you sent. Ephemeral (per-instance) is fine — the point is bounding spend, not durability.
const MAX_CACHE_ENTRIES = 64;
const CACHE = new Map<string, LlmSuggestion[]>();

function cacheSet(key: string, value: LlmSuggestion[]): void {
  CACHE.delete(key);
  CACHE.set(key, value);
  if (CACHE.size > MAX_CACHE_ENTRIES) {
    const oldest = CACHE.keys().next().value as string | undefined;
    if (oldest) CACHE.delete(oldest);
  }
}

/** Cache key from the content the server actually sees (not the client-asserted doc.id). */
function contentKey(doc: Doc, voice: ResolvedVoiceGuidance): string {
  const canon = doc.blocks
    .map((b) => `${b.id} ${b.type} ${b.level ?? ''} ${b.text}`)
    .join('');
  return `${SUGGEST_VERSION}:${voiceCacheKey(voice)}:${sha256(Buffer.from(canon, 'utf8'))}`;
}

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
 * Validate one candidate by PRE-RUNNING its instruction through the SAME guarded editor as
 * /api/edit (runEdit), then keeping it only if the rewrite is a real, entity-safe change:
 *  - a no-op is dropped — the guarded editor correctly refused to invent (e.g. a "make concrete"
 *    ask with no in-doc facts), which is exactly the dead-end card we must never surface;
 *  - a rewrite that drops any protected entity is dropped (would break a fixed fact);
 *  - a proxy/model error yields `errored` so the caller can skip caching (a transient failure must
 *    not permanently hide a good suggestion).
 * The surviving `after` is exactly what "Make this fix" would have produced, so the FE applies it
 * with no second AI round-trip.
 */
async function validateCandidate(
  cand: Candidate,
  block: Block,
  docContext: { headings: string[]; firm?: string },
): Promise<{ suggestion: LlmSuggestion | null; errored: boolean }> {
  let after: string;
  try {
    const res = await runEdit({
      block: { id: block.id, text: block.text, type: block.type },
      instruction: cand.instruction,
      docContext,
    });
    after = res.newText;
  } catch {
    return { suggestion: null, errored: true };
  }
  if (isNoChange(block.text, after)) return { suggestion: null, errored: false };
  const dropped = protectedStrings(block.text).filter((e) => !after.includes(e));
  if (dropped.length > 0) return { suggestion: null, errored: false };
  return { suggestion: { ...cand, after }, errored: false };
}

/** Compute (or reuse) the grounded LLM suggestions for a document. */
export async function getSuggestions(
  doc: Doc,
  docContext?: DocumentContext,
): Promise<{ suggestions: LlmSuggestion[]; cached: boolean }> {
  const voice = resolveVoiceGuidance({
    firm: docContext?.firm,
    documentText: docContext?.docText ?? doc.blocks.map((block) => block.text).join('\n'),
    voiceSamples: docContext?.voiceSamples?.length
      ? docContext.voiceSamples
      : deriveVoiceSamples(doc),
  });
  const key = contentKey(doc, voice);
  const hit = CACHE.get(key);
  if (hit) {
    // Refresh recency for the small LRU.
    CACHE.delete(key);
    CACHE.set(key, hit);
    return { suggestions: hit, cached: true };
  }

  const blocks = reviewableBlocks(doc);
  if (blocks.length === 0) {
    cacheSet(key, []);
    return { suggestions: [], cached: false };
  }

  const anthropic = getAnthropic();
  const res = await anthropic.messages.create({
    model: AI_MODELS.anthropicMain,
    max_tokens: 1500,
    temperature: 0.2,
    system: SUGGEST_SYSTEM_PROMPT,
    tools: [SUGGEST_TOOL],
    tool_choice: { type: 'tool', name: SUGGEST_TOOL.name },
    messages: [{ role: 'user', content: buildUserMessage(blocks, voice) }],
  });

  const toolUse = res.content.find((b) => b.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('model did not return structured suggestions');
  }
  const input = toolUse.input as { suggestions?: unknown };
  const rawItems = Array.isArray(input.suggestions) ? (input.suggestions as RawItem[]) : [];

  // Phase 1 — grounded candidates (the model flags the issue; the server owns the instruction).
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const raw of rawItems) {
    const s = toSuggestion(raw, byId);
    if (!s || seen.has(s.id)) continue; // dedupe by id (category:blockId)
    seen.add(s.id);
    candidates.push(s);
    if (candidates.length >= MAX_SUGGESTIONS) break;
  }
  if (candidates.length === 0) {
    cacheSet(key, []);
    return { suggestions: [], cached: false };
  }

  // Phase 2 — validate each candidate by pre-running the SAME guarded editor, and keep only the
  // ones that yield a real, entity-safe change. Bounded (≤ MAX_SUGGESTIONS) + concurrency-capped;
  // the result lands in the per-content cache, so this cost is once per upload, not per interaction.
  const headings = doc.blocks.filter((b) => b.type === 'heading').map((b) => b.text);
  const editorContext = { headings, firm: docContext?.firm };
  const results = await mapPool(candidates, VALIDATE_CONCURRENCY, (c) =>
    validateCandidate(c, byId.get(c.blockId)!, editorContext),
  );
  const suggestions = results
    .map((r) => r.suggestion)
    .filter((s): s is LlmSuggestion => s !== null);

  // Cache only a clean run — a transient validation error shouldn't permanently hide good suggestions.
  if (!results.some((r) => r.errored)) cacheSet(key, suggestions);
  return { suggestions, cached: false };
}
