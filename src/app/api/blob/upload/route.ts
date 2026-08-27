// POST /api/blob/upload — Vercel Blob client-upload token handler (handleUpload).
//
// The browser (@vercel/blob/client `upload(pathname, file, { access:'private', handleUploadUrl })`)
// calls this route to get a short-lived, scoped upload token, then uploads the PDF bytes DIRECTLY
// to Blob — bypassing the serverless function's request-body cap (verified ~4.5MB on prod, which
// 413s the 13–18MB fixtures). The FE then POSTs the resulting blob URL to /api/parse.
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // covers the 18MB fixtures with margin

export async function POST(request: Request): Promise<Response> {
  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  try {
    // Token read from BLOB_READ_WRITE_TOKEN in the environment.
    const result = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ['application/pdf'],
        maximumSizeInBytes: MAX_UPLOAD_BYTES,
        addRandomSuffix: true,
      }),
      // Parsing happens on the follow-up POST /api/parse {blobUrl}, so nothing to do here.
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
