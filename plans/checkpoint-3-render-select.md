# Checkpoint 3 — Render + Select

**Goal:** render the block model as a clean, readable document and let the user select a
block and open an edit affordance.

## In scope
- Blocks → semantic HTML (`h1/h2/p/ul/li`) in a centered document column; each block is a
  real DOM node with `data-block-id`.
- Click-to-select a block (hover affordance; clear selected state).
- Edit panel / inline toolbar for the selected block: quick actions
  (Rewrite · Tighten · Fix names · Change tone) + a free-text instruction box.
- Document state lives in the client (the view *is* the model).

## Out of scope
The AI call + diff/apply (CP4). Pixel-fidelity to the source PDF.

## Approach
- Native DOM selection — no pdf.js text layer. This is the payoff of the "edit a model,
  not a PDF" bet.
- Keep the styling document-like and calm; a little polish here reads as product care.

## Done when
- `easy.pdf`'s parsed blocks render as a legible document.
- Selecting a block shows its actions and captures a free-text instruction.

## Risks
- Block granularity feels wrong for selection → revisit CP2 segmentation.
- Long docs → basic virtualization only if needed (don't pre-optimize).
