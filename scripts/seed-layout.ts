// SEED LAYOUT — pre-bake each block's location on the page, for the "edit on the PDF" overlay.
//
// Deterministic + LLM-free: re-extracts the PDF's text lines (with bboxes), loads the ALREADY
// committed parse seed (Doc), and maps each block → the run of lines that make it up by matching
// the block's normalized text as a contiguous substring of the joined line text. Emits fractional
// rects (0..1 of page W/H, so scale-independent) keyed by the stable block id, to
// src/parse-cache/layout.ts. Does NOT touch the seed Doc (no re-parse, no LLM, no changed ids).
//
// Run:  PROPOSALS_DIR=/path/to/proposals npm run seed:layout            # default easy.pdf
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import * as mupdf from 'mupdf';
import { extractLines } from '@/parse/extract';
import { sha256 } from '@/parse/hash';
import type { Doc } from '@/lib/types';

const FIXTURES = process.env.PROPOSALS_DIR ?? resolve('proposals');
const CACHE = resolve('src/parse-cache');
const OUT = resolve('src/parse-cache/layout.ts');

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

interface Rect { page: number; x: number; y: number; w: number; h: number; size: number }

const targets = process.argv.slice(2);
const files = targets.length ? targets : ['easy.pdf'];
const LAYOUT: Record<string, Record<string, Rect>> = {};

for (const t of files) {
  const path = t.includes('/') ? t : join(FIXTURES, t);
  const filename = basename(path);
  const bytes = new Uint8Array(readFileSync(path));
  const hash = sha256(bytes);
  const doc: Doc = JSON.parse(readFileSync(join(CACHE, `${hash}.json`), 'utf8'));
  const lines = extractLines(bytes);

  // Real page dimensions (points) per 1-based page.
  const mdoc = mupdf.Document.openDocument(bytes, 'application/pdf');
  const dims: Record<number, { w: number; h: number }> = {};
  for (let p = 0; p < mdoc.countPages(); p++) {
    const b = mdoc.loadPage(p).getBounds();
    dims[p + 1] = { w: b[2] - b[0], h: b[3] - b[1] };
  }

  // One normalized haystack of all line texts joined by spaces + a per-line [start,end) char span.
  const spans: { s: number; e: number; i: number }[] = [];
  let hay = '';
  lines.forEach((ln, i) => {
    const n = norm(ln.text);
    if (!n) return;
    const s = hay.length ? hay.length + 1 : 0;
    hay = hay ? `${hay} ${n}` : n;
    spans.push({ s, e: hay.length, i });
  });

  // Some designed personnel lists are extracted column-first: all names arrive first, followed by
  // all titles. The parsed block correctly joins each name with the title directly below it, so it
  // cannot be found as a contiguous substring in `hay`. Recover those stacked list items by
  // following matching text fragments down the same page, preferring the nearest aligned line.
  const stackedListLines = (block: Doc['blocks'][number]): typeof lines => {
    if (block.type !== 'list-item') return [];
    const pageLines = lines.filter((line) => line.page === block.page && norm(line.text));
    const chosen: typeof lines = [];
    let remaining = norm(block.text);

    while (remaining && chosen.length < 4) {
      const previous = chosen.at(-1);
      const candidates = pageLines
        .filter((line) => {
          if (chosen.includes(line)) return false;
          const text = norm(line.text);
          if (remaining !== text && !remaining.startsWith(`${text} `)) return false;
          if (!previous) return true;
          const verticalGap = line.y0 - previous.y1;
          return verticalGap >= -1 && verticalGap <= 36;
        })
        .sort((a, b) => {
          if (!previous) return norm(b.text).length - norm(a.text).length;
          const distance = (line: typeof lines[number]) =>
            Math.abs(line.x0 - previous.x0) * 2 + Math.max(0, line.y0 - previous.y1);
          return distance(a) - distance(b);
        });
      const next = candidates[0];
      if (!next) return [];
      chosen.push(next);
      remaining = remaining.slice(norm(next.text).length).trim();
    }

    return remaining ? [] : chosen;
  };

  const map: Record<string, Rect> = {};
  let cursor = 0;
  let matched = 0;
  for (const block of doc.blocks) {
    const bn = norm(block.text);
    if (!bn) continue;
    let at = hay.indexOf(bn, cursor);
    if (at < 0) at = hay.indexOf(bn); // fall back to a global search (out-of-order dedup)
    let endChar: number | undefined;
    let grpLines: typeof lines | undefined;
    if (at >= 0) {
      endChar = at + bn.length;
    } else {
      // last resort: bound by the block's first ~18 and last ~18 normalized chars
      const head = bn.slice(0, 18);
      const tail = bn.slice(-18);
      const a = hay.indexOf(head, cursor);
      const b = a >= 0 ? hay.indexOf(tail, a) : -1;
      if (a >= 0 && b >= 0) {
        at = a;
        endChar = b + tail.length;
      } else {
        grpLines = stackedListLines(block);
        if (grpLines.length === 0) continue;
      }
    }
    if (endChar !== undefined) {
      grpLines = spans.filter((sp) => sp.e > at && sp.s < endChar).map((sp) => lines[sp.i]);
      cursor = endChar;
    }
    if (!grpLines?.length) continue;

    // Union the bboxes on the block's dominant page.
    const byPage = new Map<number, typeof lines>();
    for (const l of grpLines) {
      const arr = byPage.get(l.page) ?? [];
      arr.push(l);
      byPage.set(l.page, arr);
    }
    const dominant = [...byPage.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    if (!dominant) continue;
    const page = dominant[0];
    const g = byPage.get(page)!;
    const x0 = Math.min(...g.map((l) => l.x0));
    const y0 = Math.min(...g.map((l) => l.y0));
    const x1 = Math.max(...g.map((l) => l.x1));
    const y1 = Math.max(...g.map((l) => l.y1));
    const sizes = g.map((l) => l.size).filter(Boolean).sort((a, b) => a - b);
    const size = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 12;
    const { w: PW, h: PH } = dims[page];
    map[block.id] = {
      page,
      x: +(x0 / PW).toFixed(4),
      y: +(y0 / PH).toFixed(4),
      w: +((x1 - x0) / PW).toFixed(4),
      h: +((y1 - y0) / PH).toFixed(4),
      size: +(size / PH).toFixed(4),
    };
    matched++;
  }
  LAYOUT[hash] = map;
  console.log(`${filename} (${hash.slice(0, 8)}…): mapped ${matched}/${doc.blocks.length} blocks`);
}

const body =
  `// GENERATED by scripts/seed-layout.ts — do not edit by hand.\n` +
  `// Each block's location on its page (fractions 0..1 of page W/H, plus font size as a fraction of\n` +
  `// page height), keyed by the stable block id. Powers the "edit on the PDF" overlay: click a\n` +
  `// paragraph on the page, and patch an applied edit in place at its rect.\n` +
  `export interface BlockRect { page: number; x: number; y: number; w: number; h: number; size: number }\n` +
  `export const LAYOUT: Record<string, Record<string, BlockRect>> = ${JSON.stringify(LAYOUT, null, 2)};\n`;
writeFileSync(OUT, body);
console.log(`\nwrote ${OUT}`);
