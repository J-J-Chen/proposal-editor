// e2e-verify.mjs — end-to-end smoke test of the SHIPPED edit loop.
//
// Usage:  node scripts/e2e-verify.mjs [baseUrl]
//   baseUrl defaults to the deployed app; pass http://localhost:3000 to test locally.
//
// Verifies the two API halves the product depends on:
//   1. POST /api/parse  → returns a Doc with blocks (real parse or the fixture stub).
//   2. POST /api/edit   → rewrites a chosen block AND preserves a key entity
//                         (effectiveness: after != before; fidelity: entity still present).
// This is the integration owner's gate: it must pass on the deployed URL before we call the
// bar met, and it doubles as the skeleton the CP5 eval harness extends.

const base = (process.argv[2] || 'https://proposal-editor-sandy.vercel.app').replace(/\/$/, '');
let failed = 0;
const ok = (cond, msg) => { console.log(`${cond ? '✓ PASS' : '✗ FAIL'}  ${msg}`); if (!cond) failed++; return cond; };

async function post(path, body) {
  const r = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = null; }
  return { status: r.status, json, text };
}

console.log(`e2e-verify against ${base}\n`);

// --- 1. parse ---
// easy.pdf's sha256 — hits the committed L0 parse-cache seed, so this is a pure cache-hit smoke
// (no upload/LLM needed). A genuinely unknown hash now returns 422 { needsUpload:true } by design.
const EASY_SHA = '03dd3ee8dd7962eb11fd67dd223cfdcdcd0e4f8957aa8622ac24d929cd8c5829';
const parse = await post('/api/parse', { hash: EASY_SHA, filename: 'easy.pdf' });
ok(parse.status === 200, `/api/parse → 200 (got ${parse.status})`);
const blocks = parse.json?.doc?.blocks ?? [];
ok(Array.isArray(blocks) && blocks.length > 0, `/api/parse → doc has blocks (got ${blocks.length})`);

// Pick a SUBSTANTIAL entity-bearing block so a rewrite has room to actually change text
// (a short, already-formal header is a legit no-op for "make more formal" and would give a
// false effectiveness failure). Prefer the longest entity-bearing paragraph.
const ENTITY_HINTS = ['MECO', 'Dixon', 'Wiles', '$', 'PE No', 'Project No'];
const entityIn = (b) => ENTITY_HINTS.find((h) => (b.text || '').includes(h));
let target =
  blocks.filter((b) => (b.text || '').length >= 80 && entityIn(b)).sort((a, b) => b.text.length - a.text.length)[0] ||
  blocks.find(entityIn) ||
  [...blocks].sort((a, b) => (b.text?.length || 0) - (a.text?.length || 0))[0];
let entity = target && entityIn(target);
console.log(`  target block ${target?.id}: "${(target?.text || '').slice(0, 70)}…"${entity ? `  (entity: ${entity})` : ''}\n`);

// --- 2. edit ---
const before = target?.text || '';
const edit = await post('/api/edit', {
  block: { id: target?.id, text: before, type: target?.type },
  instruction: 'Rewrite this more concisely and formally, keeping every name, number, date, and dollar figure exactly.',
});
ok(edit.status === 200, `/api/edit → 200 (got ${edit.status})${edit.status !== 200 ? '  ' + edit.text.slice(0, 160) : ''}`);
const after = edit.json?.newText;
ok(typeof after === 'string' && after.trim().length > 0, `/api/edit → non-empty newText`);
if (typeof after === 'string') {
  ok(after.trim() !== before.trim(), `effectiveness: edit changed the text (a no-op would fail here)`);
  if (entity) ok(after.includes(entity), `fidelity: entity "${entity}" preserved in the edit`);
  // refusal/preamble leak — structured output should keep prose out of applied text.
  ok(!/^\s*(sure|here('| i)s|certainly|okay)\b/i.test(after) && !after.includes('```'),
     `no preamble/refusal leak in applied text`);
}

console.log(`\n${failed === 0 ? '✓ ALL PASS — deployed edit loop is live' : `✗ ${failed} check(s) failed`}`);
process.exit(failed === 0 ? 0 : 1);
