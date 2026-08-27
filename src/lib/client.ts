/**
 * Typed browser → route-handler calls, against the frozen API contracts (src/lib/contracts.ts).
 * The FE never imports the mock fixture directly — it loads the document through /api/parse, so
 * it's forward-compatible when Track A's real parser + cache seed replace the stub.
 */
import { upload } from '@vercel/blob/client';
import type { Doc } from './types';
import type { EditRequest, EditResponse, ParseResponse, SuggestResponse } from './contracts';
import type { Suggestion } from '@/refine/scan';

export type ParseByHash = { doc: Doc } | { needsUpload: true };

/**
 * POST /api/parse by content hash — instant on a seed/warm cache hit. A genuine miss returns
 * 422 { needsUpload:true }, which the caller answers by uploading the bytes (parseByUpload).
 */
export async function parseByHash(hash: string, filename: string): Promise<ParseByHash> {
  const r = await fetch('/api/parse', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hash, filename }),
  });
  if (r.status === 422) return { needsUpload: true };
  if (!r.ok) throw new Error(`Couldn't read the proposal (status ${r.status}).`);
  const data = (await r.json()) as ParseResponse;
  return { doc: data.doc };
}

/**
 * A genuine cache miss on an unseen PDF. The file can be larger than the serverless function's
 * request-body cap, so we don't stream the bytes through /api/parse. Instead we push them straight
 * to Blob storage via a server-issued (private) client token — /api/blob/upload signs it and
 * restricts to application/pdf — then hand /api/parse the blob URL to fetch + parse server-side.
 * We still send the sha256 `hash` so a since-seeded/warm file short-circuits to cache, no upload.
 */
export async function parseByUpload(file: File, hash: string): Promise<Doc> {
  const blob = await upload(file.name, file, {
    access: 'private',
    handleUploadUrl: '/api/blob/upload',
  });
  const r = await fetch('/api/parse', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hash, filename: file.name, blobUrl: blob.url }),
  });
  if (!r.ok) throw new Error(`Couldn't read the proposal (status ${r.status}).`);
  const data = (await r.json()) as ParseResponse;
  return data.doc;
}

export type EditError = 'notConfigured' | 'badRequest' | 'proxyError' | 'network';

export type EditResult =
  | { ok: true; res: EditResponse }
  | { ok: false; kind: EditError; message: string };

/** POST /api/edit → the AI rewrite of one block, with the status codes mapped to plain messages. */
export async function requestEdit(req: EditRequest): Promise<EditResult> {
  let r: Response;
  try {
    r = await fetch('/api/edit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    });
  } catch (e) {
    return { ok: false, kind: 'network', message: e instanceof Error ? e.message : 'network error' };
  }

  if (r.ok) return { ok: true, res: (await r.json()) as EditResponse };
  if (r.status === 503)
    return { ok: false, kind: 'notConfigured', message: 'The writing helper isn’t set up yet.' };
  if (r.status === 400)
    return { ok: false, kind: 'badRequest', message: 'There’s nothing to change here.' };
  return {
    ok: false,
    kind: 'proxyError',
    message: 'The helper isn’t responding right now. Your document is safe and nothing changed.',
  };
}

/**
 * POST /api/suggest → the LLM editorial pass for "Check my proposal". Returns suggestions in the
 * same shape the RefinePanel renders (an LlmSuggestion is structurally a Suggestion — its category
 * is a subset of RefineCategory). This is purely ADDITIVE on top of the deterministic client scan,
 * so any failure (unconfigured 503, proxy 5xx, network) degrades SILENTLY to [] — the instant
 * client-scan floor still stands and the user sees no error.
 */
export async function requestSuggestions(doc: Doc): Promise<Suggestion[]> {
  try {
    const r = await fetch('/api/suggest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ doc }),
    });
    if (!r.ok) return [];
    const data = (await r.json()) as SuggestResponse;
    return data.suggestions;
  } catch {
    return [];
  }
}
