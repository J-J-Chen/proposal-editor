// GET /api/page/[hash]/[n] — one page of a parsed PDF, rasterised as a JPEG for the read-only
// "Original PDF" view. Content-addressed by the sha256 hash we already have, so the response is
// immutable and caches forever.
//
// Seeded fixtures (easy.pdf) are served from committed static images at /pages/<hash>/<n>.jpg and
// never reach this route. This route covers UPLOADED docs: it renders from the per-instance byte
// cache populated during parse. If the bytes aren't on this instance (cold/evicted) it returns 409
// and the client shows a gentle "preview not available" — the editable document view is unaffected.
import { getBytes, getCached } from '@/parse/cache';
import { renderPage, RENDER_SCALE } from '@/parse/render';

export const runtime = 'nodejs'; // NOT edge — mupdf needs fs/WASM
export const maxDuration = 30; // a single-page raster is ~1-2s even cold

const HEX64 = /^[0-9a-f]{64}$/;

export async function GET(
  req: Request,
  ctx: { params: Promise<{ hash: string; n: string }> }, // Next 16: params is async
): Promise<Response> {
  const { hash, n } = await ctx.params;
  const page1 = Number(n);
  if (!HEX64.test(hash) || !Number.isInteger(page1) || page1 < 1) {
    return new Response('bad request', { status: 400 });
  }
  // Only ever render a document we've actually parsed — never rasterise an arbitrary hash on GET.
  if (!getCached(hash)) return new Response('unknown document', { status: 404 });

  const bytes = getBytes(hash);
  if (!bytes) return new Response('page image not available on this instance', { status: 409 });

  const url = new URL(req.url);
  const scale = clampScale(Number(url.searchParams.get('scale')));
  try {
    const { buf, contentType } = renderPage(bytes, page1, { scale });
    return new Response(new Uint8Array(buf), {
      headers: {
        'content-type': contentType,
        'cache-control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (err) {
    console.error('[api/page] render failed:', err);
    return new Response('render failed', { status: 500 });
  }
}

function clampScale(s: number): number {
  if (!Number.isFinite(s) || s <= 0) return RENDER_SCALE;
  return Math.min(3, Math.max(1, s));
}
