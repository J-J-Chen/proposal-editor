/**
 * Typed browser → route-handler calls, against the frozen API contracts (src/lib/contracts.ts).
 * The FE never imports the mock fixture directly — it loads the document through /api/parse, so
 * it's forward-compatible when Track A's real parser + cache seed replace the stub.
 */
import type { Doc } from './types';
import type {
  EditRequest,
  EditResponse,
  ParseRequest,
  ParseResponse,
} from './contracts';

/** POST /api/parse → the structured document (stub returns the fixture; real route caches by hash). */
export async function parseDoc(req: ParseRequest): Promise<Doc> {
  const r = await fetch('/api/parse', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
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
