/**
 * Word-level diff (LCS) for the review card's optional inline marks — removed words shown
 * struck through, added words underlined, inside the "suggested new wording" box.
 * Decision (design-ui.md #3): the two plain boxes are the primary comprehension path; these
 * inline marks are a secondary aid and the first thing to cut if needed. Small inputs (a single
 * block), so an O(n·m) table is fine.
 */
export type DiffKind = 'same' | 'add' | 'del';
export interface DiffSeg {
  kind: DiffKind;
  text: string;
}

/** Split into words + whitespace runs so segments rejoin into readable text. */
function tokenize(s: string): string[] {
  return s.split(/(\s+)/).filter((t) => t.length > 0);
}

export function wordDiff(before: string, after: string): DiffSeg[] {
  const a = tokenize(before);
  const b = tokenize(after);
  const n = a.length;
  const m = b.length;

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const segs: DiffSeg[] = [];
  const push = (kind: DiffKind, text: string) => {
    const last = segs[segs.length - 1];
    if (last && last.kind === kind) last.text += text;
    else segs.push({ kind, text });
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('same', a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push('del', a[i]);
      i++;
    } else {
      push('add', b[j]);
      j++;
    }
  }
  while (i < n) push('del', a[i++]);
  while (j < m) push('add', b[j++]);
  return segs;
}

/** True when the model returned the block unchanged (instruction didn't apply). */
export function isNoChange(before: string, after: string): boolean {
  return before.trim() === after.trim();
}
