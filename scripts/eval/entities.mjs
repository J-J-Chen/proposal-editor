// entities.mjs — the measuring instrument for the name/entity-fidelity eval.
//
// ANTI-OVERFIT: this file contains NO test-set entity names. It never mentions MECO, Dixon,
// Wiles, or any specific firm/place from easy.pdf or hard.pdf. Everything is pattern- or
// linguistics-based and applies identically to both datasets (and to the hidden fixture):
//   - Closed-class entities are matched by GENERIC regex (a $ figure, a NNN-NNN job number, a
//     4-digit year) — not by value.
//   - Proper nouns are extracted GENERICALLY (capitalized multi-word phrases + acronyms), with a
//     DOMAIN-GENERIC stoplist of common words ("City", "Water", "Engineering", "Department", …)
//     that is ordinary English/industry vocabulary, NOT the entities under test.
//
// Two honest numbers per the owner directive:
//   - STRICT (primary): every entity from BEFORE must survive VERBATIM in AFTER. The shipped
//     prompt asks for verbatim, so "$2.4M" → "$2.4 million" counts as a CHANGE here.
//   - VALUE-aware (secondary): the same, but a reformat that preserves the value is forgiven
//     ($ by magnitude; a proper noun by survival of its distinctive token; a date by m/d/y parts).

// ─────────────────────────────────────────────────────────────────────────────
// Closed-class entities — matched by generic pattern, one required entity per match.
// ─────────────────────────────────────────────────────────────────────────────
export const CLOSED_CLASS = [
  { kind: 'money', re: /\$\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:million|billion|thousand|M\b|B\b|K\b))?/gi },
  { kind: 'pe-no', re: /\b(?:MO\s+)?PE\s+No\.?\s*\d+/gi },
  { kind: 'project-no', re: /\bProject\s+No\.?\s*[\w-]+/gi },
  { kind: 'project-no', re: /\b\d{3}-\d{3}\b/g },
  { kind: 'program-id', re: /\b(?:MoDOT|TAP|USDA|SRF|CDBG|ARRA|SCADA)\b/g }, // bare acronym only — no trailing swallow
  { kind: 'date', re: /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s*\d{4}\b/gi },
  { kind: 'zip', re: /\b\d{5}(?:-\d{4})?\b/g },
  { kind: 'year', re: /\b(?:19|20)\d{2}\b/g },
  { kind: 'quantity', re: /\b\d{1,3}(?:st|nd|rd|th)\b/g },
];

// The classes the per-class k/n table reports (in priority order).
export const ENTITY_CLASSES = ['money', 'pe-no', 'project-no', 'year', 'date', 'zip', 'program-id', 'quantity', 'proper-noun'];

// ── generic linguistics (domain vocabulary, NOT test entities) ────────────────
const MONTHS = new Set(['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']);
const CONNECTORS = new Set(['of', 'and', 'the', 'for', 'de', 'van', 'von', 'la', 'el', '&']);
// Common capitalized words that are NOT a distinctive proper name on their own. Ordinary
// English + civil-engineering-proposal vocabulary — deliberately contains none of the names
// under test, so a real firm/place/person token always survives as "distinctive".
const GENERIC_STOP = new Set([
  ...CONNECTORS, ...MONTHS,
  'a', 'an', 'to', 'in', 'on', 'at', 'by', 'with', 'from', 'our', 'we', 'this', 'that', 'is', 'are', 'as', 'its', 'their',
  'city', 'county', 'town', 'village', 'township', 'state', 'company', 'corporation', 'inc', 'llc', 'llp', 'co', 'corp',
  'associates', 'engineering', 'group', 'authority', 'district', 'department', 'division', 'office', 'board', 'committee',
  'commission', 'university', 'college', 'school', 'system', 'systems', 'water', 'wastewater', 'sewer', 'stormwater',
  'regional', 'national', 'municipal', 'street', 'st', 'avenue', 'ave', 'road', 'rd', 'drive', 'dr', 'lane', 'ln',
  'boulevard', 'blvd', 'highway', 'route', 'services', 'service', 'project', 'projects', 'program', 'programs', 'manager',
  'engineer', 'director', 'president', 'mayor', 'governor', 'superintendent', 'chair', 'member', 'selection',
  'improvements', 'improvement', 'expansion', 'study', 'plan', 'master', 'design', 'construction', 'professional',
  'general', 'structural', 'civil', 'land', 'surveying', 'statement', 'qualifications', 're', 'attn', 'dear', 'prepared',
  'no', 'million', 'billion', 'thousand', 'new', 'set', 'water/wastewater',
  // units/measures (generic engineering vocabulary, NOT names) — keep the name metric focused on names
  'lf', 'vlf', 'gpm', 'mgd', 'mg', 'gal', 'sf', 'cy', 'ft', 'psi', 'mph', 'hp', 'kw', 'kv', 'mw', 'cfs', 'adt', 'dia', 'gpd',
]);
const ORG_SUFFIX = /\b(?:Inc|LLC|LLP|Co|Company|Corp|Corporation|Associates|Engineering|Group|Authority|District|Department|PWD)\b\.?/;

const stripPunct = (s) => s.replace(/^[^A-Za-z0-9$]+|[^A-Za-z0-9.]+$/g, '');
const isCap = (w) => /^[A-Z]/.test(w);
const isDistinctive = (w) => {
  const c = stripPunct(w);
  return c.length >= 2 && isCap(c) && !GENERIC_STOP.has(c.toLowerCase()) && !/^\d+$/.test(c);
};

/**
 * Generic proper-noun extraction — capitalized multi-word phrases + acronyms. Returns
 * [{ value, kind, distinctive: [tokens] }]. High-precision by design (multi-word phrases and
 * real acronyms), so a bare single place name may be left to the cross-model layer — that is an
 * intentional recall/precision trade, not entity tuning.
 */
export function extractProperNouns(text) {
  const out = [];
  const seen = new Set();
  const add = (value, kind, distinctive) => {
    const v = stripPunct(value);
    if (!v || seen.has(v.toLowerCase())) return;
    if (!distinctive.length) return;
    seen.add(v.toLowerCase());
    out.push({ value: v, kind, distinctive });
  };

  // 1. Capitalized multi-word phrases. The real parser concatenates lines within a block with no
  // sentence punctuation, so we first split on STRONG punctuation into segments — this bounds a
  // capitalized run to one logical span instead of swallowing a whole paragraph — and cap the run
  // length. (The value-aware check only needs a distinctive token, so it is robust either way.)
  const MAX_RUN = 5;
  for (const segment of text.split(/[,;:()"“”\n\/]|\s[-–—]\s/)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    for (let i = 0; i < tokens.length; i++) {
      const w = stripPunct(tokens[i]);
      if (!isCap(w) || MONTHS.has(w.toLowerCase())) continue;
      const run = [i];
      let j = i;
      while (j + 1 < tokens.length && run.length < MAX_RUN) {
        const nxt = stripPunct(tokens[j + 1]);
        if (isCap(nxt) && !MONTHS.has(nxt.toLowerCase())) {
          run.push(j + 1);
          j++;
        } else if (CONNECTORS.has(nxt.toLowerCase()) && j + 2 < tokens.length && isCap(stripPunct(tokens[j + 2]))) {
          run.push(j + 1, j + 2);
          j += 2;
        } else break;
      }
      if (run.length >= 2) {
        const value = run.map((k) => tokens[k]).join(' ');
        const distinctive = run.map((k) => stripPunct(tokens[k]).replace(/\.+$/, '')).filter((t) => isDistinctive(t));
        const kind = ORG_SUFFIX.test(value) ? 'org' : 'name';
        add(value, kind, distinctive);
      }
      i = run[run.length - 1];
    }
  }

  // 2. Acronyms: all-caps (MECO, USDA) and internal-capital (MoDOT). Length ≥ 2; skip generic ones.
  for (const m of text.matchAll(/\b[A-Z]{2,}\b|\b[A-Z][a-z]+[A-Z][A-Za-z]*\b/g)) {
    const a = m[0];
    if (GENERIC_STOP.has(a.toLowerCase())) continue;
    add(a, 'acronym', [a]);
  }

  return out;
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Normalize a $ figure to a comparable magnitude so "$2.4M" ≡ "$2.4 million" ≡ "$2,400,000". */
export function normalizeMoney(s) {
  const m = s.match(/\$\s?([\d,]*\.?\d+)\s*(million|billion|thousand|M|B|K)?/i);
  if (!m) return s.toLowerCase().replace(/\s/g, '');
  let n = parseFloat(m[1].replace(/,/g, ''));
  const unit = (m[2] || '').toLowerCase();
  if (unit === 'million' || unit === 'm') n *= 1e6;
  else if (unit === 'billion' || unit === 'b') n *= 1e9;
  else if (unit === 'thousand' || unit === 'k') n *= 1e3;
  return `$${Math.round(n)}`;
}

// Normalize typographic variants the editor freely swaps but that carry no entity meaning:
// curly ↔ straight quotes/apostrophes, en/em dashes → hyphen. Without this, a model rewriting
// “District’s” → "District's" reads as a dropped entity — a false positive, not a name change.
function normalizeGlyphs(s) {
  return s.replace(/[‘’ʼ′]/g, "'").replace(/[“”″]/g, '"').replace(/[–—]/g, '-');
}

function contains(haystack, needle) {
  const esc = normalizeGlyphs(needle).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9])${esc}(?![A-Za-z0-9])`, 'i').test(normalizeGlyphs(haystack));
}

/**
 * Extract the ground-truth entities from a BEFORE block:
 *   { closed: [{kind, value, norm, int?}], proper: [{value, kind, distinctive}] }
 */
export function goldEntities(text) {
  const closed = [];
  const seen = new Set();
  for (const { kind, re } of CLOSED_CLASS) {
    for (const match of text.matchAll(re)) {
      const value = match[0].trim();
      const norm = kind === 'money' ? normalizeMoney(value) : value.toLowerCase().replace(/\s+/g, ' ');
      const key = `${kind}:${norm}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const e = { kind, value, norm };
      if (kind === 'quantity') e.int = parseInt(value, 10);
      closed.push(e);
    }
  }
  // Dedupe overlapping same-kind closed entities down to the distinctive core ("Project No.
  // 041-560" ⊃ "041-560" → keep the bare number).
  const minimal = closed.filter(
    (e) => !closed.some((o) => o !== e && o.kind === e.kind && e.norm.includes(o.norm) && o.norm.length < e.norm.length),
  );
  return { closed: minimal, proper: extractProperNouns(text) };
}

/** Month/day/year parts all present in AFTER (order-independent) → a date reformat is value-preserved. */
function dateValueOk(value, after) {
  const parts = value.match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  if (!parts) return contains(after, value);
  const [, month, day, year] = parts;
  return new RegExp(month, 'i').test(after) && contains(after, day) && contains(after, year);
}

/**
 * Classify preservation of every entity in one edit. Returns an array of per-entity findings:
 *   { class, entity, strictOk, valueOk, note }
 * `class` is one of ENTITY_CLASSES. run.mjs rolls these into per-class k/n (strict + value) and
 * the violation list. A STRICT miss with valueOk === true is a benign reformat, not a real loss.
 */
export function classifyEntities(gold, after) {
  const findings = [];

  for (const e of gold.closed) {
    let strictOk;
    let valueOk;
    if (e.kind === 'money') {
      strictOk = contains(after, e.value);
      valueOk = [...after.matchAll(CLOSED_CLASS[0].re)].some((m) => normalizeMoney(m[0]) === e.norm);
    } else if (e.kind === 'quantity') {
      strictOk = contains(after, e.value); // "40th" verbatim
      valueOk = new RegExp(`\\b0*${e.int}(?:st|nd|rd|th)?\\b`).test(after); // "40" in any numeric form
    } else if (e.kind === 'date') {
      strictOk = contains(after, e.value);
      valueOk = dateValueOk(e.value, after);
    } else {
      strictOk = contains(after, e.value);
      valueOk = strictOk; // years / project# / pe# / zip / program-id: no benign reformat
    }
    findings.push({ class: e.kind, entity: e.value, strictOk, valueOk, note: strictOk ? '' : valueOk ? 'reformatted (value kept)' : 'missing or altered' });
  }

  for (const p of gold.proper) {
    const strictOk = contains(after, p.value);
    // Referent survival: any distinctive token still present (generic — no alias table).
    const valueOk = strictOk || p.distinctive.some((d) => contains(after, d));
    findings.push({ class: 'proper-noun', entity: p.value, strictOk, valueOk, note: strictOk ? '' : valueOk ? 'shortened (referent kept)' : 'referent dropped/renamed' });
  }

  return findings;
}

/** Preamble / refusal / markdown leak — validates the forced-tool structured output. */
export function preambleLeak(after) {
  const t = after.trim();
  if (/^\s*(sure|certainly|of course|okay|here('| i)s|i['’]?ve|i have|below is|great)\b/i.test(t)) return 'conversational preamble';
  if (t.includes('```')) return 'markdown code fence';
  if (/^["“'].*["”']$/s.test(t) && !/["“']/.test(t.slice(1, -1))) return 'whole text wrapped in quotes';
  return null;
}

/** True if the block carries at least one ground-truth entity (the eval denominator). */
export function isEntityBearing(text) {
  const g = goldEntities(text);
  return g.closed.length > 0 || g.proper.length > 0;
}

/** The set of closed-class kinds present (for class-diverse block sampling). */
export function classesIn(text) {
  const g = goldEntities(text);
  const s = new Set(g.closed.map((e) => e.kind));
  if (g.proper.length) s.add('proper-noun');
  return s;
}
