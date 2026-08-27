// run.mjs — the name/entity-fidelity eval harness. Runs the preservation instruction grid over
// the entity-bearing blocks of the parsed Doc, against the SHIPPED /api/edit route, and reports
// the two-axis numbers from plans/checkpoint-5-eval-readme.md.
//
// Usage:
//   node scripts/eval/run.mjs [--base URL] [--limit N] [--no-llm] [--out FILE] [--sha SHA] [--concurrency N]
//     --base URL       edit/parse route base (default http://localhost:3121; pass the deployed URL for the recorded run)
//     --limit N        cap the number of entity-bearing blocks (smoke test)
//     --no-llm         deterministic layer only (no cross-model extractor / effectiveness judge)
//     --out FILE       write the full JSON result artifact here
//     --sha SHA        stamp the deploy SHA into the report (for the recorded prod run)
//     --concurrency N  parallel edit calls (default 4)
//
// It reuses the exact request shape scripts/e2e-verify.mjs sends — the real browser contract
// { block:{id,text,type}, instruction, docContext } → { newText } — NOT a reimplemented SDK call.
// Measuring a prompt no user runs would silently violate "against your shipped product."

import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { goldEntities, preservationViolations, preambleLeak, isEntityBearing } from './entities.mjs';
import { buildTrials, INSTRUCTIONS } from './instructions.mjs';
import { loadEnv, isLlmAvailable, crossModelEntityDiff, effectivenessJudge, EXTRACT_MODEL } from './llm-extractor.mjs';

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
};
const has = (name) => argv.includes(name);

const base = (flag('--base', 'http://localhost:3121')).replace(/\/$/, '');
const limit = flag('--limit', null) ? parseInt(flag('--limit'), 10) : null;
const outFile = flag('--out', null);
const sha = flag('--sha', null);
const concurrency = parseInt(flag('--concurrency', '4'), 10);
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

// tiny concurrency pool
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

// ── main ─────────────────────────────────────────────────────────────────────
console.log(`\n▶ name/entity-fidelity eval  ·  base=${base}  ·  llm=${useLlm ? 'on' : 'off'}\n`);

if (useLlm) {
  const envPath = loadEnv();
  if (!isLlmAvailable()) {
    console.log('  ⚠ no BUOYANT_PROXY_TOKEN found — falling back to deterministic layer only.');
  } else {
    console.log(`  cross-model extractor: ${EXTRACT_MODEL} (env: ${envPath ?? 'process'})`);
  }
}

// 1. Parse → the exact blocks the product renders (fixture stub or real parse).
const parse = await post('/api/parse', { hash: 'eval', filename: 'easy.pdf' });
if (parse.status !== 200 || !parse.json?.doc?.blocks) {
  console.error(`✗ /api/parse failed (${parse.status}). Is the dev server up at ${base}?`);
  console.error(parse.text.slice(0, 300));
  process.exit(1);
}
const doc = parse.json.doc;
const allBlocks = doc.blocks;

// 2. Entity-bearing blocks are the denominator that can actually fail.
let blocks = allBlocks.filter((b) => isEntityBearing(b.text || ''));
if (limit) blocks = blocks.slice(0, limit);

// docContext the browser assembles: section headings + the firm name.
const headings = allBlocks.filter((b) => b.type === 'heading').map((b) => b.text);
const firmBlock = allBlocks.find((b) => goldEntities(b.text || '').groups.includes('MECO'));
const firm = firmBlock ? (firmBlock.text.match(/MECO[^.,(]*/)?.[0].trim() ?? 'MECO Engineering') : undefined;
const docContext = { headings, ...(firm ? { firm } : {}) };

console.log(`  doc: ${doc.filename}  ·  ${allBlocks.length} blocks  ·  ${blocks.length} entity-bearing (denominator)`);
console.log(`  docContext.firm: ${firm ?? '(none)'}  ·  headings: ${headings.length}`);

const trials = buildTrials(blocks);
console.log(`  trials: ${trials.length}  (${blocks.length} blocks × ${INSTRUCTIONS.reduce((a, i) => a + i.phrasings.length, 0)} phrasings)\n`);

// 3. Run every trial against the shipped edit route + score.
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

  if (res.status !== 200 || typeof res.json?.newText !== 'string') {
    return { ...trialMeta(t), error: `HTTP ${res.status}: ${res.text.slice(0, 120)}`, before };
  }
  const after = res.json.newText;

  // preservation (deterministic ground truth): hard violations drive k/n; 'review' findings
  // (a quantity spelled out) are surfaced for adjudication, not counted against the score.
  const findings = preservationViolations(gold, after);
  const violations = findings.filter((v) => v.severity !== 'review');
  const reviews = findings.filter((v) => v.severity === 'review');

  // preservation (cross-model diff-aware, open-class) — additive, hand-adjudicated later
  let llmMissing = null;
  if (useLlm && isLlmAvailable()) {
    const diff = await crossModelEntityDiff({ before, after });
    if (diff && diff.missing) llmMissing = diff.missing;
  }

  // effectiveness
  const changed = after.trim() !== before.trim();
  const grew = after.length > before.length;
  let judged = null;
  if (useLlm && isLlmAvailable() && t.hard) {
    judged = await effectivenessJudge({ before, after, instruction: t.instruction });
  }

  // leak
  const leak = preambleLeak(after);

  return {
    ...trialMeta(t),
    before,
    after,
    goldCount: gold.closed.length + gold.groups.length,
    violations,
    reviews,
    llmMissing,
    changed,
    grew,
    lenBefore: before.length,
    lenAfter: after.length,
    judged,
    leak,
    rationale: res.json.rationale ?? null,
  };
});
process.stdout.write('\n\n');

function trialMeta(t) {
  return {
    blockId: t.blockId,
    instructionId: t.instructionId,
    variant: t.variant,
    hard: t.hard,
    expectShorter: t.expectShorter,
    instruction: t.instruction,
  };
}

// ── aggregate + report ────────────────────────────────────────────────────────
const ok = results.filter((r) => !r.error);
const errored = results.filter((r) => r.error);

// per-instruction preservation k/n (clean = zero deterministic violations)
const perInstruction = INSTRUCTIONS.map((instr) => {
  const rs = ok.filter((r) => r.instructionId === instr.id);
  const clean = rs.filter((r) => r.violations.length === 0);
  return { id: instr.id, hard: instr.hard, n: rs.length, k: clean.length };
});

const allViolations = ok.flatMap((r) =>
  r.violations.map((v) => ({
    blockId: r.blockId,
    instruction: r.instructionId,
    variant: r.variant,
    kind: v.kind,
    entity: v.entity,
    note: v.note,
    before: r.before,
    after: r.after,
  })),
);

// Deterministic REVIEW flags (a quantity spelled out) — for hand-adjudication, not counted.
const allReviews = ok.flatMap((r) =>
  r.reviews.map((v) => ({ blockId: r.blockId, instruction: r.instructionId, entity: v.entity, note: v.note, before: r.before, after: r.after })),
);

// LLM-flagged (open-class) misses the regex layer didn't already catch — for hand-adjudication.
const llmFlags = ok.flatMap((r) =>
  (r.llmMissing ?? [])
    .filter((m) => !r.violations.some((v) => (v.entity || '').toLowerCase().includes((m.entity || '').toLowerCase())))
    .map((m) => ({ blockId: r.blockId, instruction: r.instructionId, entity: m.entity, issue: m.issue, before: r.before, after: r.after })),
);

const totalTrials = ok.length;
const cleanTrials = ok.filter((r) => r.violations.length === 0).length;
const preservationPct = totalTrials ? (100 * cleanTrials) / totalTrials : 0;

// effectiveness
const substantial = ok.filter((r) => r.lenBefore >= 80);
const changedAll = ok.filter((r) => r.changed).length;
const changedSub = substantial.filter((r) => r.changed).length;
const tightenRs = ok.filter((r) => r.expectShorter);
const tightenShorter = tightenRs.filter((r) => r.lenAfter <= r.lenBefore).length;
const judgedRs = ok.filter((r) => r.judged && typeof r.judged.applied === 'boolean');
const judgedApplied = judgedRs.filter((r) => r.judged.applied).length;
// The meaningful judge denominator: hard instructions on SUBSTANTIAL blocks. Short structural
// lines (a date, a title) legitimately no-op, so "not applied" there is correct, not a failure.
const judgedSubRs = judgedRs.filter((r) => r.lenBefore >= 80);
const judgedSubApplied = judgedSubRs.filter((r) => r.judged.applied).length;
const leaks = ok.filter((r) => r.leak);
const meanDrift =
  ok.length ? ok.reduce((a, r) => a + (r.lenAfter - r.lenBefore) / r.lenBefore, 0) / ok.length : 0;

// ── print ──────────────────────────────────────────────────────────────────
const line = '─'.repeat(72);
console.log(line);
console.log('NAME / ENTITY-FIDELITY EVAL — RESULTS');
console.log(line);
console.log(`base URL      : ${base}`);
console.log(`deploy SHA    : ${sha ?? '(local run — pass --sha for the recorded prod run)'}`);
console.log(`editor model  : ${EDITOR_MODEL} @ temp ${EDITOR_TEMP}  (configured; confirm vs deploy env)`);
console.log(`extractor     : deterministic regex (ground truth)${useLlm && isLlmAvailable() ? ` + cross-model ${EXTRACT_MODEL}` : ' only'}`);
console.log(`run at        : ${new Date().toISOString()}`);
console.log(`entity-bearing blocks (N): ${blocks.length}   ·   trials: ${totalTrials}${errored.length ? ` (+${errored.length} errored)` : ''}`);
console.log('');

console.log('PRESERVATION — per instruction (clean trials / total; entity-bearing denominator)');
for (const p of perInstruction) {
  const bar = p.n ? '█'.repeat(Math.round((10 * p.k) / p.n)).padEnd(10, '░') : '──────────';
  console.log(`  ${p.id.padEnd(14)}${p.hard ? '★' : ' '} ${String(p.k).padStart(2)}/${String(p.n).padEnd(2)}  ${bar}`);
}
console.log(`  ${'—'.repeat(30)}`);
console.log(`  headline preservation: ${cleanTrials}/${totalTrials}  ≈ ${preservationPct.toFixed(0)}%   (★ = over-sampled hard instruction)`);
console.log('');

console.log('VIOLATION LIST (lead with this, not the %):');
if (!allViolations.length) {
  console.log('  (none — every deterministic ground-truth entity preserved across all trials)');
} else {
  for (const v of allViolations) {
    console.log(`  ✗ [${v.blockId} · ${v.instruction}] ${v.kind} "${v.entity}" ${v.note}`);
    console.log(`      before: ${v.before.slice(0, 90)}`);
    console.log(`      after : ${v.after.slice(0, 90)}`);
  }
}
console.log('');

if (allReviews.length || llmFlags.length) {
  console.log(`REVIEW / ADJUDICATE (soft flags — NOT counted against k/n until confirmed):`);
  for (const v of allReviews) {
    console.log(`  ~ [${v.blockId} · ${v.instruction}] quantity "${v.entity}" — ${v.note}`);
    console.log(`      before: ${v.before.slice(0, 90)}`);
    console.log(`      after : ${v.after.slice(0, 90)}`);
  }
  for (const f of llmFlags) {
    console.log(`  ? [${f.blockId} · ${f.instruction}] cross-model: "${f.entity}" (${f.issue})`);
  }
  console.log('');
}

console.log('EFFECTIVENESS (the ceiling a no-op fails — fidelity alone would read 100% for a no-op):');
console.log(`  changed text (all)          : ${changedAll}/${totalTrials}`);
console.log(`  changed text (substantial ≥80 chars): ${changedSub}/${substantial.length}`);
console.log(`  tighten did not grow        : ${tightenShorter}/${tightenRs.length}`);
if (judgedSubRs.length) console.log(`  cross-model "instruction applied?" (hard, substantial): ${judgedSubApplied}/${judgedSubRs.length}`);
if (judgedRs.length) console.log(`  cross-model "instruction applied?" (hard, all incl. short no-ops): ${judgedApplied}/${judgedRs.length}`);
console.log('');

console.log('LEAK + DRIFT (validates the structured-output / forced-tool decision):');
console.log(`  preamble/refusal/fence leaks: ${leaks.length}/${totalTrials}`);
console.log(`  mean length drift           : ${(meanDrift * 100).toFixed(1)}%`);
if (errored.length) {
  console.log('');
  console.log(`ERRORS (${errored.length}):`);
  for (const e of errored.slice(0, 8)) console.log(`  ! [${e.blockId} · ${e.instructionId}] ${e.error}`);
}
console.log(line);

// ── artifact ─────────────────────────────────────────────────────────────────
const artifact = {
  meta: {
    base,
    deploySha: sha ?? null,
    editorModel: EDITOR_MODEL,
    editorTemp: EDITOR_TEMP,
    extractor: { deterministic: true, crossModel: useLlm && isLlmAvailable() ? EXTRACT_MODEL : null },
    runAt: new Date().toISOString(),
    doc: { filename: doc.filename, blocks: allBlocks.length, entityBearing: blocks.length },
  },
  headline: { preservationCleanTrials: cleanTrials, totalTrials, preservationPct: Number(preservationPct.toFixed(1)) },
  perInstruction,
  violations: allViolations,
  reviews: allReviews,
  crossModelFlags: llmFlags,
  effectiveness: {
    changedAll,
    changedSubstantial: changedSub,
    substantialN: substantial.length,
    tightenShorter,
    tightenN: tightenRs.length,
    judgedApplied,
    judgedN: judgedRs.length,
    judgedSubApplied,
    judgedSubN: judgedSubRs.length,
  },
  leaks: leaks.map((r) => ({ blockId: r.blockId, instruction: r.instructionId, leak: r.leak })),
  meanLengthDriftPct: Number((meanDrift * 100).toFixed(1)),
  errors: errored.map((e) => ({ blockId: e.blockId, instruction: e.instructionId, error: e.error })),
  trials: ok.map((r) => ({
    blockId: r.blockId,
    instruction: r.instructionId,
    variant: r.variant,
    before: r.before,
    after: r.after,
    violations: r.violations,
    reviews: r.reviews,
    changed: r.changed,
    lenBefore: r.lenBefore,
    lenAfter: r.lenAfter,
    judged: r.judged,
    leak: r.leak,
  })),
};

if (outFile) {
  writeFileSync(outFile, JSON.stringify(artifact, null, 2));
  console.log(`\n✓ wrote ${outFile}`);
}

// nonzero exit if any deterministic violation OR effectiveness collapse (guards against a silent no-op model)
const effectivenessCollapsed = substantial.length > 0 && changedSub === 0;
process.exit(allViolations.length === 0 && !effectivenessCollapsed ? 0 : 1);
