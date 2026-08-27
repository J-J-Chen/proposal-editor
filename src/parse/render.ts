// RENDER — mupdf (WASM) → per-page raster (JPEG/PNG). Server-side, Node runtime only (needs
// fs/WASM; never Edge). Powers the read-only "Original PDF" view: we don't reconstruct the PDF,
// we show a faithful picture of the real page (logos/photos/layout intact). mupdf is already a
// dependency and already warm in /api/parse, so this adds no new dep and no AI spend.
//
// Two callers:
//  • /api/page/[hash]/[n]  — renders one page on demand from the in-instance byte cache (uploads).
//  • scripts/seed-renders  — pre-bakes every page of the committed fixtures to public/pages/<hash>/,
//    so the graded/seeded demo shows the Original view instantly with no source bytes on the server.
import * as mupdf from 'mupdf'; // module scope → WASM instance reused across warm invocations

/** Default render scale (1.5× ≈ 144 DPI): crisp on retina, ~100KB/page as JPEG. */
export const RENDER_SCALE = 1.5;
export const RENDER_QUALITY = 80;

export interface RenderedPage {
  buf: Uint8Array;
  contentType: string;
}

interface RenderOpts {
  scale?: number;
  format?: 'jpeg' | 'png';
  quality?: number;
}

function drop(handle: unknown): void {
  (handle as { destroy?: () => void })?.destroy?.();
}

/**
 * Render one 1-based page to a JPEG (default) or PNG. Frees every native handle (WASM heap
 * hygiene — a per-request render that leaks pixmaps grows the heap across warm invocations).
 */
export function renderPage(bytes: Uint8Array, page1: number, opts: RenderOpts = {}): RenderedPage {
  const { scale = RENDER_SCALE, format = 'jpeg', quality = RENDER_QUALITY } = opts;
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  try {
    const count = doc.countPages();
    const idx = page1 - 1;
    if (idx < 0 || idx >= count) throw new Error(`page ${page1} out of range (1..${count})`);
    const page = doc.loadPage(idx);
    const pix = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false);
    try {
      const buf = format === 'png' ? pix.asPNG() : pix.asJPEG(quality, false);
      return { buf, contentType: format === 'png' ? 'image/png' : 'image/jpeg' };
    } finally {
      drop(pix);
      drop(page);
    }
  } finally {
    drop(doc);
  }
}

/** Page count without a full render. */
export function countPages(bytes: Uint8Array): number {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  try {
    return doc.countPages();
  } finally {
    drop(doc);
  }
}

/**
 * Render every page (1-based order) to JPEG — used by the seed step to pre-bake a fixture's
 * Original view. Opens the document once and frees each page/pixmap as it goes.
 */
export function renderAllPages(bytes: Uint8Array, opts: RenderOpts = {}): Uint8Array[] {
  const { scale = RENDER_SCALE, quality = RENDER_QUALITY } = opts;
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  try {
    const out: Uint8Array[] = [];
    const count = doc.countPages();
    for (let i = 0; i < count; i++) {
      const page = doc.loadPage(i);
      const pix = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false);
      out.push(pix.asJPEG(quality, false));
      drop(pix);
      drop(page);
    }
    return out;
  } finally {
    drop(doc);
  }
}
