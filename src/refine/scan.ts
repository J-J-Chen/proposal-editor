/**
 * Refine — the proactive "Check my proposal for things to fix" pass (Track G / CP7).
 *
 * v1 is DETERMINISTIC and client-side: no model call, no spend, and — the important part — every
 * suggestion's "why" is GROUNDED in the actual text it cites (decisions.md: the why must be a
 * rubric check or a real citation, never free-form LLM justification). High precision over recall:
 * we only flag things we can point at verbatim, and cap the list. Accepting a suggestion routes
 * through the existing /api/edit → review card → apply/undo loop (the instruction is the seed).
 *
 * The fuzzy checks (tighten wordy boilerplate, richer consistency) are the next step — an
 * /api/suggest route on a cheap model — and are intentionally NOT here yet.
 */
import type { Doc } from '@/lib/types';

// The first three come from the deterministic client scan below. The last three come from the
// LLM editorial pass (POST /api/suggest, contracts.ts `LlmRefineCategory`) and are merged into the
// same RefinePanel — widening the union here makes an LlmSuggestion structurally a Suggestion.
export type RefineCategory =
  | 'placeholder'
  | 'casing'
  | 'repetition'
  | 'wordiness'
  | 'clarity'
  | 'consistency';

export interface Suggestion {
  id: string; // stable: `${category}:${blockId}`
  blockId: string;
  category: RefineCategory;
  title: string; // imperative
  why: string; // grounded — quotes the actual text
  instruction: string; // seed handed to the edit loop on "Make this fix"
  evidence: string; // the span that triggered it
}

// Leftover placeholder text: [INSERT ...], [Client Name], TBD, Lorem ipsum, XXXX.
const PLACEHOLDER_RE =
  /\[[^\]\n]{0,60}?\b(insert|tbd|todo|placeholder|name|date|client|project|xxx+)\b[^\]\n]{0,60}?\]|\bTBD\b|\bLorem ipsum\b|\bX{3,}\b/i;
// A lowercased name followed by a professional title: "vogler, pe" (case-sensitive on purpose).
const LOWER_TITLE_RE = /\b[a-z][a-z]{2,},\s*(?:pe|se|pls)\b/;
// The same word repeated 3+ times in a row: "Vice-President Vice-President Vice-President".
const REPEAT_RE = /\b([A-Za-z][\w-]{2,})(?:\s+\1\b){2,}/;

function ellipsize(s: string, max = 52): string {
  const t = s.trim().replace(/\s+/g, ' ');
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

/** Scan the document for a short, high-precision list of grounded refinements. */
export function scanForRefinements(doc: Doc): Suggestion[] {
  const out: Suggestion[] = [];
  const add = (s: Suggestion) => {
    if (!out.some((x) => x.id === s.id)) out.push(s);
  };

  for (const b of doc.blocks) {
    if (b.type === 'heading') continue;

    const ph = b.text.match(PLACEHOLDER_RE);
    if (ph) {
      add({
        id: `placeholder:${b.id}`,
        blockId: b.id,
        category: 'placeholder',
        title: 'Remove leftover placeholder text',
        why: `This looks like placeholder text left in the document: “${ellipsize(ph[0])}”.`,
        instruction: `Remove the leftover placeholder text "${ph[0]}" from this section; keep everything else exactly as written.`,
        evidence: ph[0],
      });
    }

    const lc = b.text.match(LOWER_TITLE_RE);
    if (lc) {
      add({
        id: `casing:${b.id}`,
        blockId: b.id,
        category: 'casing',
        title: 'Fix a lowercase name and title',
        why: `A name and professional title appear in lowercase here — “${lc[0]}”.`,
        instruction: `Correct the capitalization of the personnel names and professional titles (PE, SE, PLS) in this section. Keep every license number, project number, and other fact exactly as written.`,
        evidence: lc[0],
      });
    }

    const rep = b.text.match(REPEAT_RE);
    if (rep) {
      add({
        id: `repetition:${b.id}`,
        blockId: b.id,
        category: 'repetition',
        title: 'Remove repeated words',
        why: `“${rep[1]}” is repeated several times in a row here — likely a copy-paste error.`,
        instruction: `Remove the accidentally duplicated words (for example "${rep[1]}" repeated back-to-back) in this section. Keep the meaning and every name and number.`,
        evidence: rep[0],
      });
    }
  }

  return out.slice(0, 6); // precision over recall — a short, trustworthy list
}
