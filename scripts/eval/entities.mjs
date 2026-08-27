// entities.mjs — the measuring instrument for the name/entity-fidelity eval.
//
// Design commitment (from plans/checkpoint-5-eval-readme.md, "Extractor"):
// the instrument must be MORE reliable than what it measures, so it is deterministic-first.
// Two layers, in order of trust:
//
//   1. Closed-class regex = GROUND TRUTH. Dollar figures, project/contract numbers, PE license
//      numbers, years, ZIPs, calendar dates, ordinal quantities. These are strict-verbatim:
//      if a preservation-type edit drops or alters one, that is a violation, full stop. An LLM
//      may never override this layer.
//   2. Proper-noun ALIAS GROUPS for the known corpus (MECO / Dixon / Wiles / …). Scored by
//      *referent survival*, not surface form: collapsing "MECO Engineering Company, Inc." → "MECO"
//      is a legitimate tighten, NOT a violation. A group counts as preserved if ANY of its
//      surface forms is still present in the edited text.
//
// The optional diff-aware cross-model LLM layer (llm-extractor.mjs) sits ON TOP of this to catch
// open-class proper nouns that are NOT in the known corpus — that layer is what lets the same
// eval generalize to the hidden fixture. This file has ZERO dependencies so the deterministic
// score runs with no node_modules and no proxy calls.

// ─────────────────────────────────────────────────────────────────────────────
// Layer 1 — closed-class entities (strict verbatim, value-preserving).
// Each pattern is global; we collect every match in a block as a required entity.
// ─────────────────────────────────────────────────────────────────────────────
export const CLOSED_CLASS = [
  // $2.4M / $2,400,000 / $2.4 million — captured whole; compared by normalized magnitude.
  { kind: 'money', re: /\$\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:million|billion|thousand|M\b|B\b|K\b))?/gi },
  // MO PE No. 022510 (state PE license) — must precede the bare-number classes.
  { kind: 'pe-no', re: /\b(?:MO\s+)?PE\s+No\.?\s*\d+/gi },
  // Project / contract numbers: 041-560, and "Project No. 041-560".
  { kind: 'project-no', re: /\bProject\s+No\.?\s*[\w-]+/gi },
  { kind: 'project-no', re: /\b\d{3}-\d{3}\b/g },
  // MoDOT / TAP program ids (appear in the real corpus, not this mock — kept for generalization).
  { kind: 'program-id', re: /\b(?:MoDOT|TAP)[- ]?[\w-]*\b/g },
  // Calendar dates: "April 14, 2025".
  { kind: 'date', re: /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s*\d{4}\b/gi },
  // ZIP codes: 65459 (5 digits, optionally +4). Distinct from 4-digit years by length.
  { kind: 'zip', re: /\b\d{5}(?:-\d{4})?\b/g },
  // 4-digit years: 1985, 2025.
  { kind: 'year', re: /\b(?:19|20)\d{2}\b/g },
  // Ordinal / tenure quantities: "40th" (anniversary). NOT strict-verbatim — a legit rewrite may
  // reformat "40th anniversary" → "40 years" → "four decades" and still preserve the value 40. So
  // this is scored by INTEGER SURVIVAL, and a case where the digit vanishes (spelled out) is a
  // REVIEW flag for adjudication, not a hard violation. (The plan's strict closed-class is money /
  // project# / PE# / program-id / year — ordinals are deliberately softer.)
  { kind: 'quantity', re: /\b\d{1,3}(?:st|nd|rd|th)\b/g },
];

// ─────────────────────────────────────────────────────────────────────────────
// Layer 2 — known-corpus proper-noun alias groups (referent survival).
// canonical = a stable label for the report; forms = every acceptable surface form.
// Preserved iff ANY form survives in the edited text (case-insensitive, word-ish match).
// ─────────────────────────────────────────────────────────────────────────────
export const ALIAS_GROUPS = [
  { canonical: 'MECO', forms: ['MECO Engineering Company, Inc.', 'MECO Engineering Company', 'MECO Engineering', 'MECO'] },
  { canonical: 'City of Dixon', forms: ['The City of Dixon', 'City of Dixon', 'Dixon, MO', 'Dixon'] },
  { canonical: 'Mary Wiles', forms: ['Mary Wiles', 'Mayor Wiles', 'Wiles'] },
  { canonical: 'Elm Street', forms: ['305 S Elm Street', 'S Elm Street', 'Elm Street'] },
];

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

/** Present iff the needle appears as a case-insensitive, boundary-aware substring. */
function contains(haystack, needle) {
  const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Loose boundaries: allow adjacent punctuation but not mid-word letter runs.
  return new RegExp(`(?<![A-Za-z0-9])${esc}(?![A-Za-z0-9])`, 'i').test(haystack);
}

/**
 * Extract the ground-truth entities from a BEFORE block. Returns:
 *   { closed: [{kind, value, norm}], groups: ['MECO', ...] }
 * `closed` are strict-verbatim requirements; `groups` are referent-survival requirements.
 * De-dupes by normalized value so a repeated token isn't double-counted.
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
      const entity = { kind, value, norm };
      if (kind === 'quantity') entity.int = parseInt(value, 10); // the value that must survive (40th → 40)
      closed.push(entity);
    }
  }
  // Dedupe overlapping same-kind closed entities down to the distinctive core: "Project No.
  // 041-560" and "041-560" describe ONE referent, and an edit that keeps "041-560" but drops the
  // "Project No." label should NOT count as a miss. Keep the entity only if no OTHER same-kind
  // entity is a proper substring of it (i.e. drop the longer, label-bearing form).
  const minimal = closed.filter(
    (e) => !closed.some((o) => o !== e && o.kind === e.kind && e.norm.includes(o.norm) && o.norm.length < e.norm.length),
  );

  const groups = ALIAS_GROUPS.filter((g) => g.forms.some((f) => contains(text, f))).map((g) => g.canonical);
  return { closed: minimal, groups };
}

/**
 * Score preservation of one edit deterministically. `gold` is goldEntities(before).
 * Returns a list of findings, each tagged with `severity`:
 *   - 'violation' — a strict entity (money / number / date / name) missing or altered. Counts against k/n.
 *   - 'review'    — a quantity whose digit vanished (likely spelled out, e.g. "four decades"); needs
 *                   a human glance before it counts. Does NOT count against k/n.
 * Shape: { type, kind, entity, note, severity }.
 */
export function preservationViolations(gold, after) {
  const findings = [];

  for (const e of gold.closed) {
    if (e.kind === 'money') {
      // Value-preserving: any $ figure in AFTER whose magnitude matches counts as preserved.
      const ok = [...after.matchAll(CLOSED_CLASS[0].re)].some((m) => normalizeMoney(m[0]) === e.norm);
      if (!ok) findings.push({ type: 'closed', kind: e.kind, entity: e.value, note: 'missing or altered', severity: 'violation' });
    } else if (e.kind === 'quantity') {
      // Integer survival: "40th" is preserved by "40", "40th", "40-year", "40 years". If the digit
      // is gone (spelled out like "four decades"), don't hard-fail — flag it for adjudication.
      const ok = new RegExp(`\\b0*${e.int}(?:st|nd|rd|th)?\\b`).test(after);
      // The digit is gone: could be a legit reformat ("four decades") OR a real change ("50 years").
      // The deterministic layer can't tell — flag for adjudication; the cross-model layer + a human
      // glance settle it. (A hard-fail here would false-positive every "40th → 40 years" reformat.)
      if (!ok) findings.push({ type: 'closed', kind: e.kind, entity: e.value, note: `value ${e.int} no longer a literal digit — verify tenure unchanged`, severity: 'review' });
    } else {
      if (!contains(after, e.value)) findings.push({ type: 'closed', kind: e.kind, entity: e.value, note: 'missing or altered', severity: 'violation' });
    }
  }

  for (const canonical of gold.groups) {
    const group = ALIAS_GROUPS.find((g) => g.canonical === canonical);
    const ok = group.forms.some((f) => contains(after, f));
    if (!ok) findings.push({ type: 'group', kind: 'proper-noun', entity: canonical, note: 'referent dropped/renamed', severity: 'violation' });
  }

  return findings;
}

/**
 * Preamble / refusal / markdown leak — zero-LLM validation of the structured-output decision
 * (forced tool call => data, not prose). A clean applied text has none of these.
 */
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
  return g.closed.length > 0 || g.groups.length > 0;
}
