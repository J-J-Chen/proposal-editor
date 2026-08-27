// POST /api/parse — the real Track A parse endpoint.
//
// Ways in, one response shape ({ doc, cached } — the frozen ParseResponse):
//  • JSON  { hash, filename }          → cache lookup only (instant on a seed/warm hit). On a genuine
//                                         miss returns 422 { needsUpload:true } so the browser uploads.
//  • JSON  { hash, filename, blobUrl }  → cache-first; on a miss, fetch the uploaded bytes from Blob
//                                         (private store, server-side token) and full-parse.
//  • multipart/form-data with `file`    → hash the bytes server-side, cache hit or full parse.
//
// Why Blob: Vercel Functions cap request bodies at ~4.5MB (verified on prod — the 13–18MB fixtures
// 413 a direct multipart POST), so the browser uploads bytes straight to Blob via /api/blob/upload
// and sends only the resulting URL here. easy.pdf never needs this — it's a committed seed hit.
import { NextResponse } from 'next/server';
import type { ParseResponse } from '@/lib/contracts';
import { getOrParse, getCached } from '@/parse/cache';
import { sha256 } from '@/parse/hash';
import { fetchBlobBytes } from '@/lib/blob';

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

    const body = (await req.json().catch(() => null)) as {
      hash?: string;
      filename?: string;
      blobUrl?: string;
    } | null;
    if (!body?.hash) {
      return NextResponse.json({ error: 'hash required' }, { status: 400 });
    }
    const filename = body.filename ?? 'document.pdf';
    // Cache-first: only download the uploaded blob when the hash actually misses the cache.
    let bytes: Uint8Array | undefined;
    if (body.blobUrl && !getCached(body.hash)) {
      bytes = await fetchBlobBytes(body.blobUrl);
    }
    const outcome = await getOrParse(body.hash, filename, bytes);
    if (!outcome) {
      // Cache miss with no bytes — ask the client to upload the file to Blob, then retry with blobUrl.
      return NextResponse.json({ error: 'cache miss', needsUpload: true }, { status: 422 });
    }
    return NextResponse.json(outcome satisfies ParseResponse);
  } catch (err) {
    console.error('[api/parse] failed:', err);
    return NextResponse.json({ error: 'parse failed' }, { status: 500 });
  }
}
