# Architecture & Reasoning

The design and *why*. Decisions get logged as they're made in [decisions.md](decisions.md).

## The central bet: edit a model, not a PDF
Convert the PDF **once** into a clean, structured, editable document and run the entire loop
on that — never edit the PDF in place.

PDF → ordered list of typed **blocks** → render as semantic HTML → edit the blocks.

Why: PDFs expose no structure and are painful to select/edit inside. Once we have a block
model rendered as real DOM:
- **Selection** = clicking a DOM node (native; no pdf.js text-layer fighting).
- **Apply** = replace `block.text` in state.
- **Compose** = successive applies mutate the same model.
- **Undo / redo** = move a cursor over an inverse-command edit log (see The edit loop).

We deliberately drop pixel-fidelity of the original. The brief explicitly blesses this
("the core problem is the edit loop, not PDF reconstruction"). Trying to re-render the
original pixel-perfect is the trap that sinks the 4-hour budget.

## The document model
Flat, ordered array of blocks (sections derived from heading blocks):

```ts
type BlockType = 'heading' | 'paragraph' | 'list-item' | 'caption' | 'table' | 'other';
interface Block {
  id: string;          // stable — derived from content+order so it survives re-parse
  type: BlockType;
  text: string;
  level?: number;      // for headings
  page: number;        // provenance (for "reflected in doc" + optional highlight)
}
interface Doc { id: string; filename: string; blocks: Block[]; }
```

Stable ids matter: edits target a block by id, and undo/compose rely on identity.

## Parsing: hybrid, cached
1. **Deterministic extraction** (pdf.js in-app, or a server extractor): spans with text +
   font size/weight + x/y + page. Free, instant.
2. **LLM structuring pass**: raw spans → blocks JSON. This is what cleans the messes we
   verified in the fixtures: duplicated cover text, headings glued to bodies, multi-column
   reading order. Use **structured output** (tool/JSON schema) so the model returns data,
   not prose.
3. **Cache by file hash** (content hash → parsed doc): committed pre-parsed seed JSON in
   `src/parse-cache/` plus an in-process map — no disk, DB, or Blob *as the store*. (Vercel Blob
   is used only to upload a large PDF's bytes on a genuine cache miss.) Parsing is slow and
   metered — parse each file once.

Rationale: heuristics alone choke on the branded/multi-column layout; pure-LLM-on-raw-text is
slow/expensive and loses layout cues. Hybrid gets robustness at bounded cost, and generalizes
to the hidden fixture better than fixture-specific heuristics.

## The edit loop
`{ blockText, instruction, docContext, kbContext? }` → server route → LLM → new text.
- **Guardrail (critical):** change only what's asked; **preserve all proper nouns, project
  numbers, and dollar figures** unless explicitly told otherwise. This is the #1 silent
  failure in this domain and is exactly what the CP5 eval measures.
- Show a **word-level diff** (jsdiff / diff-match-patch); user Applies or Rejects.
- Light doc context (nearby headings, firm name) keeps voice consistent.

### State: an inverse-command log + a cursor (undo *and* redo)
All edit state lives in one `useReducer` over `EditorState`, with three slots kept separate so
they can't corrupt each other:
- **`doc`** — the live, fully-applied block model. This is what renders.
- **`history: HistoryEntry[]` + `cursor`** — the edit log. `cursor` is the *count* of applied
  entries: `[0, cursor)` are live, `[cursor, len)` are redoable. It doubles as the audit trail.
- **`pending`** — the AI proposal under diff-review. **Not in history**; Reject just nulls it, so
  a rejected edit is structurally incapable of polluting undo/redo (an invariant, not a rule to remember).

Each entry is the `{ blockId, before, after }` we already had, promoted to a first-class op and
enriched for the audit trail (`instruction`, `rationale?`, `at`):

```ts
type EditOp = { kind: 'setText'; blockId: string; before: string; after: string };
  // reserved (NOT built now): 'insert' | 'delete' | 'move' — structural edits widen this additively
interface HistoryEntry {
  id: string; op: EditOp; groupId: string;   // groupId → a future multi-block edit undoes atomically
  instruction: string; rationale?: string; at: number;   // audit fields
}
```

- **Undo** = `cursor--` + `invertOp` (write `before`). **Redo** = `cursor++` + `applyOp` (write
  `after`). One array, one cursor — no second stack. `canUndo = cursor > 0`,
  `canRedo = cursor < len` (both derived, never stored). ⌘Z / ⌘⇧Z, gated to `status === 'idle'`.
- **Redo-invalidation** = `history.slice(0, cursor).concat(entry)` on Apply — a new edit after an
  undo drops the abandoned redo future, correct by construction, in one line.
- **Compose** falls out: each entry carries its own `blockId`, so edits across many blocks form a
  flat linear log that undo peels back in exact reverse.
- **Stale-pending guard:** the proposal records `baseCursor`; Apply drops it if `baseCursor !==
  cursor` (user undid mid-review), and select/undo/redo clear `pending`. `loadDoc` resets history.
- Keep undo/redo strictly **linear LIFO** — no branching/cherry-pick (that's the real time-sink).
  Undo/redo route through `applyOp`/`invertOp`, so structural ops widen the union additively later.
  See [decisions.md](decisions.md) for the alternatives rejected (snapshots, Immer, zundo, CRDT).

## AI usage
- Buoyant proxy via the **official SDKs**, **server-side only** (token never hits the browser).
- Default provider: **Anthropic** for edit quality; a smaller/faster model is fine for the
  structuring pass if quality holds. Mind the spend cap → cache, small prompts.

## Evaluation
**Name / entity fidelity** — % of preservation-type edits that keep every entity that should
be untouched. On-brand (the brief foregrounds names), automatable, and yields a real number.
See [checkpoint 5](../plans/checkpoint-5-eval-readme.md).

## KB grounding (stretch)
One interaction — **"Add similar experience"**: retrieve real past projects from the 5 `kb/`
proposals (in-memory keyword overlap over the committed `src/kb/` module (`voice.ts`/`facts.ts`); no DB/vector/BM25
stats), show provenance on candidate cards, **the human picks one before any generation**, then
compose the inserted paragraph with the LLM **in MECO's voice** using only that project's facts,
guarded by a deterministic entity-verbatim **fidelity net** (template fallback on failure). Insert
via the reserved `'insert'` EditOp (undo removes it). A firm **voice card** mined from the KB is
injected into the `docContext` of *every* edit, not just KB ones. Ingest is programmatic (reuse the
parser) but the field bindings are **hand-verified**; `projectNumber` is deliberately not indexed
(the `001-xxx` values are the SOQ's own doc id). The same retrieval + provenance also power
**grounded rationales** on suggestions (a real KB quote as the verifiable "why"), with the CP5
rubric supplying the deterministic reason — never free-form LLM justification. Full design +
rationale: [checkpoint 6](../plans/checkpoint-6-kb-grounding.md).

## Boundaries / structure (best-practice, cheaply)
Keep concerns separated without over-engineering a 4-hour app:
- `parse/` (extraction + structuring + cache), `model/` (Doc/Block types + the `EditOp` union +
  `applyOp`/`invertOp` + the edit-loop reducer; only `setText` built, union reserved for structural edits),
  `ai/` (proxy clients, prompts, structured-output schemas), `app/api/*` (route handlers),
  UI components (document view, block selection, diff/apply panel). Exact layout is the
  scaffold's call; the point is: parsing, model, AI, and UI don't bleed into each other.

## What we're NOT doing
See [goals.md](goals.md) non-goals. Notably: no OCR (fixtures have a text layer), no PDF
reconstruction, no DB by default.
