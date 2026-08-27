/**
 * Typed browser → route-handler calls, against the frozen API contracts (src/lib/contracts.ts).
 * The FE never imports the mock fixture directly — it loads the document through /api/parse, so
 * it's forward-compatible when Track A's real parser + cache seed replace the stub.
 */
import type { Doc } from './types';
import type { EditRequest, EditResponse, ParseResponse } from './contracts';

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

/** POST /api/parse with the file bytes (multipart) — a cache miss on an unseen PDF. */
export async function parseByUpload(file: File): Promise<Doc> {
  const form = new FormData();
  form.append('file', file);
  form.append('filename', file.name);
  const r = await fetch('/api/parse', { method: 'POST', body: form });
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
