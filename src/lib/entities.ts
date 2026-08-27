/**
 * Protected entities — the proper nouns, license/project numbers, dollar figures, and phone
 * numbers the edit must never change unless explicitly told to. A silently altered name or
 * number is the catastrophic failure in this domain (docs/goals.md), so the UI makes these
 * VISIBLE: a gold tint in the document, a "Kept exactly as written" line in the review card,
 * and a confirm before an edit that would touch one.
 *
 * Pattern-based for numbers/licenses/phones/money; proper names come from a small known list
 * (the fixture/easy.pdf firm + personnel + client). This mirrors the entity-dictionary idea
 * the CP5 eval / guardrail use — scoped to what the UI needs to highlight.
 */
export type EntityKind = 'name' | 'license' | 'projectNo' | 'money' | 'phone';

export interface Entity {
  text: string;
  kind: EntityKind;
}

/** Proper names present across easy.pdf — the firm, personnel, client, official, place. */
export const KNOWN_NAMES: readonly string[] = [
  'MECO Engineering Company, Inc.',
  'MECO Engineering',
  'MECO',
  'City of Dixon',
  'Mary Wiles',
  'Donald J. Jenkins',
  'Scott E. Vogler',
  'David C. Uhlig',
  'Kevin W. Garnett',
  'Jefferson City',
];

const PATTERNS: { kind: EntityKind; re: RegExp }[] = [
  // "MO PE No. PE-2020000059", "MO PE No. 022510", "MO PE E-027521", "IL PE 062.057955"
  { kind: 'license', re: /\b(?:MO|IL)\s+PE\s+(?:No\.?\s*)?[A-Z]?-?[\d.]+/g },
  { kind: 'license', re: /\bPE-\d{5,}\b/g },
  // "Project No. 041-560", or a bare "041-560"
  { kind: 'projectNo', re: /\bProject\s+No\.?\s*\d{2,3}-\d{2,4}\b/gi },
  { kind: 'projectNo', re: /\b0\d{2}-\d{3}\b/g },
  // Dollar figures
  { kind: 'money', re: /\$\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:million|billion|M|K))?/gi },
  // US phone numbers
  { kind: 'phone', re: /\b\d{3}-\d{3}-\d{4}\b/g },
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface Span {
  start: number;
  end: number;
  ent: Entity;
}

/**
 * Scan text for protected entities. `extraNames` adds doc-specific names; KNOWN_NAMES is always
 * included. Longer matches win over the shorter names they contain, and spans never overlap
 * (so "MECO Engineering Company, Inc." beats "MECO"). Returned in document order.
 */
function scan(text: string, extraNames: readonly string[]): Span[] {
  const found: Span[] = [];
  const overlaps = (a: number, b: number) => found.some(({ start, end }) => a < end && b > start);

  const claim = (idx: number, len: number, ent: Entity) => {
    if (len === 0 || overlaps(idx, idx + len)) return;
    found.push({ start: idx, end: idx + len, ent });
  };

  const names = [...new Set([...extraNames, ...KNOWN_NAMES])].sort((a, b) => b.length - a.length);
  for (const name of names) {
    const re = new RegExp(escapeRe(name), 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) claim(m.index, m[0].length, { text: m[0], kind: 'name' });
  }

  for (const { kind, re } of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) claim(m.index, m[0].length, { text: m[0].trim(), kind });
  }

  return found.sort((a, b) => a.start - b.start);
}

/** Protected entities in a piece of text, in document order. */
export function extractEntities(text: string, extraNames: readonly string[] = []): Entity[] {
  return scan(text, extraNames).map((s) => s.ent);
}

/** Character ranges of protected entities — for wrapping them in the gold highlight. */
export function entityRanges(
  text: string,
  extraNames: readonly string[] = [],
): { start: number; end: number }[] {
  return scan(text, extraNames).map(({ start, end }) => ({ start, end }));
}

/** Unique entity strings in document order — for the card's "Kept exactly as written" line. */
export function protectedStrings(text: string, extraNames?: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of extractEntities(text, extraNames)) {
    if (!seen.has(e.text)) {
      seen.add(e.text);
      out.push(e.text);
    }
  }
  return out;
}
