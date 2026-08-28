// POST /api/kb/compose — resolve one human-selected corpus candidate and prepare a reviewed insert.
//
// This endpoint does not apply anything. It returns an all-add proposal for the existing diff /
// Keep flow. A deterministic source-only paragraph is returned when AI is unavailable or fails a
// fidelity gate, so this endpoint intentionally does not require AI configuration.
import { NextResponse } from 'next/server';
import type { KbComposeRequest } from '@/lib/contracts';
import { composeKbExperience, resolveKbComposeCandidate } from '@/lib/kb-compose';
import {
  REQUEST_INPUT_LIMITS,
  validDocumentContext,
  validEditBlock,
} from '@/lib/request-validation';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function validRequest(body: KbComposeRequest): boolean {
  return Boolean(
    body &&
      typeof body.candidateId === 'string' &&
      body.candidateId.length > 0 &&
      body.candidateId.length <= 120 &&
      validEditBlock(body.target) &&
      Number.isInteger(body.target.page) &&
      body.target.page > 0 &&
      body.target.id.length <= REQUEST_INPUT_LIMITS.maxBlockIdChars &&
      validDocumentContext(body.docContext, true)
  );
}

export async function POST(req: Request) {
  let body: KbComposeRequest;
  try {
    body = (await req.json()) as KbComposeRequest;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (!validRequest(body)) {
    return NextResponse.json({ error: 'invalid compose request' }, { status: 400 });
  }

  const project = resolveKbComposeCandidate(body.candidateId);
  if (!project) {
    return NextResponse.json({ error: 'candidate not found; search again' }, { status: 404 });
  }

  try {
    return NextResponse.json(await composeKbExperience(body, project), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'compose failed' },
      { status: 500 },
    );
  }
}
