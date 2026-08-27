// POST /api/parse — the real Track A parse endpoint.
//
// Two ways in, one response shape ({ doc, cached } — the frozen ParseResponse):
//  • JSON  { hash, filename }        → cache lookup only (instant on a seed/warm hit). On a genuine
//                                       miss returns 422 { needsUpload:true } so the browser re-POSTs
//                                       the bytes (below).
//  • multipart/form-data with `file` → hash the bytes server-side, return cache hit or full parse.
//    (Vercel Functions accept up to 100MB bodies, so the 13–18MB fixtures upload directly — no Blob.)
import { NextResponse } from 'next/server';
import type { ParseResponse } from '@/lib/contracts';
import { getOrParse } from '@/parse/cache';
import { sha256 } from '@/parse/hash';

export const runtime = 'nodejs'; // NOT edge — mupdf needs fs/WASM
export const maxDuration = 60; // cold wasm-load + extract + one LLM call
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const contentType = req.headers.get('content-type') ?? '';
  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('file');
      if (!(file instanceof File)) {
        return NextResponse.json({ error: 'missing "file" in form data' }, { status: 400 });
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const filename = (form.get('filename') as string | null) || file.name || 'upload.pdf';
      const outcome = await getOrParse(sha256(bytes), filename, bytes);
      return NextResponse.json(outcome as ParseResponse);
    }

    const body = (await req.json().catch(() => null)) as { hash?: string; filename?: string } | null;
    if (!body?.hash) {
      return NextResponse.json({ error: 'hash required' }, { status: 400 });
    }
    const outcome = await getOrParse(body.hash, body.filename ?? 'document.pdf');
    if (!outcome) {
      // Cache miss with no bytes — ask the client to upload the file (multipart, above).
      return NextResponse.json({ error: 'cache miss', needsUpload: true }, { status: 422 });
    }
    return NextResponse.json(outcome satisfies ParseResponse);
  } catch (err) {
    console.error('[api/parse] failed:', err);
    return NextResponse.json({ error: 'parse failed' }, { status: 500 });
  }
}
