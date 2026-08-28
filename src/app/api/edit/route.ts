// POST /api/edit — the AI half of the edit loop (Track C).
// Rewrites a single block per an instruction, preserving proper nouns / project numbers / $ /
// dates (the guardrail lives in the prompt; see src/lib/edit.ts). Structured output only, so
// no model preamble can leak into the applied text.
import { NextResponse } from 'next/server';
import type { EditRequest, EditResponse } from '@/lib/contracts';
import { isAiConfigured } from '@/lib/ai';
import { EditFidelityError, runEdit } from '@/lib/edit';
import {
  REQUEST_INPUT_LIMITS,
  validDocumentContext,
  validEditBlock,
} from '@/lib/request-validation';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: EditRequest;
  try {
    body = (await req.json()) as EditRequest;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (
    !validEditBlock(body?.block) ||
    !body.block.text.trim() ||
    typeof body.instruction !== 'string' ||
    !body.instruction.trim() ||
    body.instruction.length > REQUEST_INPUT_LIMITS.maxInstructionChars ||
    !validDocumentContext(body.docContext)
  ) {
    return NextResponse.json(
      { error: 'invalid edit request' },
      { status: 400 },
    );
  }
  if (
    body.authoritativeInstruction !== undefined &&
    (typeof body.authoritativeInstruction !== 'string' ||
      !body.authoritativeInstruction.trim() ||
      body.authoritativeInstruction.length > 2_000)
  ) {
    return NextResponse.json({ error: 'invalid authoritative instruction' }, { status: 400 });
  }
  if (
    body.referenceText !== undefined &&
    (typeof body.referenceText !== 'string' || body.referenceText.length > 12_000)
  ) {
    return NextResponse.json({ error: 'invalid reference text' }, { status: 400 });
  }

  // Public callers may not assert that arbitrary strings are trusted KB facts. The candidate
  // compose flow resolves an opaque id server-side and calls runEdit directly with its reviewed
  // record, so legitimate grounding never crosses this public request boundary as raw text.
  if (body.kbContext !== undefined && (!Array.isArray(body.kbContext) || body.kbContext.length > 0)) {
    return NextResponse.json(
      { error: 'kbContext is server-managed; select a knowledge-base candidate first' },
      { status: 400 },
    );
  }

  if (!isAiConfigured()) {
    return NextResponse.json(
      { error: 'AI is not configured (BUOYANT_PROXY_TOKEN is not set)' },
      { status: 503 },
    );
  }

  try {
    const res: EditResponse = await runEdit(body, {
      authoritativeInstruction: body.authoritativeInstruction ?? body.instruction,
    });
    return NextResponse.json(res);
  } catch (err) {
    if (err instanceof EditFidelityError) {
      return NextResponse.json(
        {
          error: err.message,
          code: 'fact_entity_fidelity_failed',
          violations: err.gate.violations,
        },
        { status: 422 },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'edit failed' },
      { status: 502 },
    );
  }
}
