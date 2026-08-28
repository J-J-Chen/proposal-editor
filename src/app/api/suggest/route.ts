// POST /api/suggest — the proactive editorial "Refine" pass (Track G / CP7).
// Returns LLM-grounded suggestions that MERGE on top of the client-side deterministic scan
// (src/refine/scan.ts). Every `why`/`evidence` quotes the block's own text; `instruction` is
// entity-safe; results are cached per doc.id. Logic lives in src/lib/suggest.ts.
import { NextResponse } from 'next/server';
import type { SuggestRequest, SuggestResponse } from '@/lib/contracts';
import { isAiConfigured } from '@/lib/ai';
import { getSuggestions } from '@/lib/suggest';
import { validDocumentContext, validSuggestionDoc } from '@/lib/request-validation';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: SuggestRequest;
  try {
    body = (await req.json()) as SuggestRequest;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (!validSuggestionDoc(body?.doc) || !validDocumentContext(body.docContext)) {
    return NextResponse.json({ error: 'doc with id and blocks is required' }, { status: 400 });
  }

  if (!isAiConfigured()) {
    // The client deterministic scan still runs, so the Refine inbox isn't empty without us.
    return NextResponse.json(
      { error: 'AI is not configured (BUOYANT_PROXY_TOKEN is not set)' },
      { status: 503 },
    );
  }

  try {
    const { suggestions, cached } = await getSuggestions(body.doc, body.docContext);
    const res: SuggestResponse = { suggestions, cached };
    return NextResponse.json(res);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'suggest failed' },
      { status: 502 },
    );
  }
}
