// STUB — replaced by Track C (real AI edit via the Buoyant proxy + entity guardrail).
// Echoes a visibly-changed string so the FE edit-loop (Track D) can exercise diff/apply/undo.
import { NextResponse } from 'next/server';
import type { EditRequest, EditResponse } from '@/lib/contracts';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = (await req.json()) as EditRequest;
  const res: EditResponse = {
    newText: `${body.block.text} [stubbed edit: ${body.instruction}]`,
    rationale: 'stub response — replaced by Track C (real /api/edit)',
  };
  return NextResponse.json(res);
}
