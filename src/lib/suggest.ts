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
 *  2. ENTITY-SAFE instruction: the seed handed to /api/edit carries an explicit "preserve every
 *     name/number/$/date" clause plus the block's own protected entities (src/lib/entities.ts).
 *     The actual rewrite still runs through the guardrailed /api/edit, so fidelity is enforced twice.
 *  3. FIRM VOICE, server-side only: the model is steered to the firm's ESTABLISHED register so it
 *     never proposes casual/punchy rewrites of formal text. There is no /kb/ corpus in the repo
 *     yet, so the register is derived from the document's OWN longest prose paragraphs; this is
 *     forward-compatible with a real KB voice card via `voiceOverride` when one lands.
 *
 * Anti-gaming: a GENERAL editorial rubric only (no hardcoded fixes for specific proposals/entities),
 * precision over recall, capped list, cached per doc-hash so spend is bounded.
 */
import { AI_MODELS, getAnthropic } from './ai';
import { protectedStrings } from './entities';
import { FIRM_VOICE } from '@/kb';
import type { LlmRefineCategory, LlmSuggestion } from './contracts';
import type { Block, Doc } from './types';

const CATEGORIES = ['wordiness', 'clarity', 'consistency'] as const;
const MAX_SUGGESTIONS = 6;
const MAX_BLOCKS_REVIEWED = 50; // bound the prompt (easy.pdf is well under this)
const MAX_BLOCK_CHARS = 600; // truncate any one block in the prompt

/** Bump when the rubric/prompt/schema change materially (invalidates the cache). */
export const SUGGEST_VERSION = 1;

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
            instruction: {
              type: 'string',
              description:
                "A concrete rewrite instruction for this block, in the firm's established formal " +
                'register. Do not restate names or numbers; do not mention the style samples.',
            },
          },
          required: ['blockId', 'category', 'evidence', 'title', 'instruction'],
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
4. Match the firm's ESTABLISHED voice shown in the style samples: your "instruction" must steer toward that register (formal, technical) — never toward a casual or punchy rewrite. Do NOT quote or mention the style samples in your output.
5. At most ${MAX_SUGGESTIONS} suggestions, at most one per block.

Report your result by calling the report_suggestions tool.`;

/**
 * The firm's established register. Primary source is the committed KB voice card (FIRM_VOICE);
 * we fall back to the document's own longest prose paragraphs only if that card is ever empty
 * (defensive — the interim behavior for an unseen firm/document). Server-side only; never shown.
 */
function resolveVoice(doc: Doc): { register: string[]; samples: string[] } {
  const samples = FIRM_VOICE.exemplars.length ? FIRM_VOICE.exemplars : deriveVoiceSamples(doc);
  return { register: FIRM_VOICE.register, samples };
}

/** Fallback register signal: the document's own longest prose paragraphs. */
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
  doc: Doc,
  blocks: Block[],
  voice: { register: string[]; samples: string[] },
): string {
  const parts: string[] = [];
  if (voice.register.length || voice.samples.length) {
    parts.push("The firm's established writing voice — match this register; do NOT quote or mention it:");
    if (voice.register.length) parts.push(...voice.register.map((r) => `- ${r}`));
    if (voice.samples.length) {
      parts.push('Representative sentences in that voice:', '"""', voice.samples.join('\n\n'), '"""');
    }
    parts.push('');
  }
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

/** Append a deterministic entity-safety clause to the model's instruction. */
function entitySafeInstruction(raw: string, blockText: string): string {
  const base = raw.trim().replace(/\s+$/, '');
  const withStop = /[.!?]$/.test(base) ? base : `${base}.`;
  const protectedList = protectedStrings(blockText);
  const clause = protectedList.length
    ? ` Keep these exactly as written: ${protectedList.join(', ')}. Change nothing else's facts.`
    : ' Preserve every name, number, date, dollar figure, and license/project number exactly as written.';
  return withStop + clause;
}

interface RawItem {
  blockId?: unknown;
  category?: unknown;
  evidence?: unknown;
  title?: unknown;
  instruction?: unknown;
}

/** Validate + ground one raw model item into a Suggestion, or null to drop it. */
function toSuggestion(raw: RawItem, byId: Map<string, Block>): LlmSuggestion | null {
  const blockId = typeof raw.blockId === 'string' ? raw.blockId : '';
  const category = raw.category as LlmRefineCategory;
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  const rawInstruction = typeof raw.instruction === 'string' ? raw.instruction.trim() : '';
  const rawEvidence = typeof raw.evidence === 'string' ? raw.evidence : '';

  const block = byId.get(blockId);
  if (!block) return null;
  if (!CATEGORIES.includes(category)) return null;
  if (!title || !rawInstruction) return null;

  const evidence = locateVerbatim(block.text, rawEvidence);
  if (!evidence) return null; // not grounded → drop (precision over recall)

  return {
    id: `${category}:${blockId}`,
    blockId,
    category,
    title,
    why: whyFor(category, evidence),
    instruction: entitySafeInstruction(rawInstruction, block.text),
    evidence,
  };
}

// Per-doc cache: doc.id is a content hash, so the same document never re-spends within a warm
// instance. Ephemeral (per-instance) is fine — the point is bounding spend, not durability.
const CACHE = new Map<string, LlmSuggestion[]>();

/** Compute (or reuse) the grounded LLM suggestions for a document. */
export async function getSuggestions(doc: Doc): Promise<{ suggestions: LlmSuggestion[]; cached: boolean }> {
  const key = `${SUGGEST_VERSION}:${doc.id}`;
  const hit = CACHE.get(key);
  if (hit) return { suggestions: hit, cached: true };

  const blocks = reviewableBlocks(doc);
  if (blocks.length === 0) {
    CACHE.set(key, []);
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
    messages: [{ role: 'user', content: buildUserMessage(doc, blocks, resolveVoice(doc)) }],
  });

  const toolUse = res.content.find((b) => b.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('model did not return structured suggestions');
  }
  const input = toolUse.input as { suggestions?: unknown };
  const rawItems = Array.isArray(input.suggestions) ? (input.suggestions as RawItem[]) : [];

  const byId = new Map(blocks.map((b) => [b.id, b]));
  const seen = new Set<string>();
  const out: LlmSuggestion[] = [];
  for (const raw of rawItems) {
    const s = toSuggestion(raw, byId);
    if (!s || seen.has(s.id)) continue; // dedupe by id (category:blockId)
    seen.add(s.id);
    out.push(s);
    if (out.length >= MAX_SUGGESTIONS) break;
  }

  CACHE.set(key, out);
  return { suggestions: out, cached: false };
}
