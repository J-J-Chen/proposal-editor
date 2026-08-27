# Decision Log

Append-only. Newest last. One entry per non-obvious decision: what, why, alternatives
rejected. Keep entries short. Format: `### YYYY-MM-DD — Title`.

---

### 2026-08-26 — Edit a structured block model, not the PDF
**Decision:** Parse each PDF once into an ordered list of typed blocks, render as semantic
HTML, and run the whole edit loop on that model. Drop pixel-fidelity of the original.
**Why:** Makes selection/apply/compose/undo trivial and closes the loop within the 4-hour
budget. The brief explicitly says reconstruction isn't the point.
**Rejected:** Editing the rendered PDF in place (pdf.js text layer) — high effort, sinks the
budget, and selection/apply are painful.

### 2026-08-26 — Hybrid parse (deterministic extract + LLM structuring), cached by hash
**Decision:** Extract text+layout deterministically, then use an LLM (structured output) to
segment/clean/label into blocks. Cache by file hash.
**Why:** Handles the verified messes (duplicated cover text, glued headings, multi-column) and
generalizes to the hidden fixture; caching respects the slow/metered parse.
**Rejected:** Pure heuristics (brittle on branded/multi-column layout); pure LLM-on-raw-text
(slower, pricier, loses layout cues).

### 2026-08-26 — Name/entity fidelity as the shipped evaluation
**Decision:** Measure the % of preservation-type edits that keep untouched entities (names,
orgs, project numbers, $), and report a real number.
**Why:** The brief foregrounds names; it's the highest-value silent-failure to catch, and
it's automatable within the time.
**Rejected:** Generic "edit faithfulness" (fuzzier, harder to score objectively).

### 2026-08-26 — No database by default
**Decision:** Keep the doc in client state (optional localStorage/Blob for parse cache). No DB.
**Why:** The brief says DB is optional; nothing in the core loop needs one; speed-first.
**Rejected:** Supabase/Postgres — unnecessary infra for a single-user editing session.

### 2026-08-26 — main clean; all work on worktrees via a local merge queue
**Decision:** main only advances through `scripts/mq-land.sh` (serialized, `--no-ff`, light
gate check). Feature work happens in sibling worktrees.
**Why:** Enables parallel multi-agent work without racing main; preserves commit history
(no squashing, per the brief).
**Rejected:** Direct commits to main; squash-merges.

### 2026-08-26 — Decompose context into a docs/ knowledge base + SessionStart hook
**Decision:** Split the project context out of a monolithic AGENTS.md into `docs/`, and inject
`docs/README.md` at session start so every agent loads the KB map. AGENTS.md becomes a lean
index of hard rules.
**Why:** "Not everything in one file"; ensures new sessions/agents have context automatically.
**Rejected:** One large AGENTS.md (poor separation, easy to drift, heavy to load fully).

### 2026-08-26 — Deploy to the personal Vercel account via access token (not the CLI login)
**Decision:** Deploy under **jjchen2019@gmail.com** (Vercel `jjchen2019-5995` / "John Chen's
projects") using a personal access token (`vercel deploy --token …`), and disabled the
project's `ssoProtection` so the `.vercel.app` URL is publicly reachable for grading.
**Why:** The machine's Vercel CLI is logged into the **work** account (john.chen@strala.ai,
`johnchen-6968`, default scope = Strala team) — which the owner said not to use. The personal
token has no access to the Strala scope, so it's impossible to deploy there by accident. Token
auth also leaves the Strala CLI login untouched.
**Rejected:** Deploying with the existing CLI login (wrong account); logging the CLI out of
Strala (disruptive to the owner's work).

### 2026-08-26 — Undo/redo via an inverse-command log + cursor (not a two-stack undo)
**Decision:** Promote the `{ blockId, before, after }` entry to a first-class `history:
HistoryEntry[]` log with a `cursor` (count of applied entries), held in one `useReducer`.
Undo = `cursor--` + invert the op; redo = `cursor++` + apply it — one array, no second stack.
Redo-invalidation = `history.slice(0, cursor)` on apply. The AI proposal lives in a separate
`pending` slot so Reject can't pollute history. Grafts: a structural-sharing `setText`, a
`baseCursor` stale-pending guard, and a discriminated-union `op` field + `groupId` reserved for
future structural/multi-block edits (routed via `applyOp`/`invertOp`, but **not built now**).
Closes the docs' undo-but-not-redo gap. Container is `useReducer` (zero deps, ~45-line pure,
testable reducer); lifting into Context/Zustand later is mechanical if cross-component state grows.
**Why:** Zero new deps; redo-invalidation and reject-isolation are correct *by construction*, not
by discipline; compose is automatic; the log doubles as the graded audit trail.
**Rejected:** Whole-doc snapshots (nearly tied — grafted its best parts instead of storing whole
docs + a parallel audit record); Immer patches (dep + `enablePatches()` footgun + positional
paths that fight stable ids); Zustand+zundo (two deps + silent `partialize`/equality footguns);
Yjs/CRDT (full collaboration tax with no single-user payoff); non-linear/branching undo (the real
budget-sink). Decided via a 5-design judge panel; see `docs/architecture.md` "The edit loop".

### 2026-08-26 — KB grounding = one interaction, "Add similar experience" (pull, don't write)
**Decision:** Ship a single KB interaction: retrieve real past projects from the `kb/` corpus as
candidate cards (provenance shown), the human picks one **before** any generation, and it's
inserted as a new block. Additive insert only, via the reserved `'insert'` EditOp.
**Why:** It's the brief's literal example, the highest-value demo beat, and honest — the app never
invents a project; candidate-pick-before-generate is the anti-contamination mechanism.
**Rejected:** A grounding/replace mode with inline citations; keyword auto-arm on free-text edits;
a standalone fact-linter — all fold into this one flow or protect the spend cap by being cut.

### 2026-08-26 — Voice-first LLM compose is the KB default; a deterministic fidelity net guards facts
**Decision:** Compose the inserted paragraph with the LLM **in MECO's voice, matching the existing
entry format** (few-shot exemplars + voice card + a delimited `<past_work>` facts block), then run
a deterministic check that every entity/number from the chosen chunk appears **verbatim**; on
failure, fall back to a zero-LLM template. Owner directive: all edits must be in the firm's voice.
**Why:** A mechanical template can't match voice/format. AI supplies voice; code guarantees facts.
This makes the CP5 name-fidelity eval load-bearing on exactly the riskiest surface.
**Rejected:** Zero-LLM template as the default (fails the voice requirement); trusting the LLM
alone (fails fidelity); server-side substring validation (proves existence, not association).

### 2026-08-26 — A firm "voice card" is injected into every edit, not just KB
**Decision:** Mine a small firm voice card (style descriptor + exemplar sentences) from the KB
once, offline, and inject it into the `docContext` of every edit call.
**Why:** "All edits in their voice" is a property of the whole edit loop; cheap and high-payoff.
**Rejected:** A separate "rewrite in our voice" feature/button — voice is context, not a mode.

### 2026-08-26 — Fixed, committed KB index; ingest programmatic + hand-verified; live KB deferred
**Decision:** The KB is a fixed, read-only 5-doc corpus served from a committed `src/kb/index.json`
(no DB, no runtime ingest). Build it programmatically (reuse the CP2 parser) but **hand-verify each
field is bound to text co-located with its project title**. Retrieval is in-memory keyword overlap
— no vector DB, no embeddings, no precomputed BM25 stats. Live/user-uploaded KB is deferred (noted
in the README).
**Why:** A curated corpus makes fact-fidelity matter more than full automation; hand-verification
guarantees association, which a blind structuring pass cannot. Keyword overlap over a few dozen
tiny chunks is sub-ms and the human pick supplies the precision a ranker would buy.
**Rejected:** Vector DB / embeddings (unnecessary infra for 5 docs); pure hand-authoring
(undefensible in code review); runtime Blob ingest (heavier path with no v1 payoff).

### 2026-08-26 — Do not index `projectNumber` from the `001-xxx` cover numbers
**Decision:** Leave per-project `projectNumber` unset in the KB index unless a genuine per-project
number exists in the source.
**Why:** Verified via pymupdf: the `001-xxx` values are the SOQ's **own** document id (like
easy.pdf's `041-560`), not a project number, and are inconsistent within one doc (the bridge SOQ
carries both `001-902` and `001-9002`). Copying one verbatim would cite a real-but-wrong-entity
number that provenance would rubber-stamp.
**Rejected:** Indexing the cover/letter number as the project number (silently wrong, trust-eroding).

### 2026-08-26 — Evaluation v2: two-axis, run against the shipped edit route + owner clarifications
**Decision:** Keep name/entity fidelity as the shipped eval, but sharpen it (see
[checkpoint 5](../plans/checkpoint-5-eval-readme.md)):
(1) pair fidelity with a **no-op-defeating effectiveness check** — a no-op / too-timid model
scores 100% on fidelity alone — plus a free preamble/refusal-leak regex;
(2) run it through the **real deployed CP4 edit route** with the exact request shape (docContext
included), scoring the applied text — not a reimplemented SDK prompt;
(3) **harden the extractor**: deterministic regex as ground truth for closed-class entities
(`$`, job / `MO PE No.` / MoDOT / TAP numbers, years), one *diff-aware* LLM call for open-class
proper nouns, run **cross-model** (extract on the non-editor provider), value-preservation with a
small alias + `$`-normalization table, and hand-adjudicate flags;
(4) **exclude entity-changing instructions** ("fix names") from the preservation set; report raw
k/n per instruction with the entity-bearing denominator + a leading violation list.
**Owner clarifications (from Eric, 2026-08-26):** the hidden generalization fixture is **another
MECO-style SOQ with a real text layer** (→ `easy.pdf` / KB SOQs are representative; no OCR/scanned
path); **spend is not a constraint** (→ run the full grid, use the stronger / cross-model calls
where quality benefits; the KB stretch is a **time + trust** cut, not a budget one).
**Why:** Fidelity alone is gameable by a timid model, and if run on a reimplemented prompt it
doesn't measure the shipped product — both are exactly what a founding-engineer reviewer probes.
The parse is already entity-safe by construction (CP2), so the **edit route is the only place an
entity can break**; the eval isolates it.
**Rejected:** Single-axis preservation-only (perverse optimum); two independent LLM extractions
set-diffed (stochastic false violations); the editor grading its own output (correlated blind
spots); surface-string preservation (penalizes legitimate rewordings).

### 2026-08-26 — Extractor = mupdf (WASM), server-side Node runtime
**Decision:** Use `mupdf@1.28.0` (MuPDF compiled to WASM) as the CP2 extractor, via
`page.toStructuredText("preserve-whitespace").asJSON()`, in a `runtime="nodejs"` route.
**Why:** Same engine as the pymupdf that gave clean recon output; pure WASM, zero native deps on
Vercel. **Verified on the real fixtures:** its per-line `font.weight` reports `"bold"` for the
same-12pt-as-body headings ("OUR FIRM"/"SERVICES") — so heading detection needs no font-plumbing.
**Rejected:** `pdfjs-serverless`/`unpdf` (weight requires `commonObjs.get(fontName)` resolution,
unreliable for subset fonts like `Unnamed-T3`) — kept as the fallback only; `pdf-parse`/`pdfreader`
(no structured span data). Only genuine risk: the ~10.4MB `.wasm` tracing into the Vercel bundle →
smoke-test early, `outputFileTracingIncludes` if needed. See [checkpoint 2](../plans/checkpoint-2-pdf-parse.md).

### 2026-08-26 — Structuring: heuristics-first, LLM labels by line-reference (never re-emits text)
**Decision:** Do ~80% of structuring with deterministic TS (position-bucketed dedup, header/footer
strip, x0-column reading-order sort, line→block merge, heading = bold+ALL-CAPS+short **not size**),
then ONE LLM call (default `claude-sonnet-5`, effort `low`) that groups/labels/levels lines by
returning `{type, level, startLine, endLine}` — a deterministic assembler rebuilds text VERBATIM
from the referenced lines.
**Why:** Makes proper-noun/number/$ corruption **impossible by construction** (the model can't emit
text) — this is the CP2 half of "the parse is entity-safe by construction; the edit route is the
only place an entity can break" (see the Evaluation v2 entry). Degrades to heuristics-only if the
LLM/proxy fails. Corrects the KB's earlier "bigger=heading" assumption — recon shows headings are
the same 12pt as body, distinguished by weight+caps. (Spend is not a constraint per Eric, so a
stronger structuring model is fine where it helps; reference-based output is kept for FIDELITY, not
cost.)
**Rejected:** Pure-heuristic labeling (can't assign heading levels; misfires on infographic
stat labels like "60 EMPLOYEES"); LLM re-emitting full block text (entity-corruption risk);
"skip the LLM when heuristics look confident" (overbuilt + actively mislabels design pages).
**Watch:** structured output through the Buoyant proxy is unverified — smoke-test `messages.parse()`
before generating seeds; fall back to tool-use / JSON+zod if unsupported.

### 2026-08-26 — Parse cache: committed seed + in-proc Map + Blob-for-upload; no DB
**Decision:** Key parses by `sha256(bytes)`. Layers: **L0** committed pre-parsed JSON for the 7
provided PDFs (`src/parse-cache/{sha256}.json`, loaded at module init) → graded demo is instant and
deterministic; **L1** in-process Map; **Vercel Blob for the upload only** (files are 13–18MB,
over Vercel's 4.5MB body cap → hash in the browser, Blob client-upload on a miss). Durable Blob
write-back + dev-disk tiers are optional polish.
**Why:** Speed-first, no DB (per project rules); the committed seed removes runtime/latency/413 risk
from the pass/fail path (a demo/latency win, not a spend one — spend is not a constraint per Eric).
`easy.pdf` sha256 = `03dd3ee8…c5829` (verified).
**Rejected:** On-disk `.cache/` as the prod store (Vercel fs is ephemeral/per-instance); Runtime
Cache/KV (non-durable / ≈ a DB). See [checkpoint 2](../plans/checkpoint-2-pdf-parse.md).
### 2026-08-26 — Proactive "Refine" suggestions as CP7; KB stays read-only (no enrichment)
**Decision:** Add a proactive review layer (CP7, see `plans/checkpoint-7-refine-suggestions.md`):
after parse, a rubric pass surfaces a short, high-precision list of "places to refine"; the user
clicks through Accept/Reject/Adjust, and each **Accept routes through the existing CP4
diff→apply→undo loop** (a suggestion's Accept *is* an edit-loop apply). One analytic **rubric** is
the shared spine — the same registry drives the suggestion list AND scores the CP5 name-fidelity
eval; a canonical **entity dictionary** (extracted read-only from `kb/`) powers the consistency
check, the edit guardrail, and that eval. **The product KB stays read-only grounding — we are NOT
enriching it** (no accepted-text write-back, no accepted-proposal-as-new-reference). The broader
"feed suggestion *outcomes* back into the KB" question is **deferred** (noted in the README);
outcomes, if used, are eval signal + in-session UX only, never KB writes.
**Build order:** gated behind the bar (CP2–4 on `easy.pdf`), then CP5 (rubric spine + entity dict +
fidelity eval — folds in CP7 "Phase 0") → CP7 Phase 1 (Refine panel MVP) → CP7 Phase 2 (Adjust +
README numbers) → CP6 (KB grounding, read-only, if time). Sequenced **ahead of CP6** because
Accept/Reject demos without RAG.
**Why:** Strongest "beyond the brief" feature (a consultant recycling a proposal doesn't know what
to fix — the tool telling them is the value); reuses the whole edit loop; unifies the product
feature with the required eval via one rubric. Enrichment adds persistence/complexity and risks
laundering unreviewed model output into "canonical" past-work — not worth it now.
**Rejected:** KB corpus enrichment / accepted-text write-back (cut); deciding the feedback-sink now
(deferred); auto-scan on import and a generative judge for entity fidelity (kept deterministic).
### 2026-08-26 — Suggestion rationale must be grounded (rubric check or real KB citation), not free-form
**Decision:** When the app shows *why* it suggests an edit, the "why" is one of two grounded forms:
(L1) a deterministic **rubric check** stated in plain words (from the entity dictionary / voice
card), or (L2) a **real, verbatim KB citation with provenance** (reusing the CP6 retrieval +
provenance). Never free-form LLM justification (L3). Degrade gracefully: a KB example where
retrieval finds an apt one, the rubric reason otherwise, and **never a fabricated reason**.
**Why:** Grounded reasons are verifiable and *teach* firm conventions to a new consultant; they
reuse the rubric (shared with the CP5 eval — one spine, two audiences: numbers offline, reasons
in-UI) and CP6 retrieval, so it's near-zero new machinery. Free-form justification is the brief's
"impressive but ungrounded" trap — pokeable in the demo, and unverifiable.
**Rejected:** Free-form LLM "here's why I changed it" prose (plausible but ungrounded); a separate
rationale model/subsystem (the rubric + retrieval already produce the reason). The suggestion *UX*
itself is CP7's Refine layer — this entry fixes only that its reasons must be grounded.

### 2026-08-26 — UI direction "The Assistant": familiar-not-clone, right pane + calm review card
**Decision:** The editor UI leads with a hybrid ("The Assistant"): one **persistent right-hand
assistant pane** as the single home for every AI moment, carrying a **calm stacked "the wording now
/ the suggested new wording" card** as the review surface, with protected names/numbers made
visibly gold + an extra confirm to change one. Audience-driven: older, tech-illiterate, Word-native
users. **Principle: recognisable, not identical** — borrow Word's *habits and plain words*, not its
chrome (a too-faithful clone hits the uncanny-valley "broken Word" trap), so the product wears its
own calm blueprint-teal skin. Owner-confirmed choices: (1) verbs **"Keep this change" / "Discard"**
not Accept/Reject; (2) added = **green underline**, removed = red strikethrough (shape carries
meaning → colour-blind-safe); (3) the card's **inline redline marks are the first thing to cut** if
time is short — the two plain boxes suffice; (4) **desktop-only** for the demo; (5) **tune the model
toward small, surgical edits**. Full spec: `docs/design-ui.md`. Study/mockups:
<https://claude.ai/code/artifact/acc75563-5a8d-463f-9fbc-97e8623d4404>.
**Why:** One pane = one thing to learn and the app always answers "what next?"; the stacked card is
comprehension-by-reading (no redline literacy needed); visible fidelity answers the domain's #1
silent-failure fear. Selected from a 4-direction critic-scored panel (Word Calm 8.3 · Assistant
8.2 · Word Classic 8.0 · Guided Steps 7.5) by grafting the two axis-winners.
**Rejected:** A literal Word clone / ribbon + Home-vs-Review tab split (Word Classic — uncanny
valley, actions stranded far from the text); a "Step X of 4" wizard (Guided Steps — Word isn't a
wizard; the counter patronises and the "Next" gate stalls users); margin comment-balloons and a
dual-place preview (coordination cost for user and build).

### 2026-08-26 — Edit route (Track C): non-streaming + forced-tool structured output
**Decision:** `/api/edit` is **non-streaming JSON** and gets its result via a **forced Anthropic
tool call** (`submit_edit` → `{newText, rationale}`), not by parsing model prose. Entity guardrail
is **prompt-only** for CP4; the deterministic entity-verbatim net stays deferred to CP5/CP7. Low
temperature (0.2), block-scaled `max_tokens`, Anthropic main model for edit quality. Logic lives in
`src/lib/edit.ts`; the route is a thin 503 (not configured) / 400 (bad input) / 502 (proxy error)
wrapper.
**Why:** Forcing a tool call *structurally* prevents preamble ("Sure, here's your paragraph:") from
landing in applied text — no prose-stripping heuristics to get wrong. Non-streaming because Apply is
all-or-nothing and the diff needs the whole rewrite to be meaningful, so token streaming buys no UX
here while complicating tool_use parsing. Verified live on entity-heavy blocks: a tighten and an
aggressive "make it more impressive" rewrite each preserve every proper noun / project number / $ /
date; an explicit "change the year to 2024" edit moves only that value.
**Rejected:** SSE/token streaming (no payoff for an all-or-nothing apply; harder with tool_use);
JSON-embedded-in-prose output (format/preamble leaks — the exact failure structured output kills);
building the deterministic fidelity net now (that's CP5's eval + CP7's rubric — the prompt guardrail
suffices to close the bar).

### 2026-08-26 — CP2 parse built: verified on fixtures; tool-use output; single /api/parse; no Blob
**Decision:** Track A (CP2) is implemented and verified end-to-end against the real fixtures, with
three deltas from the plan:
1. **LLM structured output via TOOL USE (`input_schema` + forced `tool_choice`)**, not the SDK's
   `messages.parse()` — the latter was the plan's *unverified* path. Tool-use is confirmed to work
   through the Buoyant proxy (structuring model `claude-sonnet-4-5`, i.e. `AI_MODELS.anthropicMain`).
   Zod-validate the tool input; any failure → deterministic heuristic grouping (never crashes).
2. **No Vercel Blob. One `/api/parse` route.** Vercel Functions now accept **100MB** request bodies
   (up from 4.5MB), so the 13–18MB fixtures POST directly as multipart on a genuine miss — the
   browser-hash + Blob-client-upload workaround is obsolete. Route: JSON `{hash,filename}` → cache
   hit or `422 {needsUpload}`; multipart `file` → hash + full parse. Dropped the planned
   `parse-check`/`upload` routes and the `@vercel/blob` dep.
3. **Reading order = mupdf's native block/line order** (NOT a global y-sort): native order already
   keeps easy.pdf's two-column SERVICES list unscrambled, whereas a y-sort *interleaves* the columns.
   Column-clustering is kept only as a documented hedge for denser pages, not a default.
**Verified (real fixtures, live server):** headings found by weight+ALL-CAPS+short at body 12pt
(`OUR FIRM`/`SERVICES`/…; bold *mixed-case* names correctly excluded); shadow/dup cover text deduped;
entities (`041-560`, `MO PE No. 022510`, phones, `$`) survive verbatim by construction. easy.pdf seed
→ 76 blocks (instant hit); unseeded 12MB upload → live mupdf+LLM parse in ~36s (<60s `maxDuration`);
`next build` bundles mupdf via `serverExternalPackages`; `e2e-verify` ALL PASS (parse+edit).
**Caching:** sha256(bytes) key; **L0** committed seeds (`src/parse-cache/*.json` via a generated
barrel — reliable serverless bundling, not runtime `fs.readdir`) + **L1** in-proc Map; no DB, no
durable write-back. Seeds regenerate via `npm run seed` (a small node `--import` loader bridges the
`@/` alias + mupdf's top-level await, which tsx mishandles).
**Rejected:** `messages.parse()` structured output (unverified on the proxy); Blob client-upload +
3-route split (obsoleted by the 100MB body limit); global y-sort reading order (scrambles columns);
runtime directory scan for seeds (won't trace into the Vercel function). See
[checkpoint 2](../plans/checkpoint-2-pdf-parse.md).

### 2026-08-26 — Refine LLM pass (/api/suggest): grounded, doc-derived voice, entity-safe
**Decision:** The proactive Refine inbox gets an LLM layer, `POST /api/suggest` (`src/lib/suggest.ts`),
that adds editorial depth **on top of** the client-side deterministic scan (`src/refine/scan.ts`) —
the scan stays the instant floor; the two lists merge on the FE by `concat + dedupe on
id=\`${category}:${blockId}\``. Three new grounded categories: **wordiness | clarity | consistency**.
Three hard commitments: (1) every visible `why`/`evidence` quotes a span copied **verbatim from the
block's own text** — the model returns the span, we verify it's a real substring and **drop** it
otherwise (never free-form LLM justification, never the KB); (2) the `instruction` seed is
**entity-safe** — a deterministic preserve clause + the block's own protected entities
(`src/lib/entities.ts`) appended server-side, and the rewrite still runs through the guardrailed
`/api/edit`; (3) **firm voice steers the model server-side only** and never enters the payload.
Cached per `doc.id` (content hash); same 503/5xx convention as `/api/edit` (FE degrades silently to
the scan floor on any failure). Main model (sonnet) since the result is cached.
**Why (KB-voice sourcing):** John's hard constraint is that suggestions reflect the firm's
*established* register, not generic editorial style. There is **no `/kb/` corpus in the repo yet**
(only `plans/checkpoint-6`), so the register is derived from the **current document's own longest
prose paragraphs** — genuinely the firm's own writing, self-contained, and it cannot leak into the
UI (server-side prompt only). Forward-compatible: a real KB voice card feeds through the same helper
when Track F lands one. Dropped a visible **'voice'** category on purpose — "matches firm voice"
can't be grounded in the block's own words without surfacing the KB, so voice lives in the
instruction's tone, not a citable card.
**Rejected:** free-form LLM "why" prose (ungrounded — the exact trust failure the grounding rule
forbids); trusting the model's evidence without a substring check (hallucinated quotes leak);
hardcoded per-proposal/entity fixes (anti-gaming — general rubric only); blocking on a KB corpus
that isn't built yet (doc-derived voice is a sound, shippable interim); a `'voice'` chip in the UI.
