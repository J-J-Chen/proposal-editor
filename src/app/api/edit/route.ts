// POST /api/edit — the AI half of the edit loop (Track C).
// Rewrites a single block per an instruction, preserving proper nouns / project numbers / $ /
// dates (the guardrail lives in the prompt; see src/lib/edit.ts). Structured output only, so
// no model preamble can leak into the applied text.
import { NextResponse } from 'next/server';
import type { EditRequest, EditResponse } from '@/lib/contracts';
import { isAiConfigured } from '@/lib/ai';
import { runEdit } from '@/lib/edit';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!isAiConfigured()) {
    return NextResponse.json(
      { error: 'AI is not configured (BUOYANT_PROXY_TOKEN is not set)' },
      { status: 503 },
    );
  }

  let body: EditRequest;
  try {
    body = (await req.json()) as EditRequest;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (!body?.block?.text?.trim() || !body?.instruction?.trim()) {
    return NextResponse.json(
      { error: 'block.text and instruction are required' },
      { status: 400 },
    );
  }

  try {
    const res: EditResponse = await runEdit(body);
    return NextResponse.json(res);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'edit failed' },
      { status: 502 },
    );
  }
}
