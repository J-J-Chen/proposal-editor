# Proposal Editor

Upload a proposal PDF, edit it section-by-section with AI, and apply changes with a
review-and-diff loop. Built for the Buoyant Founding Engineer take-home.

**Live app:** https://proposal-editor-sandy.vercel.app

> Status: Checkpoint 1 done — app scaffolded and deployed; the edit loop lands in CP2–CP4.
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
_TODO (CP5): PDF representation, agent design, UX — with brief justifications._

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
