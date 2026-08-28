// ─────────────────────────────────────────────────────────────────────────────
// API CONTRACTS — request/response shapes shared by frontend + route handlers.
// Colocated so both sides import the same types. FROZEN (coordinate to change).
// ─────────────────────────────────────────────────────────────────────────────
import type { Block, BlockType, Doc, KbProvenance } from './types';

export interface DocumentContext {
  headings: string[];
  firm?: string;
  docId?: string;
  /** Short excerpts sampled from the current document, used to match its local voice. */
  voiceSamples?: string[];
  /** Optional compact whole-document context for callers that already have it available. */
  docText?: string;
}

// POST /api/parse — browser hashes the file, sends the hash (+ uploads bytes on cache miss).
// Track A (parse) owns the real implementation; Phase-0 stub returns the fixture Doc.
export interface ParseRequest {
  hash: string; // sha256 of file bytes
  filename: string;
}
export interface ParseResponse {
  doc: Doc;
  cached: boolean;
}

// POST /api/edit — edit a single block. Track C owns the real implementation.
// Guardrail (Track C): change only what's asked; preserve proper nouns / project numbers / $.
export interface EditRequest {
  block: { id: string; text: string; type: BlockType };
  instruction: string; // a quick-action ("tighten") or free-text ask
  /** Raw human ask used by the hard fact gate when `instruction` also contains reference data. */
  authoritativeInstruction?: string;
  /** Original document wording; facts here may return only for an explicit restore/put-back ask. */
  referenceText?: string;
  docContext?: DocumentContext;
  kbContext?: string[]; // CP6: retrieved KB snippets to ground the edit
}
export interface EditResponse {
  newText: string;
  /** Model-authored description of the edit; never evidence or a grounded "why". */
  changeSummary?: string;
  /** Legacy response field retained while old caches/snapshots age out. */
  rationale?: string;
}

// POST /api/kb/search — CP6 (stretch). Track F owns it.
export interface KbSearchRequest {
  query: string;
  discipline?: string;
  k?: number;
  docId?: string;
  excludeSourceDoc?: string;
}
export interface KbCandidate {
  /** Opaque server-issued handle. The browser sends only this id when composing. */
  candidateId: string;
  /** Legacy corpus id, if supplied by an older search implementation. */
  snippetId?: string;
  sourceDoc: string;
  sourceTitle: string;
  page: number;
  title: string;
  text: string;
  quote?: string;
  score: number;
  discipline: string;
}
export interface KbSearchResponse {
  candidates: KbCandidate[];
}

export interface KbComposeRequest {
  candidateId: string;
  target: { id: string; text: string; type: BlockType; page: number };
  docContext: DocumentContext;
}

export interface KbComposeResponse {
  newText: string;
  candidate: KbCandidate;
  provenance: KbProvenance;
  fallbackUsed: boolean;
}

// POST /api/suggest — the proactive editorial "Refine" pass (Track G / CP7). This track owns it.
// Adds LLM-grounded suggestions ON TOP of the client-side deterministic scan (src/refine/scan.ts).
// The Suggestion shape is byte-identical to refine/scan.ts's `Suggestion`, so the two lists MERGE
// cleanly: concat(clientScan, serverSuggestions) then dedupe by `id` (= `${category}:${blockId}`).
// The only delta is `category`: these values are NOT yet in RefineCategory — the FE folds
// `LlmRefineCategory` into that union (+ CAT_LABEL + chip CSS) during its merge. why/evidence always
// quote the block's OWN text; the KB/voice signal steers server-side only and never enters the payload.
export type LlmRefineCategory = 'wordiness' | 'clarity' | 'consistency';

export interface LlmSuggestion {
  id: string; // `${category}:${blockId}` — same convention as the deterministic scan
  blockId: string;
  category: LlmRefineCategory;
  title: string; // imperative, short
  why: string; // grounded — built server-side around a verbatim span of the block
  instruction: string; // entity-safe seed handed to /api/edit on "Make this fix"
  evidence: string; // the verbatim span that triggered it
  /**
   * The pre-computed, already-guarded rewrite (Option B): the suggest pass ran the same guarded
   * editor at generation, dropped no-ops + entity-breakers, and returns only survivors — each
   * carrying its guarded `after`. The FE applies it directly on "Make this fix" (no /api/edit),
   * still re-running the entity gate on apply. Folds into refine/scan.ts `Suggestion.after`.
   */
  after?: string;
}

export interface SuggestRequest {
  doc: Doc; // the parsed Doc (doc.id = content hash → the per-doc cache key)
  /** Asserted fixture identity + bounded local voice samples, shared with every other edit path. */
  docContext?: DocumentContext;
}
export interface SuggestResponse {
  suggestions: LlmSuggestion[];
  cached: boolean;
}

export type { Block, Doc };
