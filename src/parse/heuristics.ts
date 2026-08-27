// HEURISTICS — deterministic structuring over RawLine[] (runs before the LLM).
//
// Owns: shadow/dup removal, header/footer detection, provisional per-line labels, and a
// SAFE fallback grouping used only when the LLM/proxy is unavailable. Reading order is
// mupdf's native order (already correct for easy.pdf's two-column list — we do NOT re-sort).
//
// Grounded in easy.pdf recon (see docs/fixtures.md): headings are bold+ALL-CAPS+short at BODY
// size (never bigger); list items are indented short lines (no bullet glyph); the cover and
// section banners carry interleaved shadow copies of the same text at ~1–7px offsets.
import type { AnnotatedLine, BlockRef, ProvLabel, RawLine } from './types';

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();

const isAllCaps = (s: string): boolean => /[A-Z]/.test(s) && s === s.toUpperCase();

/** bullet / number / dash list markers at the start of a line. */
const LIST_MARKER = /^\s*(?:[•▪◦‣·*–—-]|\d+[.)]|[a-z][.)])\s+/i;

/**
 * Drop interleaved shadow/duplicate lines: same normalized text within a small positional
 * tolerance on the same page. Tolerance-based (not a fixed grid) so it catches both the ~1px
 * exact dupes and the ~7px drop-shadow offset without merging legitimately distinct lines.
 * Keeps the FIRST occurrence; re-indexes the survivors 0..N.
 */
export function dedupe(lines: RawLine[], tol = 12): RawLine[] {
  const kept: RawLine[] = [];
  for (const ln of lines) {
    const t = norm(ln.text);
    const dup = kept.some(
      (k) =>
        k.page === ln.page &&
        norm(k.text) === t &&
        Math.abs(k.x0 - ln.x0) <= tol &&
        Math.abs(k.y0 - ln.y0) <= tol,
    );
    if (!dup) kept.push(ln);
  }
  return kept.map((l, idx) => ({ ...l, idx }));
}

/** x-gap (pt) that separates one text column from the next; indents (~20pt) stay within a column. */
const COLUMN_GAP = 48;

/**
 * Reading order = column-aware, per page. mupdf's native order emits graphic-layout regions out
 * of reading order — e.g. easy.pdf p7's org chart emits every NAME then every TITLE, so a
 * name↔title 2-column region linearizes as "Scott… max… Jim… President Vice-President …". We
 * cluster each page's lines into columns by gaps in their left-x, then read each column
 * top-to-bottom, columns left-to-right. This pairs each name with the title directly beneath it
 * AND keeps genuine parallel-column lists (p2 SERVICES) un-scrambled — where a naive global y-sort
 * would interleave the columns. Single-column pages fall back to a plain top-to-bottom sort.
 * Re-indexes the result 0..N (the LLM references these indices).
 */
export function orderLines(lines: RawLine[]): RawLine[] {
  const canonical = collectFurniture(lines);
  const isFurn = (l: RawLine) => isFurniture(l.text, canonical);

  const byPage = new Map<number, RawLine[]>();
  for (const l of lines) (byPage.get(l.page) ?? byPage.set(l.page, []).get(l.page)!).push(l);

  const out: RawLine[] = [];
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    out.push(...orderPage(byPage.get(page)!, isFurn));
  }
  return out.map((l, idx) => ({ ...l, idx }));
}

function orderPage(pl: RawLine[], isFurn: (l: RawLine) => boolean): RawLine[] {
  const byY = (a: RawLine, b: RawLine) => a.y0 - b.y0 || a.x0 - b.x0;
  if (pl.length < 4) return [...pl].sort(byY);

  // Cluster left-x values into columns by gaps larger than COLUMN_GAP.
  const xs = pl.map((l) => l.x0).sort((a, b) => a - b);
  const colEnd: number[] = []; // max x0 of each column cluster
  for (let i = 1; i <= xs.length; i++) {
    if (i === xs.length || xs[i] - xs[i - 1] > COLUMN_GAP) colEnd.push(xs[i - 1]);
  }
  if (colEnd.length <= 1) return [...pl].sort(byY); // single column → plain top-to-bottom

  const colOf = (x: number) => {
    for (let c = 0; c < colEnd.length; c++) if (x <= colEnd[c]) return c;
    return colEnd.length - 1;
  };
  // Sink repeated page furniture (a centered address/phone footer forms its own narrow x-cluster
  // between two real columns) below the content columns so it never splits a multi-column list.
  // Keyed on furniture DETECTION, not y-position — position can't tell footer furniture from real
  // bottom-of-page content (e.g. p7's last org-chart entry sits as low as the footer).
  const sink = (l: RawLine) => (isFurn(l) ? 1 : 0);
  const columnSort = (arr: RawLine[]) =>
    [...arr].sort(
      (a, b) => sink(a) - sink(b) || colOf(a.x0) - colOf(b.x0) || a.y0 - b.y0 || a.x0 - b.x0,
    );

  // Band segmentation. The column sort's flaw is that column index outranks y, so a short line
  // that owns its own x-cluster and sits clear of the real columns — a CENTERED HEADING above the
  // body — is emitted after the body column instead of above it (the LLM can't repair it: it must
  // cover lines in the supplied order). Detect such "separator" lines and read the page as bands
  // top-to-bottom, column-sorting only within each genuine multi-column region.
  //
  // A separator is a lone content line (its column holds exactly ONE non-furniture line) whose
  // y-range clears every genuine multi-line column. This is deliberately narrow so it is a NO-OP
  // for real multi-column layouts: easy.pdf p2 (2-col SERVICES) and p7 (org chart) have no lone
  // content columns, so they fall through to the exact column sort below, byte-for-byte unchanged.
  const content = pl.filter((l) => !isFurn(l));
  const perCol = new Map<number, RawLine[]>();
  for (const l of content) (perCol.get(colOf(l.x0)) ?? perCol.set(colOf(l.x0), []).get(colOf(l.x0))!).push(l);
  const multiRanges: [number, number][] = [];
  for (const ls of perCol.values()) {
    if (ls.length >= 2) multiRanges.push([Math.min(...ls.map((l) => l.y0)), Math.max(...ls.map((l) => l.y1))]);
  }
  const overlapsMulti = (l: RawLine) => multiRanges.some(([y0, y1]) => l.y1 > y0 && l.y0 < y1);
  // Only normal, horizontally-set text can be a separator. Rotated/vertical text (e.g. hard.pdf's
  // sideways "Thank You" cover word) has a taller-than-wide bbox and no reliable y reading order,
  // so leaving it to the column sort keeps its prior placement.
  const isHorizontal = (l: RawLine) => l.x1 - l.x0 >= l.y1 - l.y0;
  const sepIdx = new Set(
    content
      .filter((l) => isHorizontal(l) && perCol.get(colOf(l.x0))!.length === 1 && !overlapsMulti(l))
      .map((l) => l.idx),
  );

  if (sepIdx.size === 0) return columnSort(pl); // no separators → exact prior behaviour

  // Walk the content top-to-bottom: separators are their own band; runs of the remaining lines are
  // genuine multi-column regions (column-sorted). Furniture always sinks to the end.
  const out: RawLine[] = [];
  let region: RawLine[] = [];
  for (const l of [...content].sort(byY)) {
    if (sepIdx.has(l.idx)) {
      if (region.length) {
        out.push(...columnSort(region));
        region = [];
      }
      out.push(l);
    } else {
      region.push(l);
    }
  }
  if (region.length) out.push(...columnSort(region));
  out.push(...pl.filter((l) => isFurn(l)).sort(byY));
  return out;
}

const isPageNumber = (s: string): boolean => /^\s*(?:page\s+)?\d{1,3}\s*$/i.test(s);
/** A whole line that is just a phone number (address/contact furniture). */
const isPhone = (s: string): boolean =>
  /^\+?\d{0,2}[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$/.test(s.trim());
/** Normalize for furniture matching: drop separators so "A | B", "A, B" and "A B" compare equal. */
const stripSep = (s: string): string => norm(s).replace(/[|,]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Build the set of repeated page "furniture" (header/footer/address) strings, separator-agnostic,
 * from the top/bottom band. Used to demote furniture to `other` instead of letting it leak in as
 * body — but never hard-deleted (a hidden fixture might surface an entity only in a footer).
 * Robust to the SAME furniture appearing in different forms across pages: piped ("A | B | C"),
 * space-joined, or split into separate lines (easy.pdf p1's address).
 */
function collectFurniture(lines: RawLine[]): Set<string> {
  const maxY = Math.max(1, ...lines.map((l) => l.y1));
  const topBand = maxY * 0.08;
  const botBand = maxY * 0.88;
  const bandPages = new Map<string, Set<number>>();
  for (const l of lines) {
    if (l.y0 < topBand || l.y0 > botBand) {
      const k = stripSep(l.text);
      if (k) (bandPages.get(k) ?? bandPages.set(k, new Set()).get(k)!).add(l.page);
    }
  }
  const canonical = new Set<string>();
  for (const [k, pages] of bandPages) if (pages.size >= 2) canonical.add(k);
  return canonical;
}

/** A line is furniture if it's a page number, a standalone phone, or (a fragment of) a canonical. */
function isFurniture(text: string, canonical: Set<string>): boolean {
  if (isPageNumber(text) || isPhone(text)) return true;
  const t = stripSep(text);
  if (!t) return false;
  if (canonical.has(t)) return true;
  // a split fragment of a repeated furniture line (e.g. the address on its own line on the cover)
  if (t.length >= 8) for (const c of canonical) if (c.includes(t)) return true;
  return false;
}

/** Per-page "body left edge" = the leftmost non-furniture line x0 (used to detect indentation). */
function bodyLeftByPage(lines: RawLine[], chromeIdx: Set<number>): Map<number, number> {
  const byPage = new Map<number, number[]>();
  for (const l of lines) {
    if (chromeIdx.has(l.idx)) continue;
    (byPage.get(l.page) ?? byPage.set(l.page, []).get(l.page)!).push(l.x0);
  }
  const out = new Map<number, number>();
  for (const [p, xs] of byPage) out.set(p, Math.min(...xs));
  return out;
}

/** Attach per-line signals + a provisional label. The LLM refines boundaries/levels from here. */
export function annotate(lines: RawLine[]): AnnotatedLine[] {
  const canonical = collectFurniture(lines);
  const chromeIdx = new Set(lines.filter((l) => isFurniture(l.text, canonical)).map((l) => l.idx));
  const bodyLeft = bodyLeftByPage(lines, chromeIdx);

  return lines.map((l) => {
    const text = l.text.trim();
    const caps = isAllCaps(text);
    const words = text.split(/\s+/).length;
    const isChrome = chromeIdx.has(l.idx);
    const indent = l.x0 - (bodyLeft.get(l.page) ?? l.x0);

    let label: ProvLabel;
    if (isChrome) {
      label = 'other';
    } else if (l.bold && caps && words <= 6) {
      // OUR FIRM / SERVICES / RELEVANT EXPERIENCE / YOUR TEAM — bold+caps+short at body size.
      label = 'heading';
    } else if (LIST_MARKER.test(l.text) || (indent > 14 && words <= 12)) {
      // indented short lines (services list, city list) — no bullet glyph in easy.pdf.
      label = 'list-item';
    } else {
      label = 'paragraph';
    }
    return { ...l, label, caps, chrome: isChrome };
  });
}

/** Compact numbered representation handed to the LLM. Text is verbatim after `|`. */
export function toNumberedInput(lines: AnnotatedLine[]): string {
  return lines
    .map(
      (l) =>
        `${l.idx} p${l.page} ${l.bold ? 'B' : '.'}${l.caps ? 'C' : '.'} x${Math.round(l.x0)} ` +
        `${l.label} | ${l.text.trim()}`,
    )
    .join('\n');
}

/**
 * SAFE deterministic fallback grouping — used only if the LLM pass fails. Never scrambles and
 * never splits mid-sentence: headings and list items are their own blocks; consecutive paragraph
 * lines on a page merge into one paragraph; consecutive chrome lines collapse to one `other`.
 * (Coarser than the LLM's boundaries by design — correctness over granularity when degraded.)
 */
export function heuristicBlocks(lines: AnnotatedLine[]): BlockRef[] {
  const refs: BlockRef[] = [];
  let run: { label: ProvLabel; page: number; start: number; end: number } | null = null;
  const flush = () => {
    if (!run) return;
    const type = run.label === 'other' ? 'other' : run.label;
    refs.push({
      type,
      level: type === 'heading' ? 1 : null,
      startLine: run.start,
      endLine: run.end,
    });
    run = null;
  };

  for (const l of lines) {
    const mergeable = l.label === 'paragraph' || l.label === 'other';
    if (mergeable && run && run.label === l.label && run.page === l.page) {
      run.end = l.idx;
      continue;
    }
    flush();
    if (mergeable) {
      run = { label: l.label, page: l.page, start: l.idx, end: l.idx };
    } else {
      // heading / list-item → standalone block
      refs.push({
        type: l.label,
        level: l.label === 'heading' ? 1 : null,
        startLine: l.idx,
        endLine: l.idx,
      });
    }
  }
  flush();
  return refs;
}
