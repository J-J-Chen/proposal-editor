// EXTRACT — mupdf (WASM) → RawLine[]. Server-side, Node runtime only (needs fs/WASM; never Edge).
//
// mupdf's `page.toStructuredText("preserve-whitespace").asJSON()` returns
//   { blocks: [ { type:"text", bbox, lines: [ { text, bbox:{x,y,w,h}, font:{name,weight,size,...} } ] } ] }
// Font is reported at LINE granularity — exactly what weight/caps/size heuristics want.
// Verified against easy.pdf: ProximaNova-Semibold headings come back weight:"bold" size:12,
// while ProximaNova-Light body is weight:"normal" size:12 (so "bold+caps+short" finds headings,
// never font size). See docs/fixtures.md and plans/checkpoint-2-pdf-parse.md.
import * as mupdf from 'mupdf'; // module scope → WASM instance reused across warm invocations
import type { RawLine } from './types';

/** A face is bold if mupdf says so, or the subset font name carries a bold-ish suffix. */
function isBold(fontName: string, weight: string): boolean {
  return weight === 'bold' || /-(Semi ?bold|Bold|Black|Heavy)/i.test(fontName);
}

/** Free a native mupdf handle (WASM heap hygiene) — same discipline as render.ts. */
function drop(handle: unknown): void {
  (handle as { destroy?: () => void })?.destroy?.();
}

/**
 * Extract every non-empty text line from a PDF, in mupdf's native reading order
 * (block order, then line order within a block). Native order already keeps easy.pdf's
 * two-column SERVICES list unscrambled, so we deliberately do NOT re-sort globally by y.
 *
 * `idx` is assigned later (after dedup/ordering) in the heuristics pass.
 */
export function extractLines(bytes: Uint8Array): RawLine[] {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  try {
    const out: Omit<RawLine, 'idx'>[] = [];
    const pageCount = doc.countPages();

    for (let p = 0; p < pageCount; p++) {
      const page = doc.loadPage(p);
      try {
        const st = page.toStructuredText('preserve-whitespace');
        let json: { blocks?: RawBlock[] };
        try {
          json = JSON.parse(st.asJSON());
        } finally {
          drop(st); // free the native structured-text handle promptly
        }
        for (const b of json.blocks ?? []) {
          if (b.type !== 'text') continue;
          for (const ln of b.lines ?? []) {
            const text = ln.text ?? '';
            if (!text.trim()) continue;
            const { x, y, w, h } = ln.bbox;
            out.push({
              text,
              x0: x,
              y0: y,
              x1: x + w,
              y1: y + h,
              size: ln.font?.size ?? 0,
              bold: isBold(ln.font?.name ?? '', ln.font?.weight ?? 'normal'),
              font: ln.font?.name ?? '',
              page: p + 1, // Block.page is 1-based
            });
          }
        }
      } finally {
        drop(page); // free each Page as we go (was leaking on cache-miss parse)
      }
    }

    return out.map((l, idx) => ({ ...l, idx }));
  } finally {
    drop(doc); // free the Document handle (was leaking on cache-miss parse)
  }
}

// ── Shapes we read out of mupdf's JSON (only the fields we use) ──
interface RawBBox {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface RawFont {
  name?: string;
  weight?: string;
  size?: number;
}
interface RawJsonLine {
  text?: string;
  bbox: RawBBox;
  font?: RawFont;
}
interface RawBlock {
  type: string;
  lines?: RawJsonLine[];
}
