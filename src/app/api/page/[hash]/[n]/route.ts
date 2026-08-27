// GET /api/page/[hash]/[n] — one page of a parsed PDF, rasterised as a JPEG for the read-only
// "Original PDF" view. Content-addressed by the sha256 hash (the hash is the capability).
//
// Seeded fixtures (easy.pdf) are served from committed static images at /pages/<hash>/<n>.jpg and
// never reach this route. This route covers UPLOADED docs. Source bytes live in a per-instance
// cache populated during parse, so a page request that lands on a DIFFERENT warm instance than the
// one that parsed used to 404/409. It now self-heals from the uploaded doc's private Blob when the
// client passes its URL (?blob=…), so the Original view survives cross-instance routing.
import { getBytes, getCached, putBytes } from '@/parse/cache';
import { renderPage, RENDER_SCALE } from '@/parse/render';
import { fetchBlobBytes } from '@/lib/blob';
import { sha256 } from '@/parse/hash';

export const runtime = 'nodejs'; // NOT edge — mupdf needs fs/WASM
export const maxDuration = 30; // a single-page raster is ~1-2s even cold; +blob fetch on self-heal

const HEX64 = /^[0-9a-f]{64}$/;

/** Only self-heal from a Vercel Blob store URL — never let ?blob= point the server at an arbitrary host. */
function isBlobStoreUrl(raw: string): boolean {
  try {
    return new URL(raw).hostname.endsWith('.blob.vercel-storage.com');
  } catch {
    return false;
  }
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ hash: string; n: string }> }, // Next 16: params is async
): Promise<Response> {
  const { hash, n } = await ctx.params;
  const page1 = Number(n);
  if (!HEX64.test(hash) || !Number.isInteger(page1) || page1 < 1) {
    return new Response('bad request', { status: 400 });
  }

  const url = new URL(req.url);

  // 1. Warm same-instance path (unchanged): bytes cached from this instance's own parse.
  let bytes = getBytes(hash);

  // 2. Cross-instance self-heal: bytes (and the Doc) are absent on this instance. If the client
  //    passed the uploaded doc's private Blob URL, re-fetch the source bytes and verify
  //    sha256(bytes) === hash BEFORE rendering — this preserves "never rasterise an arbitrary
  //    hash" (an attacker would need a readable blob whose bytes hash to the path hash, i.e. their
  //    own upload). Cache the healed bytes so subsequent pages on this instance are warm.
  if (!bytes) {
    const blobUrl = url.searchParams.get('blob');
    if (blobUrl && isBlobStoreUrl(blobUrl)) {
      try {
        const fetched = await fetchBlobBytes(blobUrl);
        if (sha256(fetched) === hash) {
          putBytes(hash, fetched);
          bytes = fetched;
        } else {
          console.warn('[api/page] blob hash mismatch — refusing to render');
        }
      } catch (err) {
        console.error('[api/page] blob self-heal failed:', err);
      }
    }
  }

  // 3. No bytes and no usable blob → distinguish known-but-not-here (409) from unknown (404).
  if (!bytes) {
    return getCached(hash)
      ? new Response('page image not available on this instance', { status: 409 })
      : new Response('unknown document', { status: 404 });
  }

  const scale = clampScale(Number(url.searchParams.get('scale')));
  try {
    const { buf, contentType } = renderPage(bytes, page1, { scale });
    return new Response(new Uint8Array(buf), {
      headers: {
        'content-type': contentType,
        // `private`, not `public`: uploaded proposals are confidential — cache only in the
        // requesting browser, never shared/CDN caches. (Seeded fixtures are public static images.)
        'cache-control': 'private, max-age=31536000, immutable',
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
