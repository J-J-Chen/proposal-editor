# Checkpoint 5 — Evaluation + README

> **STATUS — DONE.** Eval run + graded README shipped; the recorded numbers live in `README.md` §5. Historical plan below.

**Goal:** run one real evaluation **against the shipped edit route** and report actual
numbers (not just a method), then fill in the graded README. Required for grading.

> **Owner directives (2026-08-26).** The hidden generalization fixture is **another
> MECO-style SOQ with a real text layer** → `easy.pdf` + the KB SOQs are representative;
> no scanned/OCR path to build or eval. And **spend is not a constraint** → run the full
> grid and use the stronger / cross-model calls where they buy quality. See
> [decisions.md](../docs/decisions.md).

## What can even go wrong (this scopes the eval)
CP2 makes the **parse** entity-safe *by construction* — the structuring LLM emits only
line-range references and never re-emits text, so it cannot alter `MECO`, `041-560`,
`MO PE No. 022510`, or `$` figures. The **only** stage that can corrupt an entity is the
**CP4 edit LLM**, which rewrites `blockText`. So the eval targets the edit route, full stop.

## The metric: name / entity fidelity — plus a floor it can't game
Fidelity = *of preservation-type edits, the % that keep every should-be-untouched entity.*
Right on-brand, automatable slice — but **alone it has a perverse optimum: a no-op (return
the input unchanged, or a too-timid model) scores 100%.** It measures "don't break things"
while claiming to measure "working well." Pair it with a cheap check a no-op fails:

- **Preservation (floor):** entities the edit must NOT touch stay intact (value + present ≥1×).
- **Effectiveness (ceiling a no-op fails):** the edit actually did the thing — `after != before`;
  length drops for "tighten"; a one-shot "did this apply `<instruction>`? y/n" for tone/rewrite.

Also free, zero-LLM and worth reporting: a **preamble/refusal-leak regex** (`"Sure,"`,
`"Here is"`, leading quotes, ``` fences) — this validates the structured-output decision that
keeps prose out of applied text — and **output-length drift**.

## Dataset (from the real parsed Doc)
- Pull blocks from the **CP2 L0-seed parse of `easy.pdf`** — the exact blocks the product
  renders, at zero parse cost. Keep only **entity-bearing** blocks (the denominator that can
  actually fail) and state that N explicitly.
- **Preservation instruction set (explicit):** {tighten · make more formal · fix grammar ·
  change tone · rewrite in our voice}. **Exclude every entity-changing instruction** —
  "fix names" / "the client is wrong" are *supposed* to change an entity; scoring them as
  violations is eval failure-mode #1.
- **Stress-weight the hard cases:** over-sample "rewrite in our voice" and "change tone"
  (wholesale regeneration is where entity swaps and hallucinations actually happen); "tighten"
  (mostly deletion) reads artificially clean.
- Spend is not a constraint → run the full grid (entity-bearing blocks × instruction set,
  ≈ 60–80 trials) for a credible number, not 15.

## Run it against the SHIPPED product (the requirement most easily faked)
- POST each trial to the **real CP4 edit route** with the **exact request shape** the browser
  sends — `{ blockText, instruction, docContext }`, docContext included (so context
  contamination is in scope) — and score the **exact returned text** the UI would apply.
  **Not** a reimplemented prompt calling the SDK directly: that bypasses the deployed system
  prompt, docContext assembly, and post-processing, so the number would describe a prompt no
  user runs.
- Record **deploy SHA + edit model + date + temperature** in the README. Parse is cached
  (zero cost); only the short edit calls are metered.

## Extractor (the instrument must be more reliable than what it measures)
- **Deterministic regex = ground truth** for closed-class entities: `$` figures, MECO job
  numbers (`041-560`), `MO PE No.`, MoDOT/TAP ids, 4-digit years. The LLM may never override these.
- **One diff-aware LLM call** for open-class proper nouns only — "list every name/number in
  BEFORE that is missing or altered in AFTER" (sees both sides at once; avoids two independent
  stochastic extractions manufacturing false diffs).
- **Cross-model:** run extraction on the **other** provider (OpenAI) so the editor isn't
  grading itself — correlated blind spots hide real misses. Cost is not a constraint, so do this.
- **Value-preservation, not surface:** a legit "tighten" may collapse `MECO Engineering
  Company` → `MECO` or reformat `$2.4M` → `$2.4 million`. Build a tiny alias + `$`-normalization
  table for the known corpus entities so these don't count as violations.
- **Hand-adjudicate** every flagged violation (there'll be a handful) before it counts — turns
  a fuzzy number into a defensible one. Validate extractor recall against the before-side gold
  entities (you labelled the source blocks anyway); if it can't find entities in clean BEFORE
  text, its AFTER verdicts are worthless.

## Report honestly (this section sets the 25-min pushback agenda)
- **Lead with the violation list** (block id · instruction · entity · before→after), not the %.
- Report **raw k/n per instruction** ("tighten 18/18 · rewrite-in-voice 14/17") with the
  **entity-bearing denominator stated**; keep any blended % as a rounded headline only — no
  false precision ("94.7%" on N≈70 is a tell).
- One-line caveat naming the metric's own weakness (a no-op scores 100%) and pointing at the
  effectiveness number that rules it out.
- **Close the loop:** measure → insight → action ("misses were `$` figures reformatted by
  'rewrite in our voice'; tightened the guardrail / added normalization → re-ran → N%").

## Complementary metrics to NAME (instrument in prod; not all run now)
- **Apply/Reject acceptance rate** — the truest "working well" signal; name it as the north
  star that name-fidelity is the automatable proxy for.
- **KB-grounding hallucination** — the *inverse* of name fidelity (don't INVENT entities /
  projects). The higher-signal second eval **if CP6 ships**.

## Bonus this unlocks (optional; reuses the extractor)
The same before/after entity extractor can run **live in the diff** — "changed: client name ·
preserved: project #, PE license, $2.4M" on every edit — turning the required eval into a
visible trust surface and the strongest on-brand demo beat. Product add; coordinate with
CP3/CP4, not required to close CP5.

## The README (7 required sections — fill all, no TODOs)
1. Setup & run + **live URL** at top; `.env` / proxy notes.
2. Design decisions — PDF→blocks, **entity-safe-by-construction parse**, edit loop +
   inverse-command undo/redo, UX. Brief justifications.
3. What I cut and why — specific; pull from `00-overview.md`. (KB is a **time + trust** cut,
   not a budget cut — say so.)
4. Failure modes I worried about — silent name/number changes; parse edge cases; pre-customer checks.
5. **How I'd evaluate this** — the two-axis numbers above, the violation list, the honest
   caveat, and acceptance-rate as the north star.
6. What I added beyond the brief and why.
7. What I'd build next given another 8 hours.

## Done when
- The eval script hits the **deployed edit route**, runs the full grid, and prints
  per-instruction k/n + the violation list + the effectiveness / leak numbers.
- All 7 README sections filled with real, specific content (no TODOs); deploy SHA + model +
  date recorded.

## Risks
- Method-only, no numbers → the brief explicitly wants "measure X" closed to "here's what X is."
- Reimplemented prompt instead of the deployed route → silently violates "against your shipped product."
- "fix names" left in the preservation set → correct edits scored as violations (pessimistic number).
- Extractor noise (two stochastic passes; editor grading itself) → deterministic-first,
  diff-aware, cross-model, hand-adjudicated.
