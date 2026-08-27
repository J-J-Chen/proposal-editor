/**
 * Typed browser → /api/chat helper, so the FE (the chat pane) calls the agent the same way it
 * calls /api/edit (src/lib/client.ts requestEdit): one function, status codes mapped to plain,
 * reassuring messages. Mirrors the EditResult discriminated-union style.
 */
import type { ChatRequest, ChatResponse } from './contract';

export type ChatError = 'notConfigured' | 'badRequest' | 'proxyError' | 'network';

export type ChatResult =
  | { ok: true; res: ChatResponse }
  | { ok: false; kind: ChatError; message: string };

/** POST /api/chat → the assistant's reply + a batch of PROPOSED edits (never auto-applied). */
export async function requestChat(req: ChatRequest): Promise<ChatResult> {
  let r: Response;
  try {
    r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    });
  } catch (e) {
    return { ok: false, kind: 'network', message: e instanceof Error ? e.message : 'network error' };
  }

  if (r.ok) return { ok: true, res: (await r.json()) as ChatResponse };
  if (r.status === 503)
    return { ok: false, kind: 'notConfigured', message: 'The writing helper isn’t set up yet.' };
  if (r.status === 400)
    return { ok: false, kind: 'badRequest', message: 'I need a message to work with.' };
  return {
    ok: false,
    kind: 'proxyError',
    message: 'The helper isn’t responding right now. Your document is safe and nothing changed.',
  };
}
