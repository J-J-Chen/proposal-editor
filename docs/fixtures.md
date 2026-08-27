# Fixtures & Data

## Locations
- **Provided by Buoyant:** `/Users/john/strala/workspaces/ws_8ab97d2dec3e/ExampleProposals`
  - `proposals/easy.pdf` — 8 pages. **The must-work fixture.**
  - `proposals/hard.pdf` — 19 pages. Stretch (multi-column, tables, branding).
  - `kb/` — 5 past MECO proposals (the **product knowledge base**, for grounding edits):
    `monroe_city_electrical_soq.pdf`, `nemo_rpc_bridge_soq.pdf`, `macon_city_soq.pdf`,
    `hannibal_demolition_soq.pdf`, `palmyra_modot_tap_soq.pdf`.
- Firm across all docs: **MECO Engineering Company** — consistent voice, team, conventions.

> "kb" here = the **product's** knowledge base (past proposals the app grounds edits in).
> Our internal design/reasoning KB is `docs/` (this folder). Don't conflate them.

## Verified PDF facts (via pymupdf)
- **All 7 PDFs have a real, extractable text layer — no OCR needed** for the provided set.
- They are **graphic-designed / branded**: subset embedded fonts (Denmark, Norwester,
  ProximaNova, Barlow) and 23–56 images each. Visually rich, not plain text.
- `easy.pdf`: 8 pp, ~8K chars, ~23 images, mostly single-column.
  `hard.pdf`: 19 pp, ~32K chars, denser.
- **Structure problems are real and visible on `easy.pdf` p1–2:**
  - Cover page has **duplicated/overlapping design text** → naive extraction yields junk
    ("Statement of Statement of Qualifications Qualifications…").
  - **Headings glued to body** in one block ("OUR FIRM MECO is…", "SERVICES" + its list).
  - **Multi-column** content even here (the services list is two columns at the same y).
  - Raw "blocks" ≠ paragraphs — a block can be a heading+paragraph or a whole column.

**Implication:** structure *recovery* (segment/clean/label) is the work, not reconstruction.
This is why the parse is a hybrid: deterministic extraction + an LLM structuring pass. See
[architecture.md](architecture.md).

## Handling in-repo
Don't commit the large PDFs (see `.gitignore` intent — 99 MB total). Copy the fixture(s) a
task needs into a local, gitignored working dir, or read from the path above. Cache parse
results by file hash (parsing is slow + metered).

## The AI proxy
Drop-in for the official OpenAI/Anthropic SDKs (set `baseURL`, use the token as the API key).
Base URL `https://hiring-proxy.trybuoyant.ai` → `/anthropic`, `/openai`. Single token, both
providers, **spend-capped**. Token lives only in `.env.local` (never commit). Details +
snippets in [workflow.md](workflow.md).
