// CACHE — parse results keyed by sha256(bytes). No DB (project rule).
//
// L0: committed pre-parsed seeds (src/parse-cache/*.json via the generated barrel) — the graded
//     demo is instant/deterministic, no runtime LLM.
// L1: in-process Map — warm-instance / dev accelerator (per-instance, ephemeral; fine).
// No Vercel Blob: Vercel Functions now accept request bodies up to 100MB, so the 13–18MB fixtures
// POST directly to /api/parse on a genuine miss — no client-upload workaround needed.
import type { Doc } from '@/lib/types';
import { SEEDS } from '@/parse-cache';
import { parseBytes } from './pipeline';

/** Bump when the extractor/heuristics/prompt/schema change materially (regenerate seeds too). */
export const PARSER_VERSION = 1;

const L1 = new Map<string, Doc>();

// Source bytes kept per-instance so the read-only "Original PDF" view can rasterise an uploaded
// doc's pages on demand (/api/page). Bounded + ephemeral (never a store of record). Seeded docs
// carry no bytes here — their Original view is served from committed public/pages/<hash>/ images.
const BYTES = new Map<string, Uint8Array>();
const BYTES_MAX = 4; // ~13-18MB each; keep only the few most-recent uploads

/** Look up a parsed Doc by content hash. Returns null on a miss. */
export function getCached(hash: string): Doc | null {
  return L1.get(hash) ?? SEEDS[hash] ?? null;
}

/** Record a freshly-parsed Doc for warm-instance reuse. */
export function putCached(doc: Doc): void {
  L1.set(doc.id, doc);
}

/** Stash source bytes (LRU) so a just-uploaded doc's pages can be rendered on the same instance. */
export function putBytes(hash: string, bytes: Uint8Array): void {
  BYTES.delete(hash);
  BYTES.set(hash, bytes);
  while (BYTES.size > BYTES_MAX) {
    const oldest = BYTES.keys().next().value;
    if (oldest === undefined) break;
    BYTES.delete(oldest);
  }
}

/** Source bytes for a hash, or null if this instance never held them (or evicted them). */
export function getBytes(hash: string): Uint8Array | null {
  const b = BYTES.get(hash);
  if (!b) return null;
  BYTES.delete(hash); // refresh LRU recency
  BYTES.set(hash, b);
  return b;
}

/** Result of a parse request: the Doc plus whether it came from cache. */
export interface ParseOutcome {
  doc: Doc;
  cached: boolean;
}

/**
 * Cache-first parse. If `bytes` are provided they're parsed on a miss; without bytes a miss
 * returns null (the caller should ask the browser to upload the file).
 */
export async function getOrParse(
  hash: string,
  filename: string,
  bytes?: Uint8Array,
): Promise<ParseOutcome | null> {
  const hit = getCached(hash);
  if (hit) return { doc: hit, cached: true };
  if (!bytes) return null;

  putBytes(hash, bytes); // keep bytes so the Original view can render this upload's pages
  const doc = await parseBytes(bytes, filename);
  putCached(doc);
  return { doc, cached: false };
}
