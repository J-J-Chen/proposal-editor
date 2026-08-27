# Goals, Priorities & Non-Goals

## Goal
Ship + deploy a proposal editor whose core edit loop works end-to-end on `easy.pdf`, that
demonstrates strong product judgment, and whose README defends every decision with reasoning
and one real evaluation.

## Priorities (owner directive — overrides default instincts)
1. **Speed first.** Get the loop closed and deployed. Prefer the smallest thing that works.
2. **Correctness & tests: good but not important.** Don't gold-plate; skip tests unless a
   test is the fastest way to unblock. Follow reasonable architectural practices, but don't
   let perfect be the enemy of shipped.
3. **Milestones are not strict.** Reorder/cut checkpoints freely to keep momentum.
4. **Best-practice structure, cheaply.** Decompose sensibly — not everything in one file —
   but don't over-abstract for a 4-hour build.

## Success criteria
- ✅ Deployed app: upload `easy.pdf` → select → AI edit → diff → apply → compose → undo.
- ✅ Generalizes to an unseen SOQ-style PDF (doesn't crash / degrades gracefully).
- ✅ README: all 7 sections filled, one evaluation run with real numbers.
- ✅ Clean, legible commit history (no squashing).

## Non-goals (explicitly cut — see also [decisions.md](decisions.md))
Pixel-perfect PDF fidelity · export-back-to-PDF · robust multi-column/table handling &
`hard.pdf` · multi-paragraph chat · DB / auth / multi-user · OCR · exhaustive test suites ·
KB enrichment / write-back (the product KB stays read-only grounding — see [decisions.md](decisions.md)).
Any of these can become a goal later; today they are out.

## How we'll know it's working (if shipped to prod)
Primary signal: **name/entity fidelity** — edits preserve the proper nouns, project numbers,
and dollar figures they shouldn't touch. Measured in [checkpoint 5](../plans/checkpoint-5-eval-readme.md).
Secondary (future): edit acceptance rate, latency, hallucination rate.
