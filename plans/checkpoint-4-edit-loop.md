# Checkpoint 4 — Edit Loop (closes the bar)

**Goal:** the full loop works end-to-end on the deployed app: select a block → ask AI →
review a diff → apply → edits compose → undo. **This is the pass/fail checkpoint.**

## In scope
- Server route: `{ blockText, instruction, docContext, [kbContext] }` → LLM → new text.
  Structured output (return only the rewritten text + optional short rationale).
- Edit prompt guardrail: change only what's asked; **preserve all proper nouns, project
  numbers, and dollar figures** unless told otherwise.
- Word-level diff view (jsdiff / diff-match-patch) of current vs proposed.
- Apply / Reject. Apply mutates `block.text` and pushes `{ blockId, before, after }` onto
  an undo stack. Reject discards.
- Compose (multiple edits across blocks) + Undo (⌘Z / button).
- Verify the whole thing **on the deployed URL** with `easy.pdf`.

## Out of scope
Multi-paragraph chat (stretch). Export to PDF (stretch). KB grounding (CP6).

## Approach
- Give the model light doc context (nearby headings, firm name) for voice consistency.
- Keep latency honest: stream if easy, otherwise a crisp loading state.
- Undo stack doubles as a demo-friendly audit trail.

## Done when
- On the **deployed** app: upload `easy.pdf` → select → edit → see diff → apply →
  applied change is visible → a second edit composes → undo reverts. Loop closed.

## Risks
- Model preamble leaking into applied text → structured output.
- Silent name/number changes → guardrail + CP5 eval.
- Diff granularity confusing users → word-level, clear add/remove styling.
