// POST /api/kb/search — zero-token retrieval over the reviewed five-proposal corpus.
//
// The response contains attributable candidates before any prose is generated. The client later
// sends only candidateId to /api/kb/compose; it is never trusted to round-trip factual content.
import { NextResponse } from 'next/server';
import type { KbSearchRequest, KbSearchResponse } from '@/lib/contracts';
import { KB_SEARCH_LIMITS, searchFirmProjects } from '@/kb/retrieval';

export const dynamic = 'force-dynamic';

function isOptionalBoundedString(value: unknown, max: number): value is string | undefined {
  return value === undefined || (typeof value === 'string' && value.length <= max);
}

export async function POST(req: Request) {
  let body: KbSearchRequest;
  try {
    body = (await req.json()) as KbSearchRequest;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const rawQuery = typeof body?.query === 'string' ? body.query : '';
  const query = rawQuery.trim();
  if (!query || rawQuery.length > KB_SEARCH_LIMITS.maxQueryChars) {
    return NextResponse.json(
      { error: `query is required (max ${KB_SEARCH_LIMITS.maxQueryChars} characters)` },
      { status: 400 },
    );
  }
  if (
    !isOptionalBoundedString(body.discipline, 200) ||
    !isOptionalBoundedString(body.excludeSourceDoc, 500) ||
    !isOptionalBoundedString(body.docId, 256) ||
    (body.k !== undefined &&
      (!Number.isInteger(body.k) || body.k < 1 || body.k > KB_SEARCH_LIMITS.maxK))
  ) {
    return NextResponse.json({ error: 'invalid search options' }, { status: 400 });
  }

  const res: KbSearchResponse = {
    candidates: searchFirmProjects(query, {
      discipline: body.discipline,
      excludeSourceDoc: body.excludeSourceDoc,
      k: body.k,
    }),
  };
  return NextResponse.json(res, { headers: { 'cache-control': 'no-store' } });
}
