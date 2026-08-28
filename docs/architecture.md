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

Each entry is a first-class operation plus audit metadata. Model prose describes **what changed**;
trust evidence is stored separately as structured grounding:

```ts
type EditOp =
  | {
      kind: 'replace'; blockId: string; before: string; after: string;
      provenanceChange?: { before?: KbProvenance; after?: KbProvenance };
    }
  | { kind: 'insert'; afterId: string | null; block: Block }
  | { kind: 'delete'; blockId: string; before: Block };
interface HistoryEntry {
  op: EditOp; at: string; source: 'ai' | 'user' | 'kb';
  changeSummary?: string;
  grounding?: GroundedRationale;
  provenance?: KbProvenance;
  groupId?: string; // contiguous chat edits undo/redo atomically
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

## KB grounding
One explicit interaction — **“Add similar experience”** — reads a fixed corpus distilled from
exactly the five `kb/` proposal examples. `easy.pdf` and `hard.pdf` are fixtures, never corpus
sources. Runtime search is deterministic weighted keyword overlap over 17 hand-reviewed project
records in `src/kb/corpus.ts`; there is no DB, embedding call, or runtime PDF ingest.

The trust sequence is enforced in the shape of the product: candidate cards expose a verbatim
quote, source proposal, and page first; **the human chooses one before any generation**; compose
accepts only its opaque id and resolves the approved facts server-side. The ordinary guarded edit
service shapes a source-only draft in the resolved document voice. A hard post-generation gate
occurrence-counts protected entities, digit and spelled-out quantities, engineering notation,
likely proper names (including corpus punctuation variants), and factual single-token place subjects,
while a project-specific coverage check retains the chosen title, client, location, and each scope
claim. Any model error or miss returns the deterministic factual draft—no retry and no partial
unverified output.

The result enters the same pending review slot as every edit, rendered as an all-add diff. Only
Keep creates the reserved `insert` EditOp with `source: 'kb'`; Discard is a structural no-op, and
Undo/Redo remove/restore the block and its provenance. Inserted blocks keep a visible source/page
badge until their wording is later rewritten; that replace op clears the now-stale badge and
records the provenance transition so Undo restores it. Ordinary edits never receive project facts.

Voice and facts are separate inputs. `src/kb/voice.ts` holds a versioned profile whose prompt-facing
rules and examples are fact-free/delexicalized; one compiler supplies it to direct edits, Refine,
chat planning, chat drafting/repair, and KB compose. The firm profile is used only on a positive
firm match; unknown uploads use bounded samples from themselves. Visible “why” text is structured
grounding: a deterministic rubric reason plus document evidence, or the selected KB quote plus
provenance. Model-authored text is labeled only as a change summary. Full design and validation:
[checkpoint 6](../plans/checkpoint-6-kb-grounding.md).

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
