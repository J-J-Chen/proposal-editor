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

export type { Block, Doc };
