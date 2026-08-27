// ASSEMBLE — BlockRef[] (line ranges) + the annotated lines → Block[].
//
// This is where entity fidelity is GUARANTEED: block text is the referenced source lines joined
// VERBATIM. The LLM only chose ranges/types — it never emitted text, so it cannot alter "MECO",
// "041-560", "MO PE No. 022510", $ figures, etc. Coverage is validated so no content line is
// dropped and no line is double-counted; any malformed range degrades gracefully (never throws).
import type { AnnotatedLine, Block, BlockRef, BlockType } from './types';

/** FNV-1a → base36. Small, stable, dependency-free — good enough for content-derived ids. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** Join wrapped source lines back into one string, verbatim (single space between lines). */
function joinText(lines: AnnotatedLine[]): string {
  return lines
    .map((l) => l.text.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function clampLevel(type: BlockType, level: number | null): number | undefined {
  if (type !== 'heading') return undefined;
  const n = Math.round(level ?? 1);
  return Math.min(3, Math.max(1, Number.isFinite(n) ? n : 1));
}

/**
 * Build the final Block[] from line-range refs. Robust to overlaps, out-of-range indices, and
 * gaps: every line gets exactly one owner (first valid claim wins), unreferenced content lines
 * become their own blocks, and blocks are emitted in reading order.
 */
export function assemble(refs: BlockRef[], lines: AnnotatedLine[]): Block[] {
  const N = lines.length;
  const owner = new Int32Array(N).fill(-1); // -1 = unclaimed
  const refType: BlockType[] = [];
  const refLevel: (number | null)[] = [];

  // Claim lines for refs (sorted by start), first valid claim wins.
  const sorted = [...refs].sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
  for (const r of sorted) {
    const start = Math.max(0, Math.min(N - 1, r.startLine | 0));
    const end = Math.max(0, Math.min(N - 1, r.endLine | 0));
    if (end < start) continue;
    const rid = refType.length;
    let claimed = false;
    for (let i = start; i <= end; i++) {
      if (owner[i] === -1) {
        owner[i] = rid;
        claimed = true;
      }
    }
    if (claimed) {
      refType.push(r.type);
      refLevel.push(r.level);
    }
  }

  // Emit blocks by walking lines in reading order, grouping consecutive lines that share an owner.
  // Unclaimed runs (owner -1) become their own block, typed from the lines' provisional labels
  // (chrome → other, else paragraph) so nothing is ever dropped.
  const blocks: Block[] = [];
  const ordinals = new Map<string, number>();
  let i = 0;
  while (i < N) {
    const o = owner[i];
    let j = i + 1;
    while (j < N && owner[j] === o) j++;
    const group = lines.slice(i, j);
    const text = joinText(group);
    if (text) {
      let type: BlockType;
      let level: number | null;
      if (o === -1) {
        // unreferenced: keep content, typed from the lines' provisional labels
        type = group.length === 1 ? group[0].label : 'paragraph';
        level = null;
      } else {
        type = refType[o];
        level = refLevel[o];
      }
      // Deterministic furniture demotion WINS over the LLM: a block whose lines are ALL page
      // chrome (repeated header/footer/address/phone) is always `other`, never body. The LLM
      // sometimes relabels furniture as a paragraph, so a live parse must not leak it as body.
      if (group.every((l) => l.chrome)) {
        type = 'other';
        level = null;
      }
      const page = Math.min(...group.map((l) => l.page));
      const key = `${norm(text)}|${type}`;
      const ord = ordinals.get(key) ?? 0;
      ordinals.set(key, ord + 1);
      const block: Block = {
        id: hash(`${key}|${ord}`),
        type,
        text,
        page,
      };
      const lvl = clampLevel(type, level);
      if (lvl !== undefined) block.level = lvl;
      blocks.push(block);
    }
    i = j;
  }

  // Collapse identical repeated furniture: the same footer/address on every page would otherwise
  // render as N duplicate blocks (the noise John flagged). Keep the first occurrence — the footer
  // entities (phone, address, project no.) survive verbatim there; only the exact-dupes are dropped.
  const seenOther = new Set<string>();
  return blocks.filter((b) => {
    if (b.type !== 'other') return true;
    const k = norm(b.text);
    if (seenOther.has(k)) return false;
    seenOther.add(k);
    return true;
  });
}
