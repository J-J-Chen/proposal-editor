# Checkpoint 2 — PDF → Structured Blocks

**Goal:** turn an uploaded PDF into a clean, ordered list of typed **blocks** with stable
ids, and cache the result so we parse each file only once.

## In scope
- Upload endpoint (accept a PDF; size-limited).
- Text + layout extraction (pdf.js or a server-side extractor): spans with text, font
  size/weight, x/y, page.
- LLM structuring pass: raw spans → blocks JSON `{ id, type, text, page }` where
  `type ∈ heading | paragraph | list-item | caption | ...`. Handles duplicated cover
  text, headings glued to bodies, and multi-column reading order.
- **Cache by file hash** (content hash → parsed doc) so re-uploads / dev iterations are
  instant. Cache to disk (`.cache/`) or Blob; no DB.
- Structured output (tool/JSON schema) so the model returns data, not prose.

## Out of scope
Perfect table extraction, `hard.pdf` multi-column robustness (stretch), OCR.

## Approach
- Deterministic extraction first (free, instant); LLM only for segmentation/labeling.
- Stable ids: derive from content + order so they survive re-parse where possible.
- Keep provenance (page) for later "reflected in the document" and optional highlight.
- Develop against `easy.pdf`; keep the parse resilient enough for an unseen fixture.

## Done when
- Uploading `easy.pdf` yields a sensible block list (cover cleaned, headings split,
  services list not scrambled), cached by hash.
- Second upload of the same file returns from cache immediately.

## Risks
- Parse latency (5–10 min for big PDFs) & spend caps → cache hard, small model for
  structuring if quality holds.
- Over/under-segmentation → tune the structuring prompt; block granularity should match
  what a user would want to select.
