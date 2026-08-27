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

/**
 * Mark repeated page chrome (header/footer/page-number) so it can be de-prioritised as `other`
 * instead of polluting the block flow — but never hard-deleted (a hidden fixture might surface a
 * phone/project number only in a footer). A line is chrome if it's a bare page number, or its
 * text sits in the top/bottom band AND repeats on ≥2 pages.
 */
function chromeKeys(lines: RawLine[]): Set<string> {
  const maxY = Math.max(1, ...lines.map((l) => l.y1));
  const topBand = maxY * 0.06;
  const botBand = maxY * 0.9;
  const bandCount = new Map<string, Set<number>>();
  for (const l of lines) {
    if (l.y0 < topBand || l.y0 > botBand) {
      const k = norm(l.text);
      if (!k) continue;
      (bandCount.get(k) ?? bandCount.set(k, new Set()).get(k)!).add(l.page);
    }
  }
  const keys = new Set<string>();
  for (const [k, pages] of bandCount) if (pages.size >= 2) keys.add(k);
  return keys;
}

const isPageNumber = (s: string): boolean => /^\s*(?:page\s+)?\d{1,3}\s*$/i.test(s);

/** Per-page "body left edge" = the leftmost non-chrome line x0 (used to detect indentation). */
function bodyLeftByPage(lines: RawLine[], chrome: Set<string>): Map<number, number> {
  const byPage = new Map<number, number[]>();
  for (const l of lines) {
    if (chrome.has(norm(l.text)) || isPageNumber(l.text)) continue;
    (byPage.get(l.page) ?? byPage.set(l.page, []).get(l.page)!).push(l.x0);
  }
  const out = new Map<number, number>();
  for (const [p, xs] of byPage) out.set(p, Math.min(...xs));
  return out;
}

/** Attach per-line signals + a provisional label. The LLM refines boundaries/levels from here. */
export function annotate(lines: RawLine[]): AnnotatedLine[] {
  const chrome = chromeKeys(lines);
  const bodyLeft = bodyLeftByPage(lines, chrome);

  return lines.map((l) => {
    const text = l.text.trim();
    const caps = isAllCaps(text);
    const words = text.split(/\s+/).length;
    const isChrome = chrome.has(norm(text)) || isPageNumber(text);
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
