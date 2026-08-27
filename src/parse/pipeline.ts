// PIPELINE (pure parse) — extract → dedupe → annotate → (LLM structure | heuristic fallback)
// → assemble → Doc. No cache dependency (so seed generation can import this without pulling the
// generated L0 barrel). Cache-first orchestration lives in cache.ts (getOrParse).
import type { Doc } from './types';
import { extractLines } from './extract';
import { dedupe, annotate, heuristicBlocks } from './heuristics';
import { structure, STRUCTURE_MODEL } from './structure';
import { assemble } from './assemble';
import { sha256 } from './hash';

/** Parse raw PDF bytes into a Doc. Never throws on LLM failure — degrades to heuristics. */
export async function parseBytes(bytes: Uint8Array, filename: string): Promise<Doc> {
  const id = sha256(bytes);
  const annotated = annotate(dedupe(extractLines(bytes)));

  let model = STRUCTURE_MODEL;
  let refs;
  try {
    refs = await structure(annotated);
  } catch (err) {
    console.error('[parse] LLM structuring failed → heuristic fallback:', (err as Error).message);
    refs = heuristicBlocks(annotated);
    model = 'heuristic-fallback';
  }

  const blocks = assemble(refs, annotated);
  const pages = blocks.reduce((m, b) => Math.max(m, b.page), 0);

  return {
    id,
    filename,
    blocks,
    meta: { pages, parsedAt: new Date().toISOString(), model },
  };
}
