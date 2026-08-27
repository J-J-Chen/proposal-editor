// Internal parse-pipeline types. The public document model (Doc/Block/BlockType) lives in
// src/lib/types.ts and is FROZEN — we re-export it here so pipeline code has one import.
import type { Block, BlockType, Doc } from '@/lib/types';
export type { Block, BlockType, Doc };

/**
 * One text line as emitted by the extractor (mupdf `toStructuredText().asJSON()`),
 * before any structuring. Font is reported at line granularity by mupdf, which is exactly
 * what the weight/caps/size heuristics need.
 */
export interface RawLine {
  /** Index into the ordered, de-duplicated line array. The LLM references these. */
  idx: number;
  text: string;
  /** bbox in PDF points (top-left origin). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Font size in points. */
  size: number;
  /** True for bold/semibold faces (mupdf weight, plus a font-name fallback). */
  bold: boolean;
  /** Raw font name, e.g. "CAAAAA+ProximaNova-Semibold" (kept for debugging/heuristics). */
  font: string;
  /** 1-based page number (matches Block.page). */
  page: number;
}

/** Provisional label the heuristics attach to each line before the LLM refines boundaries. */
export type ProvLabel = Exclude<BlockType, 'table'>;

/** A raw line annotated with heuristic signals, handed to the LLM as numbered input. */
export interface AnnotatedLine extends RawLine {
  label: ProvLabel;
  caps: boolean;
  /** Page "chrome": a repeated header/footer/page-number line (kept but de-prioritised). */
  chrome: boolean;
}

/** What the LLM returns: a block as a range of line indices + a type/level. Never text. */
export interface BlockRef {
  type: BlockType;
  /** 1..3 for headings, null otherwise. */
  level: number | null;
  startLine: number;
  endLine: number;
}
