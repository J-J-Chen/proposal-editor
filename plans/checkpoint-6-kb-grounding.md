# Checkpoint 6 — KB Grounding (stretch)

**Goal:** ground edits in the firm's past work. "Add a paragraph about a past project we
did" should pull real content from the `kb/` corpus. This is the product's actual
differentiator — do it only after the core loop (CP1–4) is solid.

## In scope
- Ingest the 5 `kb/` proposals to text once (reuse the CP2 parser), chunk them.
- Retrieval: with only 5 docs, keyword/BM25 or lightweight embeddings is plenty — don't
  over-build a vector DB.
- Wire retrieved snippets into the edit prompt for KB-flavored actions ("add experience
  on similar projects", "cite a past project").
- Surface provenance in the UI (which past proposal a fact came from) to build trust.

## Out of scope
Heavy RAG infra, re-ranking, multi-doc synthesis beyond what a single edit needs.

## Approach
- Keep it grounded: the model should use retrieved text, not invent project details.
  This ties back to the CP5 fidelity concern (no hallucinated names/numbers).

## Done when
- A KB-type instruction produces an edit that visibly draws on a real `kb/` proposal,
  with provenance shown.

## Risks
- Hallucinated "past projects" if retrieval is weak → require and show provenance;
  constrain the prompt to retrieved content.

---

## Further stretch backlog (only if time remains)
- Export edited document back to PDF/DOCX.
- Graceful handling of `hard.pdf` (multi-column, tables, branding).
- Multi-paragraph chat surface (describe edits spanning many blocks at once).
