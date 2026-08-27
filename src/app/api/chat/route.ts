// POST /api/chat — the always-available agentic chat (multi-block edits).
//
// The user talks to the assistant (works with NOTHING selected) and can make sweeping requests.
// The agent PLANS a minimal set of blocks, rewrites each through the SAME guardrail as /api/edit
// (entity-preserving, forced-tool structured output), runs a deterministic entity-fidelity gate on
// every one, and returns the batch as PROPOSALS. It never applies: the FE reviews + Keeps/Discards
// as one grouped, undo-able transaction. See src/lib/agent + docs/agentic-chat.md.
import { NextResponse } from 'next/server';
import { isAiConfigured } from '@/lib/ai';
import { runAgent } from '@/lib/agent';
import type { ChatRequest, ChatResponse } from '@/lib/agent/contract';

export const dynamic = 'force-dynamic';
// A sweeping request fans out to one guarded edit per block; give the batch room to finish.
export const maxDuration = 120;

export async function POST(req: Request) {
  if (!isAiConfigured()) {
    return NextResponse.json(
      { error: 'AI is not configured (BUOYANT_PROXY_TOKEN is not set)' },
      { status: 503 },
    );
  }

  let body: ChatRequest;
  try {
    body = (await req.json()) as ChatRequest;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (!body?.message?.trim()) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 });
  }
  if (!Array.isArray(body.blocks)) {
    return NextResponse.json({ error: 'blocks[] is required' }, { status: 400 });
  }

  try {
    const res: ChatResponse = await runAgent(body);
    return NextResponse.json(res);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'chat failed' },
      { status: 502 },
    );
  }
}
