# Plan — Proposal Editor (initial / master plan)

_Date: 2026-08-26 · Owner: John Chen (J-J-Chen) · Deadline: TBD from Buoyant_

> **STATUS — historical master plan.** The app is built and deployed; the current source of truth is the graded `README.md` + `docs/`. Kept unedited to show how the work evolved (the brief asks to see that).

This is the saved initial plan. Priorities and checkpoints below; per-checkpoint detail
lives in the sibling `checkpoint-*.md` files. **Milestones are not strict** — reorder or
cut to keep momentum. **Speed first; correctness/tests are good but not important.**

## Mission

Build + deploy a Next.js/TS web app: upload a proposal PDF → interact with it in the
browser → select a paragraph/section → ask AI to edit it → review the diff → apply.
Edits compose; undo where possible.

**The bar (pass/fail):** `proposals/easy.pdf` works end-to-end on the *deployed* app.
Everything else is upside and only counts once the loop is solid.

## The one architectural bet

**Don't edit the PDF — convert it once into a clean, structured, editable document and
run the whole loop on that.**

PDF → ordered list of typed **blocks** (`heading | paragraph | list-item | ...`), each
with a **stable id** and provenance (page). Render blocks as semantic HTML. Then:

- **Select** = click a real DOM element (native selection; no pdf.js text-layer pain).
- **Apply** = replace `block.text` in state.
- **Compose** = successive applies mutate the same doc model.
- **Undo** = pop an edit-history stack of `{blockId, before, after}`.

We drop pixel-fidelity of the original on purpose — the brief blesses this. Output view
is clean HTML, not a PDF replica.

## Key decisions

| Area | Decision |
|------|----------|
| PDF → structure | **Hybrid:** deterministic text+layout extraction (pdf.js/pymupdf) → LLM segments/cleans/labels into blocks JSON. **Cache by file hash.** |
| Doc model | Flat ordered array of typed blocks w/ stable ids + page provenance. |
| Rendering | Blocks → semantic HTML document (center column). |
| Selection unit | The block (paragraph/heading/list-item). Click to select. |
| Edit UI | Inline toolbar / side panel: Rewrite · Tighten · Fix names · Change tone · free-text. |
| Review | Word-level diff (jsdiff / diff-match-patch), Apply / Reject. |
| Undo | Edit-history stack (also an audit trail for the demo). |
| AI | Buoyant proxy via official SDKs, server-side only. Structured output (no preamble). Default provider: Anthropic for edits. |
| Guardrail | Change only what's asked; preserve proper nouns / project numbers / $ figures. |
| Persistence | None (client state; optional localStorage). No DB. |
| Eval | Name / entity fidelity — real number in README (CP5). |
| OCR | Not needed (all fixtures have a text layer). Scanned = known gap. |

## Checkpoints (milestones, not strict)

1. **Scaffold + Deploy** — Next.js/TS, proxy wiring, Vercel deploy, prove an AI call in prod. → `checkpoint-1-scaffold-deploy.md`
2. **PDF → Structured Blocks** — hybrid parse, cache by hash, upload endpoint. → `checkpoint-2-pdf-parse.md`
3. **Render + Select** — blocks → HTML doc, click-select, edit panel. → `checkpoint-3-render-select.md`
4. **Edit Loop** — AI edit → diff → apply/reject → compose → undo. **Closes the bar.** → `checkpoint-4-edit-loop.md`
5. **Eval + README** — run name-fidelity eval (real numbers), fill graded README. → `checkpoint-5-eval-readme.md`
6. **KB Grounding (stretch)** — RAG over `kb/` to ground edits in past work (read-only; no enrichment). → `checkpoint-6-kb-grounding.md`
7. **Refine Suggestions (beyond-brief)** — proactive rubric-driven "places to refine" list; each Accept routes through the CP4 loop; the same rubric scores the CP5 eval. → `checkpoint-7-refine-suggestions.md`

Critical path to the bar: **1 → 2 → 3 → 4**. CP5 is required for grading. **Post-bar build order:
CP5 (rubric spine + entity dict + fidelity eval — folds in CP7 Phase 0) → CP7 Phase 1 (Refine panel
MVP) → CP7 Phase 2 (Adjust + README numbers) → CP6 (KB grounding, if time).** CP6/CP7 are upside;
CP7 sits **ahead of CP6** since Accept/Reject demos without RAG.

## Deliberately cut (say so in README)

Pixel-perfect PDF fidelity · export-back-to-PDF · robust multi-column/table handling &
`hard.pdf` · multi-paragraph chat · DB / auth / multi-user · OCR · exhaustive tests ·
**KB enrichment / write-back** (the product KB stays read-only grounding — CP7 decision).

## Top risks / failure modes to watch

- Cover-page duplicated/overlapping text, headings glued to bodies, multi-column reading
  order → the parse must clean these. (Seen in `easy.pdf` pages 1–2.)
- LLM silently changing names/numbers it shouldn't (→ the CP5 eval).
- LLM prose preamble leaking into applied text (→ structured output).
- Parse latency/cost & spend caps (→ cache by hash; work against `easy.pdf`).
- Hidden fixture with no text layer (→ documented gap, not built).

## Working model

All code work on worktrees, landed via the local merge queue; main stays clean. See
`AGENTS.md` §5. Worktrees enable parallel multi-agent work per checkpoint.
