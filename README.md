# Proposal Editor

Upload a proposal PDF, edit it section-by-section with AI, review each change as a plain
before/after card, and apply — with edits that compose and undo. Built for the Buoyant
Founding Engineer take-home.

**▶ Live app: https://proposal-editor-sandy.vercel.app**

The domain: engineering & consulting firms spend dozens of hours writing the statements of
qualifications and cover letters that win civil-infrastructure contracts. The single most
expensive mistake in that work is a *silently wrong name or number* — a swapped client, a
mangled PE license, a dollar figure off by a digit. So the whole product is built around one
idea: **make the edit loop fast, and make it structurally hard to corrupt a fact.**

### The assignment, and where it lives

| The brief's basic loop | In this app |
|---|---|
| 1. Upload a PDF | **Open** a file (or one click on a bundled sample); large files stream via Vercel Blob |
| 2. Render it so the user can interact | Opens on a pixel-faithful **Original PDF** view; toggle to a clean **Document** view of editable text blocks |
| 3. Select a unit, ask AI to act on it | Click a paragraph and give an instruction (rewrite, tighten, fix names, change tone) — in the Document view, or directly on the Original view where a layout map exists |
| 4. AI proposes; user sees the change and decides | A calm **old → new → diff** card; **Keep this change** / **Discard** |
| 5. Applied changes reflect; compose; undo | Applied in place; edits compose; full **Undo/Redo** |

**The pass/fail bar is met:** `easy.pdf` works end-to-end on the deployed app. Beyond it, three of
the brief's stretch goals are implemented — **multi-paragraph chat**, **hard-fixture handling**,
and a reviewed **five-proposal knowledge base** whose “Add similar experience” flow retrieves a
real project, shows its source before generation, and inserts only after human review. The
README's seven required sections follow.

---

## 1. Setup & run

```sh
npm install
cp .env.example .env.local     # then paste your Buoyant proxy token (sent separately)
npm run dev                     # http://localhost:3000
```

Other scripts: `npm run build` · `npm run start` · `npm run lint` · `npm run typecheck` ·
`npm run test:kb`. To re-audit every committed KB quote against the source PDFs, run
`npm run kb:audit -- /path/to/ExampleProposals/kb`.

**Stack:** Next.js `16.3.3` (App Router) · React `19` · TypeScript · `mupdf` for parsing ·
`@anthropic-ai/sdk` + `openai` (both pointed at the Buoyant proxy) · `@vercel/blob`. No database.

**AI / proxy.** All AI runs through the **Buoyant hiring proxy**, a drop-in for the official
OpenAI/Anthropic SDKs — same SDK, `baseURL` pointed at the proxy, the proxy token as the API key
(one token, both providers; you pick a provider by choosing a client). Everything AI-related is
**server-side only** (`src/lib/ai.ts` reads the token from the env and is never imported into a
client component), so **the token never reaches the browser and is never committed** — it lives
only in `.env.local` (gitignored).

- **Env vars** (`.env.example`): `BUOYANT_PROXY_TOKEN` (required); `ANTHROPIC_BASE_URL` /
  `OPENAI_BASE_URL` (default to the hiring proxy; override only if Buoyant moves them);
  `BLOB_READ_WRITE_TOKEN` (Vercel Blob — used only for the large-PDF upload path on a parse-cache
  miss).
- **Models** (overridable via env): every live LLM call — edits, the parse structuring pass, the
  Refine suggestions, chat, and KB paragraph shaping — uses `claude-sonnet-4-5` at `temperature: 0.2`
  (this is editing, not brainstorming); a smaller `claude-haiku-4-5` is configured but currently
  unused. The eval's extractor runs **cross-model** on the *other* provider (`gpt-4o-mini` /
  `gpt-4.1`) so the editor never grades itself.
- **Graceful degradation:** with no token set, the app still boots and ordinary AI routes return a
  clean `503 { error: "AI is not configured" }` instead of crashing. KB search remains available,
  and KB compose returns a deterministic paragraph made only from the reviewed project record.
- **One real gotcha, documented in code:** the proxy returns compressed bodies the SDKs' bundled
  fetch fails to decode, so we send `Accept-Encoding: identity`. See the comment in
  `src/lib/ai.ts` — this cost real debugging time and is exactly the kind of thing a second
  engineer needs written down.

**Deploy:** Vercel (personal account), Next 16 / React 19. `scripts/e2e-verify.mjs` (the **API
layer** — parse + edit routes) passes green against the live deploy, and the full browser
click-through on `easy.pdf` (open → select → AI edit → Keep → undo/redo) is verified by hand each
release.

---

## 2. Design decisions

Fuller rationale lives in [`docs/architecture.md`](docs/architecture.md) (the model),
[`docs/design-ui.md`](docs/design-ui.md) (the UX), and the append-only
[`docs/decisions.md`](docs/decisions.md) (every non-obvious call, alternatives rejected). The
load-bearing ones:

- **Edit a structured block model, not the PDF.** We convert the PDF **once** into an ordered
  list of typed **blocks** (`heading | paragraph | list-item | caption | table | other`), each
  with a stable id and page provenance, and run the *entire* loop on that model. Selection is
  clicking a DOM node; apply is replacing `block.text`; compose and undo fall out for free. This
  is the choice the brief blesses ("the core problem is the edit loop, not PDF reconstruction").

- **The parse is entity-safe *by construction*.** MuPDF runs server-side as WASM in the Node
  runtime and provides text plus layout metadata without a native deployment dependency. Parsing
  is hybrid: deterministic extraction and column-aware heuristics, then **one LLM structuring call
  that labels line ranges by reference and never re-emits the document text.** If that call fails,
  the heuristic grouping is a usable fallback. Because the model can't rewrite text, it is
  *incapable* of altering `MECO`, a `041-560` job number, or a `$` figure during parsing — pushing
  every entity risk into exactly one place, the edit call, which makes the evaluation (§5)
  tractable.

- **The edit loop: one guardrailed, structured route.** `POST /api/edit` takes
  `{ block, instruction, docContext?, kbContext? }` and returns `{ newText, changeSummary? }`
  (`src/lib/edit.ts`); non-empty `kbContext` is server-managed and rejected on this public route.
  Two commitments make it safe: (1) the system prompt's **rule #1** —
  *preserve verbatim every proper noun, name, project/contract number, dollar amount, date, and
  quantity unless the instruction explicitly says to change that specific value* (rule #2: do
  exactly what's asked, nothing more); (2) **forced-tool structured output** — the model must
  call a `submit_edit` tool returning the rewrite as *data*, so a `"Sure, here's your revised
  paragraph:"` preamble can never leak into the document. Non-streaming on purpose: Apply is
  all-or-nothing and the diff needs the whole rewrite.

- **AI proposes; the human commits — and the safety is visible.** AI responses live as pending
  proposals, separate from applied history; only an explicit **Keep** creates an `EditOp`.
  Suggestions and chat reuse that contract, so no AI path silently mutates the document. Safety is
  defense-in-depth: after the entity-safe parse, prompt guardrail, and structured output, a
  deterministic before/after gate blocks unauthorized dropped or introduced protected entities,
  digit- or word-bearing quantities, engineering notation, and likely proper names before a model
  result crosses the API boundary. Gold highlighting makes the surviving facts inspectable rather
  than leaving fidelity as an invisible model promise. The remaining qualitative-claim and single-token-name limits are
  explicit in §4.

- **Two surfaces, one model.** The same block model backs a pixel-faithful **Original PDF** view
  (mupdf page rasters — the default on open) *and* a clean semantic **Document** view. Where a
  committed page-layout map exists (both bundled samples), the Original view is *editable in
  place*: clicking a paragraph on the raster — via an overlay mapped to block ids
  (`src/parse-cache/layout.ts`) — runs the identical edit loop and patches the change over the
  original at its rect. Uploads without a map get the read-only original plus the fully-editable
  **Document** view. One edit loop, no second code path; the fixed-layout patch has honest limits
  (approximate font, no reflow) — see §3.

- **One `EditOp` union powers AI edits, manual edits, KB inserts, *and* undo/redo.** Edits are
  `replace | insert | delete` ops (`src/lib/types.ts`); each applied op is a
  `HistoryEntry { op, at, source, changeSummary?, grounding?, provenance? }`. **Undo/redo is an inverse-command log + a
  cursor** — one array, no second stack. Redo-invalidation and reject-isolation are correct *by
  construction*, and the log doubles as the demo's audit trail. Chat's multi-edit batches apply
  and undo as **one grouped transaction**.

- **Proactive suggestions are grounded and precision-first.** An instant deterministic scan is
  the dependable floor; one cached LLM pass adds judgment about wordiness, clarity, and
  consistency. Every visible reason must quote a span from the user's document: deterministic
  checks derive it directly, and the server verifies LLM-supplied evidence verbatim. An ungrounded
  suggestion is dropped, never dressed up with plausible AI prose. Clicking a suggestion starts
  the same review → Keep/Discard → undo loop instead of a parallel, less-safe editing path.

- **Chat plans broadly, edits narrowly, and never applies on its own.** A planner sees a compact
  document map and selects the minimum relevant blocks; each selected block then passes through
  the existing guarded editor and deterministic entity gate. The user reviews the batch and Keeps
  or Discards it as one grouped transaction. Input bounds and a hard shared model-call budget cap
  the cost of the public endpoint regardless of what the planner returns; SDK retries are disabled
  so one budgeted call is one proxy attempt.

- **Voice and facts have separate trust boundaries.** A versioned, fact-free voice profile—derived
  from exactly the five approved KB proposals—flows through direct edits, Refine, chat planning,
  chat drafting/repair, and KB compose. Unknown uploads use bounded samples from themselves, never
  MECO's profile by default. Project facts enter generation only through the explicit **Add similar
  experience** action: deterministic search shows provenance, the human picks one candidate, and
  the server resolves that opaque id back to one reviewed record. A hard fact/entity gate and a
  deterministic source-only fallback bound composition; ordinary edits never receive KB facts.

- **UX for a Word-native, non-technical user — "recognisable, not identical."** The audience is a
  proposal manager or city engineer who lives in Word. So we borrow Word's **habits and plain
  words** — *Open* not Upload, *Keep this change / Discard* not Accept/Reject, Undo/Redo top-left,
  a page that looks like a document, one persistent **Assistant pane** on the right — but give the
  product its **own calm blueprint-teal skin** rather than cloning the ribbon (a faithful clone
  hits the "broken Word" uncanny valley the moment a right-click menu is missing). The AI's
  proposal is a **calm stacked card** — *"The wording now"* over *"The suggested new wording,"*
  read top-to-bottom like a letter — not a developer redline. Accessibility is a functional floor,
  not polish: document text starts at 20px, controls have 48px targets, essential contrast meets
  7:1, focus is visible, no critical action is hover-only, and loading or failure states explain
  what is happening in plain language.

- **Expensive work is content-addressed.** `Doc.id` is the sha256 of the PDF bytes; committed parse
  seeds and page rasters make the bundled path deterministic, while bounded in-process caches
  accelerate repeats without becoming a store of record. Suggestions are cached by a
  **server-computed hash of the submitted block content**, never a client-asserted document id —
  preserving the performance win without turning the cache into a cross-request document leak.

- **AI only via the Buoyant proxy, server-side; no database.** State lives in client memory; the
  parse cache is committed pre-parsed JSON (`src/parse-cache/`) plus an in-process map — no DB, no
  disk. (Vercel Blob only ferries a large PDF's bytes to the server on a cache miss.) The brief
  says DB is optional and nothing in the single-user loop needs one — adding one would be infra
  for its own sake. Ephemeral caches are accelerators only, and if an uploaded PDF's raster preview
  falls out of memory, the semantic Document view remains editable rather than failing the whole
  workflow.

- **Evaluation is part of the design, not post-hoc QA.** Preservation is paired with
  no-op-defeating effectiveness, trials call the real deployed route, and a different model helps
  identify open-class proper nouns so the editor does not grade itself. §5 reports raw
  denominators and every violation before the headline percentage; the measurement is designed to
  be harder to game than a single flattering score.

---

## 3. What I cut, and why

Speed-first, and *intentional* scope beats feature count. Explicit cuts:

- **Export back to PDF / DOCX** — the deliverable is a clean, edited document on screen;
  round-tripping to a byte-faithful PDF is a large, low-signal effort the brief waves off. (In §7
  as a real next step.)
- **Pixel-perfect *reconstruction* of the PDF for editing** — we *show* the original faithfully
  (raster) and let you edit on it, but the editable unit is a text **Block**, not a reflowed
  vector clone. Rebuilding the PDF's exact layout as an editable surface is the trap that sinks
  the budget for near-zero user value.
- **Sub-paragraph / cross-block text selection** — edits operate on a whole **Block** (paragraph),
  not an arbitrary span. Finer selection is a useful future refinement, but it needs real product
  thought first: how a user clearly *unselects* or switches selection without accidentally starting
  an edit, and how the entity gate and the diff scope to a *fragment* while the rest of the block
  stays pinned. Half-building that is worse than a clean block unit. (§7 candidate.)
- **Images / logos / photos as *editable* content** — they're not AI-editable text and would
  complicate entity fidelity, so the Document view is clean text while the Original PDF view keeps
  the full visuals for reference. "Edit the text, not the graphics" is a deliberate call.
- **OCR / scanned PDFs** — a *documented* gap. The hidden generalization fixture is confirmed to
  be another SOQ **with a real text layer**, so an OCR path would be effort against an input that
  won't appear.
- **DB, auth, multi-user, real-time collaboration** — a single-user editing session needs none of
  it; a CRDT would be pure collaboration tax with no single-user payoff.
- **KB *write-back* / enrichment** — accepted edits are **not** written back into the knowledge
  base. The KB stays **read-only grounding**; laundering unreviewed model output into "canonical
  past work" is a trust hazard, not a feature.
- **Live / user-uploaded KB ingestion and KB write-back.** The implemented product KB is deliberately
  fixed and read-only: 17 reviewed projects distilled from exactly the five provided KB examples.
  `easy.pdf` and `hard.pdf` are edit/eval fixtures and are explicitly excluded as KB sources.
  Runtime ingestion, embeddings, and promoting accepted model text into canonical past work would
  widen the trust boundary; the offline audit plus human-reviewed corpus buys more reliability for
  this assignment.
- **Manual free-text typing into the document.** Every edit flows through the reviewed AI loop
  (select → instruct → diff → Keep); you can't click into a block and just type. Deliberate: the
  whole safety model — the entity-fidelity gate, the structured diff, the inverse-command audit log
  — assumes edits arrive through that one guarded path, and raw keystrokes would bypass all of it.
  On-brief, too: the task is AI editing, not a rich-text editor.
- **Partial-accept of a proposed edit.** Keep/Discard acts on the whole proposal (and chat on the
  whole batch), not per-sentence. Considered and cut: per-fragment accept fragments the
  entity-fidelity check and muddies the one-op-per-edit audit trail that makes undo correct by
  construction — a too-long rewrite is handled by re-instructing, not cherry-picking words.
- **Inline rich-text formatting** (bold / italic / links *within* a paragraph) — the block model
  is plain text, so we preserve structural formatting (headings, lists) but not intra-paragraph
  styling. Low value for proposal prose and it would complicate diffing and entity fidelity.
- **Exhaustive automated tests** — one real evaluation with real numbers (§5) is far higher
  signal for this brief than broad unit coverage of a 4-hour app.

---

## 4. Failure modes I worried about

- **Silent name / number / dollar changes — the catastrophic one.** A proposal that ships with a
  wrong client name or a mangled PE license loses the contract *and* the client. Defenses, in
  layers: (1) the parse can't touch text at all (§2); (2) the edit prompt's #1 rule is verbatim
  entity preservation; (3) structured output keeps stray prose out of the document; (4) **a
  deterministic exact-match gate** (`src/lib/entities.ts`) intercepts, before Keep, any edit that
  would alter or drop a name / PE license / project # / $ present in the original — a confirm
  modal blocks Apply until the user approves, so a swap can't be applied silently (all 3 raw
  misses in §5 are caught here), and the same signal shows in-document as a gold "kept exactly"
  tint. The **chat** assistant runs the identical gate: a batch edit that would touch a protected
  entity is flagged, **off by default**, and can't be applied without an explicit opt-in.
  The current server gate also occurrence-counts **introduced** digit-bearing values and likely
  multi-word proper names, and rejects them unless the human instruction or an explicitly selected
  authoritative project supplies them. It intentionally does not pretend regex can prove semantic
  entailment: a novel single-token name or unsupported qualitative adjective can still evade a
  deterministic detector, which is why every result remains a proposal for human review.
- **Over-eager edits** — the model "improving" what it wasn't asked to. Mitigated by the explicit
  "do exactly what's asked and nothing more" rule and tuning toward small, surgical edits. On the
  `hard.pdf` holdout (§5) the only *genuine* fidelity movements were an aggressive rewrite/tighten
  nudging a long proper name — dropping a firm-branded term ("Standard of Care") and shortening a
  state agency's name — never a number, $, or ID, and never a swap to a fabricated value.
- **Parse edge cases** — duplicated/overlapping cover text, headings glued to body text,
  multi-column reading order (all seen in `easy.pdf` pages 1–2), and tables. The hybrid parse
  targets these; genuinely adversarial layouts and the densest `hard.pdf` brochure pages are a
  known, stated limit (a couple of §5 violations are exactly these parse artifacts).
- **The hidden fixture** — grading may run a PDF we've never seen. The hybrid parse generalizes
  better than fixture-specific heuristics; a scanned/no-text-layer input is the documented gap.
- **Model preamble leaking into applied text** — killed structurally by forced-tool output (0
  leaks across both eval runs).
- **KB hallucination — inventing a project that doesn't exist** (the inverse of the fidelity
  risk). Search ranks only 17 reviewed records from the five approved source proposals. The human
  sees a verbatim quote and page, then picks a project **before** generation; compose accepts only
  its opaque id and resolves facts server-side. Required identity/scope anchors and fact/entity
  checks run after composition, with a deterministic source-only paragraph on any miss or proxy
  failure. The inserted block keeps its source/page badge through save and insertion Undo/Redo. A
  later rewrite clears a citation that no longer proves the live wording; undoing that rewrite
  restores it.
- **Security hardening before real customer documents** — this is a public, unauthenticated
  take-home, not yet a production trust boundary. It already keeps provider credentials
  server-side, stores uploads privately, restricts upload tokens to declared PDFs up to 25 MB,
  and caps chat's model-call fan-out per request. Before a paying customer, add authentication and
  tenant-level authorization; rate limits and spend quotas on every AI and parse route; PDF
  magic-byte, malformed-file, and parser resource-limit checks; an explicit upload retention and
  deletion policy; redacted errors and logs; security headers and dependency scanning; and
  adversarial tests for prompt injection and cross-tenant document leakage. The silent security
  failure to design against is one customer's proposal, metadata, or derived output becoming
  visible to another.
- **Pre-customer checks I'd want:** the §5 fidelity number on a real grid, the preamble/refusal
  leak regex at zero, a spot-check that the parse cache key (file hash) never collides across the
  corpus, and the security release gates above exercised with negative tests rather than only a
  happy-path UI pass.

---

## 5. How I'd evaluate this — and the numbers

**North star: Apply/Keep acceptance rate** — the truest "is this actually useful" signal. It
needs users, so the shipped, automatable **proxy** for it is *name / entity fidelity*, run against
the real deployed edit route.

**A single-axis fidelity number is a trap, so the eval has two axes:**
- **Preservation (the floor):** of preservation-type edits, the % that keep every
  should-be-untouched entity intact. *Alone this has a perverse optimum* — a no-op, or a too-timid
  model, scores a perfect 100%.
- **Effectiveness (the ceiling a no-op fails):** the edit actually did the thing — `after !=
  before`, length drops for "make it shorter," a one-shot "did this apply the instruction? y/n"
  for tone/rewrite — plus a zero-LLM preamble/refusal-leak regex and length drift.

**Run against the shipped product, not a reimplemented prompt.** Every trial POSTs to the **real
`/api/edit` route** with the exact request shape the browser sends (`docContext` included) and
scores the exact text the UI would apply. **The instrument is more reliable than what it
measures:** deterministic regex is ground truth for closed-class entities (`$`, job numbers,
`MO PE No.`, MoDOT/TAP ids, years); **one diff-aware LLM call** handles open-class proper nouns
(sees before+after together); extraction runs **cross-model** so the editor never grades itself; a
small alias + `$`-normalization table stops legit rewordings from counting as violations; every
flagged violation is **hand-adjudicated**. Results **lead with the violation list**, not the
headline %, and report **raw k/n per instruction** with the entity-bearing denominator stated.

> **Numbers** — recorded run of **raw model / API-route fidelity** (the edit route's output,
> *before* the UI's protected-entity confirm) against the **shipped** route: deploy `5c6a0ae`,
> editor `claude-sonnet-4-5` @ temp 0.2, 2026-08-27. 31 entity-bearing blocks of the real parsed
> `easy.pdf` × the preservation instruction set (`change-tone` / `rewrite-voice` over-sampled 3×)
> = **279 trials**. Extraction is deterministic-regex ground truth for closed-class entities plus
> a cross-model **gpt-4o-mini** diff-aware pass for open-class names, so the Anthropic editor
> never grades itself.
>
> **Violations (3 — the honest lead):** all *reformats* of the PE-license string under formalizing
> instructions (no invented or swapped values) — and all three are alter/drop changes to an entity
> present in the original, so the **deterministic exact-match gate** (§4) catches every one before
> Keep; user-facing fidelity is therefore higher than this raw route number:
> - `[make-formal]` `MO PE No. 022510` → "Missouri Professional Engineer No. 022510"
> - `[rewrite-voice]` `MO PE No. 022510` → "Missouri PE No. 022510"
> - `[rewrite-voice]` `MO PE No. 2006023228` dropped in a bio rewrite
>
> **Preservation, k/n (entity-bearing denominator):** tighten 31/31 · make-formal 30/31 ·
> fix-grammar 31/31 · change-tone 93/93 · rewrite-voice 91/93 → **276/279 ≈ 99%** (rounded
> headline only).
>
> **Effectiveness (the check a no-op fails):** substantial edits changed 149/180 ·
> tighten-didn't-grow 27/31 · cross-model "instruction applied?" 93/120 (hard, substantial).
> **Leaks:** 0/279 preamble/fence. Mean length drift 8.6%.
>
> **Historical caveat:** fidelity alone has a perverse optimum (a no-op scores 100%) — the
> effectiveness numbers rule that out. The 3 misses are the same failure mode (`MO PE No.`
> reformatted), caught by the deterministic gate before Keep, so none reach the document silently.
> Since this run, `runEdit` gained a route-level hard gate for unauthorized dropped **and
> introduced** protected entities, digit-bearing facts, and likely multi-word proper names. Those
> checks are covered by `npm run test:kb`; the published percentages above remain the honest prior
> deployed run and are not relabeled as measurements of the new gate.
> Reproduce: `node scripts/eval/run.mjs --base <url> --sha <sha> --out eval.json` (artifact not
> committed — it contains verbatim proposal text).
>
> ---
>
> **hard.pdf — $-fidelity holdout, `710ccac` (re-run with production docContext).** Dataset:
> **hard.pdf**, a generalization fixture the parser/editor were never tuned to. It began as a
> pristine never-seen holdout and has since been **reused for follow-up runs** (this one
> included), so it is now a repeated-measurement fixture, not a one-shot blind test. 242 blocks
> (as served by deployed `710ccac`; the committed seed has since been re-parsed to 237, not yet
> deployed), 198 entity-bearing, 22 sampled including **all $-bearing blocks** → 198 trials
> (22 × 9 phrasings). Deploy `710ccac` · docContext firm=`"MECO Engineering Company, Inc."` +
> headings · editor `claude-sonnet-4-5` @ temp 0.2 · cross-model extractor **gpt-4.1** ·
> 2026-08-27.
>
> **Headline:** **every** closed-class entity (all $ / numbers / dates / IDs) was **100%
> value-preserved** across all 198 holdout trials — no entity was ever swapped to a different real
> value. Leaks 0/198.
>
> **Per-entity-class (preserved/total, strict | value):** money 72/72 (100% | 100%) · project-no
> 36/36 (100% | 100%) · year 144/144 (100% | 100%) · date 36/36 (100% | 100%) · zip 18/18
> (100% | 100%) · program-id 126/126 (100% | 100%) · quantity 8/9 (89% | 9/9 100%) · proper-noun
> 1077/1224 (88% | 1207/1224 99%) → **ALL 1517/1665 (91% strict | 1648/1665 99% value)**.
>
> **Effectiveness (applicability-aware):** applied-of-applicable 153/192 · changed-substantial
> 172/189 · tighten-didn't-grow 20/22. Mean length drift 5.1%.
>
> **Violations — 17 proper-noun value flags, hand-adjudicated (led with, none hidden):** 13 are
> by-design **parse artifacts** ("Highway58" / "PumpingFlow" — the documented dense-brochure
> limit). 2 are instrument **over-capture** of generic all-caps labels. 2 are **genuine + minor**:
> an aggressive rewrite-voice dropped a firm-branded term ("Standard of Care") ×1, and a "tighten"
> shortened a state agency's name ("Department of Insurance, Financial Institutions and
> Professional Registration" → "Division of…") ×1. **Never a $/number/ID, and never a swap to a
> fabricated entity.**
>
> **Anti-overfit (holdout integrity):** no test-entity name lives in the instrument — closed-class
> matched by generic regex, proper nouns by a generic capitalized-phrase + acronym detector with a
> domain-generic stoplist; the **identical code path** scores easy and hard; hard.pdf was an
> **untouched generalization holdout on first contact** (since reused for these follow-up
> numbers); every violation is listed above (per-trial JSON retained, not committed).

---

## 6. What I added beyond the brief, and why

- **Entity fidelity as a *visible* trust surface, not just a guardrail.** The deterministic
  exact-match gate (`src/lib/entities.ts`) intercepts, before Keep, any edit that would alter or
  drop a name / PE license / project # / $, blocking Apply with a confirm modal — so the domain's
  #1 catastrophic failure can't happen silently. It turns the fidelity the eval (§5) measures into
  something the user *sees* on every edit. The product's strongest on-brand trust beat.
- **An agentic multi-paragraph chat assistant** (the brief's harder stretch goal). Describe a
  change that spans sections — "make the whole cover letter more concise" — and the assistant
  proposes a **batch** of per-block edits, each shown in the same review card, applied and undone
  as **one grouped transaction**, and each subject to the same protected-entity gate (flagged
  off-by-default). `/api/chat` has a hard model-call ceiling and input bounds so a paid endpoint
  can't be run away with; transport retries are disabled and proxy calls have a 25-second timeout.
- **Edit directly on the Original PDF** — the view a proposal now *opens* on. Beyond a read-only
  render, it's interactive wherever a page-layout map exists (both bundled samples): click a
  paragraph on the raster and edit it in place through the same loop, so a reviewer who thinks in
  "what the PDF looks like" never leaves that view. Uploads fall back to the read-only original +
  the Document view; the fixed-layout patch has honest limits (approximate font, no reflow of a
  much longer edit).
- **Proactive suggestions — "Check my proposal for things to fix."** A **deterministic
  client-side scan** (`src/refine/scan.ts` — placeholder / casing / repetition, each grounded in
  verbatim text) as a zero-model floor, plus an **LLM editorial layer** (`/api/suggest`, aligned
  to the firm's KB voice, every quote verified verbatim) for wordiness / clarity / consistency.
  Each suggestion shows **why**, quoted from the user's own text, and routes through the exact same
  review-and-apply card — same fidelity guarantees, nothing new to learn. Those review decisions
  also create the right future learning signal: once captured, each Keep / Discard / Adjust
  outcome tells us whether a rubric rule produces genuinely useful suggestions, while
  human-approved wording can reinforce the firm's voice profile. That improves both rubric and
  data quality without promoting unreviewed model output into canonical source material.
- **A candidate-first, attributable experience library.** “Add similar experience” performs a
  zero-token search over 17 hand-reviewed projects distilled only from the five provided KB PDFs.
  Candidate cards show a verbatim quote, source proposal, and page before generation; the browser
  then sends only the chosen id. Composed prose goes through the same voice/fidelity boundary and
  all-add review as an edit, retains a source badge until that wording is later edited, and uses
  the existing insert op so Discard is a no-op and Undo/Redo work without a parallel state system.
- **Operational polish** — clean `503`/`400`/`422`/`502` degradation on the AI routes, and a cross-model
  evaluation harness that keeps the editor from grading itself.

---

## 7. What I'd build next, given another 8 hours

1. **Polish user flows and UI** — tighten onboarding, selection and deselection, loading and error
   feedback, and responsive details so the existing end-to-end loop feels obvious and
   customer-ready before adding more surface area.
2. **Harden the parse for real layouts** — proper multi-column and table reconstruction, then the
   densest `hard.pdf` brochure pages. Biggest generalization risk.
3. **Strengthen semantic fidelity beyond deterministic anchors.** The hard gate now catches
   unauthorized dropped/introduced numbers and likely multi-word proper names, but it cannot prove
   that a qualitative claim is entailed or recognize every novel single-token person/place. Add a
   high-precision NER/entailment layer and measure its false-positive rate before making it block.
4. **Evolve the fixed five-source KB deliberately.** Add an authenticated, review-before-publish
   ingestion workflow with per-fact citations and corpus versioning. Keep new documents quarantined
   until every candidate field validates against its page; do not silently mix edit fixtures or
   user uploads into the trusted index.
5. **Use review outcomes to calibrate recommendations.** Capture Keep/Discard/Adjust as separate
   evaluation data so low-value rubric rules and voice suggestions can be tuned. Do not promote
   those outcomes into the canonical project-fact corpus; project evidence remains reviewed and
   page-cited through the ingestion workflow above.
6. **Export back to PDF / DOCX** so the edited proposal leaves the tool in a format the firm sends.
7. **Put the eval in CI** — run the fidelity grid on every deploy and fail the build on a
   regression, so the guardrail can't silently rot.
8. **Persistence + multi-user** (documents, versions, comments) — the first thing a real customer
   asks for after the loop feels good.

---

_Repo conventions (history is intentionally unsquashed so the evolution is visible): all work
happens in worktrees landed through a local merge queue; `main` only advances via
`scripts/mq-land.sh` (`--no-ff`). See [`AGENTS.md`](AGENTS.md) and [`docs/`](docs/)._

_**License:** [**AGPL-3.0**](LICENSE) — required by the copyleft of [**mupdf**](https://mupdf.com)
(`mupdf@^1.28.0`, AGPL-3.0-or-later), used for PDF parsing; third-party credits are in
[`NOTICE`](NOTICE)._
