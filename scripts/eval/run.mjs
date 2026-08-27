// run.mjs — the name/entity-fidelity eval harness. Runs the preservation instruction grid over
// the entity-bearing blocks of a parsed Doc, against the SHIPPED /api/edit route, and reports
// per-entity-class k/n on TWO axes (strict-verbatim primary, value-aware secondary) plus an
// applicability-aware effectiveness number and a leak check.
//
// Usage:
//   node scripts/eval/run.mjs --doc easy|hard [--base URL] [--sha SHA] [options]
//     --doc easy|hard    which seeded dataset to parse (sets the real cache hash + filename)
//     --hash SHA         override the parse hash (advanced; --doc sets it by default)
//     --base URL         parse/edit base (default http://localhost:3121; pass the DEPLOYED URL for the recorded run)
//     --sha SHA          stamp the deploy SHA into the report
//     --max-blocks N     class-diverse cap on entity-bearing blocks (all $-bearing blocks are always kept)
//     --limit N          hard cap on blocks (smoke test)
//     --no-llm           deterministic layer only
//     --out FILE         write the JSON artifact
//     --concurrency N    parallel edit calls (default 6)
//
// Reuses the exact browser request shape scripts/e2e-verify.mjs sends — { block, instruction,
// docContext } → { newText } — against the real route, NOT a reimplemented SDK call.

import { writeFileSync } from 'node:fs';
import { goldEntities, classifyEntities, preambleLeak, isEntityBearing, classesIn, ENTITY_CLASSES } from './entities.mjs';
import { buildTrials, INSTRUCTIONS } from './instructions.mjs';
import { loadEnv, isLlmAvailable, crossModelEntityDiff, effectivenessJudge, EXTRACT_MODEL } from './llm-extractor.mjs';

// Seeded datasets. The hashes are file-content cache KEYS (not entity tuning) — they let the parse
// route return the exact committed L0-seed Doc without re-uploading bytes.
const DOCS = {
  easy: { hash: '03dd3ee8dd7962eb11fd67dd223cfdcdcd0e4f8957aa8622ac24d929cd8c5829', filename: 'easy.pdf' },
  hard: { hash: '02d30cdbbdf08ce1f8a743b233665e4d6f5550343e1a96cc4da0223733851bf9', filename: 'hard.pdf' },
};

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
};
const has = (name) => argv.includes(name);

const docKey = flag('--doc', 'easy');
const doc = DOCS[docKey];
if (!doc) {
  console.error(`--doc must be one of: ${Object.keys(DOCS).join(', ')}`);
  process.exit(2);
}
const base = flag('--base', 'http://localhost:3121').replace(/\/$/, '');
const parseHash = flag('--hash', doc.hash); // FIX: real seed hash by default (was hardcoded 'eval' → 422)
const maxBlocks = flag('--max-blocks', null) ? parseInt(flag('--max-blocks'), 10) : null;
const limit = flag('--limit', null) ? parseInt(flag('--limit'), 10) : null;
const outFile = flag('--out', null);
const sha = flag('--sha', null);
const concurrency = parseInt(flag('--concurrency', '6'), 10);
const useLlm = !has('--no-llm');

const EDITOR_MODEL = 'claude-sonnet-4-5'; // src/lib/ai.ts AI_MODELS.anthropicMain (confirm vs deploy env)
const EDITOR_TEMP = 0.2;

// ── http ─────────────────────────────────────────────────────────────────────
async function post(path, body) {
  const r = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: r.status, json, text };
}

async function mapPool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.max(1, n) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

// Class-diverse sampling: keep EVERY $-bearing block (the coverage that matters), then fill toward
// max by favouring rare classes and substance. Logs what it drops (no silent truncation).
function selectBlocks(bearing, max) {
  if (!max || bearing.length <= max) return { chosen: bearing, dropped: 0 };
  const withMoney = bearing.filter((b) => classesIn(b.text).has('money'));
  const rest = bearing.filter((b) => !classesIn(b.text).has('money'));
  const score = (b) => classesIn(b.text).size * 100 + Math.min(b.text.length, 400);
  rest.sort((a, b) => score(b) - score(a));
  const chosen = [...withMoney, ...rest].slice(0, Math.max(max, withMoney.length));
  return { chosen, dropped: bearing.length - chosen.length };
}

// ── main ─────────────────────────────────────────────────────────────────────
console.log(`\n▶ name/entity-fidelity eval  ·  doc=${docKey}  ·  base=${base}  ·  llm=${useLlm ? EXTRACT_MODEL : 'off'}\n`);

if (useLlm) {
  loadEnv();
  if (!isLlmAvailable()) console.log('  ⚠ no BUOYANT_PROXY_TOKEN — deterministic layer only.\n');
}

const parse = await post('/api/parse', { hash: parseHash, filename: doc.filename });
if (parse.status === 422) {
  console.error(`✗ /api/parse 422 needsUpload — hash ${parseHash} is not seeded at ${base}. Wrong --doc/--hash or unseeded env.`);
  process.exit(1);
}
if (parse.status !== 200 || !parse.json?.doc?.blocks) {
  console.error(`✗ /api/parse failed (${parse.status}) at ${base}.\n${parse.text.slice(0, 300)}`);
  process.exit(1);
}
const parsedDoc = parse.json.doc;
const allBlocks = parsedDoc.blocks;

let bearing = allBlocks.filter((b) => isEntityBearing(b.text || ''));
const { chosen, dropped } = selectBlocks(bearing, maxBlocks);
let blocks = chosen;
if (limit) blocks = blocks.slice(0, limit);

const headings = allBlocks.filter((b) => b.type === 'heading').map((b) => b.text).slice(0, 12);
// Firm name for docContext, derived generically (most frequent acronym across the doc) — NOT hardcoded.
const acronymFreq = {};
for (const b of allBlocks) for (const p of goldEntities(b.text || '').proper) if (p.kind === 'acronym') acronymFreq[p.value] = (acronymFreq[p.value] || 0) + 1;
const firm = Object.entries(acronymFreq).sort((a, b) => b[1] - a[1])[0]?.[0];
const docContext = { headings, ...(firm ? { firm } : {}) };

console.log(`  doc: ${parsedDoc.filename}  ·  ${allBlocks.length} blocks  ·  ${bearing.length} entity-bearing`);
if (dropped) console.log(`  sampling: ${blocks.length} blocks (kept all $-bearing; dropped ${dropped} lower-diversity blocks — N per cell stated below)`);
console.log(`  docContext.firm: ${firm ?? '(none)'}  ·  headings: ${headings.length}`);

const trials = buildTrials(blocks);
console.log(`  trials: ${trials.length}  (${blocks.length} blocks × ${INSTRUCTIONS.reduce((a, i) => a + i.phrasings.length, 0)} phrasings)\n`);

// ── run every trial against the shipped route ──────────────────────────────────
let done = 0;
const results = await mapPool(trials, concurrency, async (t) => {
  const before = t.block.text;
  const gold = goldEntities(before);
  const res = await post('/api/edit', {
    block: { id: t.block.id, text: before, type: t.block.type },
    instruction: t.instruction,
    docContext,
  });
  process.stdout.write(`\r  running… ${++done}/${trials.length}`);

  const meta = { blockId: t.blockId, instructionId: t.instructionId, variant: t.variant, hard: t.hard, expectShorter: t.expectShorter, instruction: t.instruction, before };
  if (res.status !== 200 || typeof res.json?.newText !== 'string') {
    return { ...meta, error: `HTTP ${res.status}: ${res.text.slice(0, 120)}` };
  }
  const after = res.json.newText;
  const findings = classifyEntities(gold, after);

  let llmMissing = null;
  let judged = null;
  if (useLlm && isLlmAvailable()) {
    [judged, llmMissing] = await Promise.all([
      effectivenessJudge({ before, after, instruction: t.instruction }),
      crossModelEntityDiff({ before, after }).then((d) => (d && d.missing ? d.missing : null)),
    ]);
  }

  return {
    ...meta,
    after,
    findings,
    llmMissing,
    changed: after.trim() !== before.trim(),
    lenBefore: before.length,
    lenAfter: after.length,
    judged,
    leak: preambleLeak(after),
    rationale: res.json.rationale ?? null,
  };
});
process.stdout.write('\n\n');

const ok = results.filter((r) => !r.error);
const errored = results.filter((r) => r.error);

// ── aggregate ──────────────────────────────────────────────────────────────────
// Per entity-class k/n (strict + value), by entity occurrence.
const classStats = {};
for (const c of ENTITY_CLASSES) classStats[c] = { occ: 0, strict: 0, value: 0 };
for (const r of ok) for (const f of r.findings) {
  const s = (classStats[f.class] ||= { occ: 0, strict: 0, value: 0 });
  s.occ++;
  if (f.strictOk) s.strict++;
  if (f.valueOk) s.value++;
}

// Per-instruction trial preservation (clean = every entity preserved), strict + value.
const perInstruction = INSTRUCTIONS.map((instr) => {
  const rs = ok.filter((r) => r.instructionId === instr.id);
  return {
    id: instr.id,
    hard: instr.hard,
    n: rs.length,
    strictClean: rs.filter((r) => r.findings.every((f) => f.strictOk)).length,
    valueClean: rs.filter((r) => r.findings.every((f) => f.valueOk)).length,
  };
});

// Violations LEAD with real value losses (valueOk === false). Strict-only changes are reformats.
const valueViolations = ok.flatMap((r) =>
  r.findings.filter((f) => !f.valueOk).map((f) => ({ blockId: r.blockId, instruction: r.instructionId, class: f.class, entity: f.entity, note: f.note, before: r.before, after: r.after })),
);
const reformats = ok.flatMap((r) => r.findings.filter((f) => f.valueOk && !f.strictOk).map((f) => ({ class: f.class, entity: f.entity, blockId: r.blockId, instruction: r.instructionId })));
const reformatByClass = {};
for (const rf of reformats) reformatByClass[rf.class] = (reformatByClass[rf.class] || 0) + 1;

const totalFindings = ok.reduce((a, r) => a + r.findings.length, 0);
const valueClean = totalFindings - valueViolations.length;
const strictClean = ok.reduce((a, r) => a + r.findings.filter((f) => f.strictOk).length, 0);

// Cross-model proper-noun flags not already caught deterministically — for adjudication.
const llmFlags = ok.flatMap((r) =>
  (r.llmMissing ?? [])
    .filter((m) => !r.findings.some((f) => !f.valueOk && (f.entity || '').toLowerCase().includes((m.entity || '').toLowerCase())))
    .map((m) => ({ blockId: r.blockId, instruction: r.instructionId, entity: m.entity, issue: m.issue })),
);

// Effectiveness, applicability-aware.
const judgedRs = ok.filter((r) => r.judged && typeof r.judged.applicable === 'boolean');
const applicable = judgedRs.filter((r) => r.judged.applicable);
const appliedOfApplicable = applicable.filter((r) => r.judged.applied).length;
const substantial = ok.filter((r) => r.lenBefore >= 80);
const changedSub = substantial.filter((r) => r.changed).length;
const tightenRs = ok.filter((r) => r.expectShorter);
const tightenShorter = tightenRs.filter((r) => r.lenAfter <= r.lenBefore).length;
const leaks = ok.filter((r) => r.leak);
const meanDrift = ok.length ? ok.reduce((a, r) => a + (r.lenAfter - r.lenBefore) / Math.max(1, r.lenBefore), 0) / ok.length : 0;

const effPerInstruction = INSTRUCTIONS.map((instr) => {
  const rs = judgedRs.filter((r) => r.instructionId === instr.id);
  const appl = rs.filter((r) => r.judged.applicable);
  return { id: instr.id, applicable: appl.length, applied: appl.filter((r) => r.judged.applied).length, n: rs.length };
});

// ── print ──────────────────────────────────────────────────────────────────────
const L = '─'.repeat(74);
const pct = (k, n) => (n ? ((100 * k) / n).toFixed(0) + '%' : '—');
console.log(L);
console.log(`NAME / ENTITY-FIDELITY EVAL — ${docKey.toUpperCase()}.PDF`);
console.log(L);
console.log(`base URL      : ${base}`);
console.log(`deploy SHA    : ${sha ?? '(pass --sha for the recorded run)'}`);
console.log(`editor model  : ${EDITOR_MODEL} @ temp ${EDITOR_TEMP}  (configured; confirm vs deploy env)`);
console.log(`extractor     : deterministic regex (ground truth)${useLlm && isLlmAvailable() ? ` + cross-model ${EXTRACT_MODEL}` : ' only'}`);
console.log(`run at        : ${new Date().toISOString()}`);
console.log(`dataset       : ${parsedDoc.filename} — ${bearing.length} entity-bearing blocks, ${blocks.length} sampled, ${trials.length} trials${errored.length ? ` (+${errored.length} errored)` : ''}`);
console.log('');

console.log('PER-ENTITY-CLASS FIDELITY  (preserved occurrences / total; strict-verbatim │ value-aware)');
for (const c of ENTITY_CLASSES) {
  const s = classStats[c];
  if (!s.occ) continue;
  console.log(`  ${c.padEnd(12)} strict ${String(s.strict).padStart(3)}/${String(s.occ).padEnd(3)} ${pct(s.strict, s.occ).padStart(4)}  │  value ${String(s.value).padStart(3)}/${String(s.occ).padEnd(3)} ${pct(s.value, s.occ).padStart(4)}`);
}
console.log(`  ${'—'.repeat(58)}`);
console.log(`  ALL          strict ${String(strictClean).padStart(3)}/${String(totalFindings).padEnd(3)} ${pct(strictClean, totalFindings).padStart(4)}  │  value ${String(valueClean).padStart(3)}/${String(totalFindings).padEnd(3)} ${pct(valueClean, totalFindings).padStart(4)}`);
console.log('');

console.log('VIOLATION LIST — real value losses (lead with this, not the %):');
if (!valueViolations.length) console.log('  (none — every entity preserved by value across all trials)');
else for (const v of valueViolations) {
  console.log(`  ✗ [${v.blockId} · ${v.instruction}] ${v.class} "${v.entity}" ${v.note}`);
  console.log(`      before: ${v.before.slice(0, 96)}`);
  console.log(`      after : ${v.after.slice(0, 96)}`);
}
console.log('');
if (reformats.length) {
  console.log(`STRICT-ONLY REFORMATS (value kept, surface changed — the strict↔value gap): ${reformats.length}`);
  console.log(`  by class: ${Object.entries(reformatByClass).map(([c, n]) => `${c} ${n}`).join(' · ')}`);
  console.log('');
}
if (llmFlags.length) {
  console.log(`CROSS-MODEL FLAGS (open-class; hand-adjudicate) — ${llmFlags.length}:`);
  for (const f of llmFlags.slice(0, 12)) console.log(`  ? [${f.blockId} · ${f.instruction}] "${f.entity}" (${f.issue})`);
  console.log('');
}

console.log('PRESERVATION per instruction (value-clean trials / n; ★=over-sampled hard):');
for (const p of perInstruction) console.log(`  ${p.id.padEnd(14)}${p.hard ? '★' : ' '} ${String(p.valueClean).padStart(2)}/${String(p.n).padEnd(2)}  (strict ${p.strictClean}/${p.n})`);
console.log('');

console.log('EFFECTIVENESS (applicability-aware — legit no-ops excluded from the denominator):');
if (judgedRs.length) {
  console.log(`  instruction applied / applicable : ${appliedOfApplicable}/${applicable.length}  (${judgedRs.length - applicable.length} trials judged not-applicable, excluded)`);
  for (const e of effPerInstruction) console.log(`    ${e.id.padEnd(14)} ${e.applied}/${e.applicable} applied/applicable`);
}
console.log(`  changed text (substantial ≥80 chars): ${changedSub}/${substantial.length}`);
console.log(`  tighten did not grow                : ${tightenShorter}/${tightenRs.length}`);
console.log('');
console.log('LEAK + DRIFT + ANTI-OVERFIT:');
console.log(`  preamble/refusal/fence leaks : ${leaks.length}/${ok.length}`);
console.log(`  mean length drift            : ${(meanDrift * 100).toFixed(1)}%`);
console.log(`  anti-overfit                 : no test-entity names in the instrument; generic regex + linguistic stoplist;`);
console.log(`                                 identical code path for easy & hard; ${docKey === 'hard' ? 'hard.pdf is the untouched holdout' : 'easy.pdf'}; violations listed not hidden.`);
if (errored.length) {
  console.log('');
  console.log(`ERRORS (${errored.length}): ${errored.slice(0, 5).map((e) => `${e.blockId}/${e.instructionId}`).join(', ')}`);
}
console.log(L);

// ── artifact ─────────────────────────────────────────────────────────────────
const artifact = {
  meta: { doc: docKey, base, deploySha: sha ?? null, editorModel: EDITOR_MODEL, editorTemp: EDITOR_TEMP, extractor: { deterministic: true, crossModel: useLlm && isLlmAvailable() ? EXTRACT_MODEL : null }, runAt: new Date().toISOString(), filename: parsedDoc.filename, blocks: allBlocks.length, entityBearing: bearing.length, sampled: blocks.length, trials: trials.length },
  perClass: classStats,
  headline: { strictClean, valueClean, totalFindings, strictPct: Number(pct(strictClean, totalFindings).replace('%', '')), valuePct: Number(pct(valueClean, totalFindings).replace('%', '')) },
  perInstruction,
  violations: valueViolations,
  reformats: { total: reformats.length, byClass: reformatByClass },
  crossModelFlags: llmFlags,
  effectiveness: { appliedOfApplicable, applicable: applicable.length, judged: judgedRs.length, changedSubstantial: changedSub, substantialN: substantial.length, tightenShorter, tightenN: tightenRs.length, perInstruction: effPerInstruction },
  leaks: leaks.map((r) => ({ blockId: r.blockId, instruction: r.instructionId, leak: r.leak })),
  meanLengthDriftPct: Number((meanDrift * 100).toFixed(1)),
  errors: errored.map((e) => ({ blockId: e.blockId, instruction: e.instructionId, error: e.error })),
  trials: ok.map((r) => ({ blockId: r.blockId, instruction: r.instructionId, variant: r.variant, before: r.before, after: r.after, findings: r.findings, changed: r.changed, lenBefore: r.lenBefore, lenAfter: r.lenAfter, judged: r.judged, leak: r.leak })),
};
if (outFile) {
  writeFileSync(outFile, JSON.stringify(artifact, null, 2));
  console.log(`\n✓ wrote ${outFile}`);
}

const effectivenessCollapsed = applicable.length > 0 && appliedOfApplicable === 0;
process.exit(valueViolations.length === 0 && !effectivenessCollapsed ? 0 : 1);
