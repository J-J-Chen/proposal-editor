// ─────────────────────────────────────────────────────────────────────────────
// API CONTRACTS — request/response shapes shared by frontend + route handlers.
// Colocated so both sides import the same types. FROZEN (coordinate to change).
// ─────────────────────────────────────────────────────────────────────────────
import type { Block, BlockType, Doc } from './types';

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
  docContext?: { headings: string[]; firm?: string };
  kbContext?: string[]; // CP6: retrieved KB snippets to ground the edit
}
export interface EditResponse {
  newText: string;
  rationale?: string;
}

// POST /api/kb/search — CP6 (stretch). Track F owns it.
export interface KbSearchRequest {
  query: string;
  discipline?: string;
  k?: number;
}
export interface KbCandidate {
  snippetId: string;
  sourceDoc: string;
  page: number;
  title: string;
  text: string;
  score: number;
}
export interface KbSearchResponse {
  candidates: KbCandidate[];
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
}

export interface SuggestRequest {
  doc: Doc; // the parsed Doc (doc.id = content hash → the per-doc cache key)
}
export interface SuggestResponse {
  suggestions: LlmSuggestion[];
  cached: boolean;
}

export type { Block, Doc };
