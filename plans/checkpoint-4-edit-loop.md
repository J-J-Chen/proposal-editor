# Checkpoint 4 — Edit Loop (closes the bar)

**Goal:** the full loop works end-to-end on the deployed app: select a block → ask AI →
review a diff → apply → edits compose → undo / redo. **This is the pass/fail checkpoint.**

## In scope
- Server route: `{ blockText, instruction, docContext, [kbContext] }` → LLM → new text.
  Structured output (return only the rewritten text + optional short rationale).
- Edit prompt guardrail: change only what's asked; **preserve all proper nouns, project
  numbers, and dollar figures** unless told otherwise.
- Word-level diff view (jsdiff / diff-match-patch) of current vs proposed.
- Apply / Reject. The proposal lives in a separate `pending` slot: Apply appends a
  `HistoryEntry` to the `history` log and advances the `cursor`; Reject just nulls `pending`
  (never touches history, so it can't pollute undo/redo).
- Compose (multiple edits across blocks) + **Undo AND Redo** (⌘Z / ⌘⇧Z + buttons, gated to
  `status === 'idle'`) via the cursor over the log. A new edit after an undo discards the redo future.
- Verify the whole thing **on the deployed URL** with `easy.pdf`.

## Out of scope
Multi-paragraph chat (stretch). Export to PDF (stretch). KB grounding (CP6). Structural block
edits (insert/delete/reorder) and non-linear/branching history — the `op`-union + `groupId`
seams are reserved as cheap future-proofing only, not built.

## Approach
- Give the model light doc context (nearby headings, firm name) for voice consistency.
- Keep latency honest: stream if easy, otherwise a crisp loading state.
- The `history` log doubles as a demo-friendly audit trail (rows: block, instruction, before→after, time).
- Stale-pending guard: proposal records `baseCursor`; Apply drops it if the cursor moved (user undid mid-review).
- `loadDoc` (new / re-parsed PDF) resets history + cursor — a new document is a fresh history.

## Done when
- On the **deployed** app: upload `easy.pdf` → select → edit → see diff → apply →
  applied change is visible → a second edit composes → undo reverts → redo re-applies →
  a fresh edit after an undo correctly discards the redo future. Loop closed.

## Risks
- Model preamble leaking into applied text → structured output.
- Silent name/number changes → guardrail + CP5 eval.
- Diff granularity confusing users → word-level, clear add/remove styling.
