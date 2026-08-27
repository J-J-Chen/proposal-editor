# Proposal Editor

Upload a proposal PDF, edit it section-by-section with AI, and apply changes with a
review-and-diff loop. Built for the Buoyant Founding Engineer take-home.

**Live app:** https://proposal-editor-sandy.vercel.app

> Status: CP1 done (scaffold + deploy). UI foundation in progress — the select → edit → review →
> keep/undo loop runs on a seeded document with a mock suggestion; real parse (CP2) + real AI edit
> route (CP4) slot in behind the same interfaces.
> This README is graded and gets filled in during Checkpoint 5.
> See `plans/00-overview.md` for the plan and `AGENTS.md` for how the repo works.

---

## Quick start

```sh
npm install
cp .env.example .env.local   # then paste your Buoyant proxy token
npm run dev
```

---

## Design decisions
_Full rationale in [docs/architecture.md](docs/architecture.md) (model) and
[docs/design-ui.md](docs/design-ui.md) (UI); the decision log is [docs/decisions.md](docs/decisions.md)._

- **Edit a structured block model, not the PDF.** Parse each PDF once into an ordered list of typed
  blocks, render as clean semantic HTML, and run the whole edit loop on that. Selection = clicking a
  DOM node; apply = replace `block.text`; compose + undo fall out. Pixel-fidelity to the PDF is
  dropped on purpose (the brief blesses this — the problem is structure *recovery*, not reconstruction).
- **Hybrid parse, cached by file hash.** Deterministic text+layout extraction (mupdf/WASM) →
  heuristics do ~80% of structuring → one cheap LLM call labels lines *by reference* (never re-emits
  text, so proper nouns/numbers can't be corrupted). Cached so each file is parsed once.
- **UX built for a Word-native, non-technical user — "recognisable, not identical."** The audience
  lives in MS Word. We borrow Word's **habits and plain words** (Open not Upload; review a suggested
  change and Keep/Discard it; Undo/Redo top-left; a page that looks like a document; a helper pane on
  the right) but give the product its **own calm skin** rather than cloning the ribbon (a faithful
  clone hits the "broken Word" uncanny valley). The AI's change is shown as a **calm stacked "the
  wording now / the suggested new wording" card**, not a developer diff; protected names/numbers are
  visibly preserved (gold tint + a confirm to change one). See the mockups:
  [Familiar as Word](https://claude.ai/code/artifact/acc75563-5a8d-463f-9fbc-97e8623d4404).
- **Undo/redo as an inverse-command log + cursor** (one array, no second stack); reject-isolation and
  redo-invalidation correct by construction; the log doubles as the audit trail.
- **AI only via the Buoyant proxy, server-side**, structured output, with a hard guardrail: change
  only what's asked, **preserve every proper noun, project number, and dollar figure**.
- **No database by default** — client state (optional localStorage/Blob for the parse cache).

## What I cut and why
_TODO (CP5): specifics._
- **KB enrichment / write-back — cut.** The planned proactive "Refine" feature
  (`plans/checkpoint-7-refine-suggestions.md`) reads the knowledge base to ground edits but the
  **product KB stays read-only** — accepted edits are not written back into it. Rationale: it
  needs persistence and risks laundering unreviewed model output into "canonical" past work.
- **Feeding suggestion outcomes back into the KB — deferred.** The Refine feature captures
  Accept/Reject/Adjust signal; wiring that back (which sink, and whether it persists) is a
  deliberate deferral, revisited in "What I'd build next."

## Failure modes I worried about
_TODO (CP5): silent-failure risks; what I'd check before a paying customer._

## How I'd evaluate this
_TODO (CP5): the metric + a real run with real numbers (name/entity fidelity)._

## What I added beyond the brief and why
_TODO (CP5)._

## What I'd build next given another 8 hours
_TODO (CP5)._
- Revisit the deferred **suggestion-outcome → KB feedback loop** — pick a sink (ground future
  edits, personalization, or corpus enrichment) and, if it earns persistence, back it with a
  store. See `plans/checkpoint-7-refine-suggestions.md`.
