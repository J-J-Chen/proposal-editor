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

**The pass/fail bar is met:** `easy.pdf` works end-to-end on the deployed app. Beyond it, two of
the brief's stretch goals are shipped — **multi-paragraph chat** (an agentic assistant that edits
across sections at once) and **hard-fixture handling** (`hard.pdf` parses, previews, and was run
through the eval). The README's seven required sections follow.

---

## 1. Setup & run

```sh
npm install
cp .env.example .env.local     # then paste your Buoyant proxy token (sent separately)
npm run dev                     # http://localhost:3000
```

Other scripts: `npm run build` · `npm run start` · `npm run lint` · `npm run typecheck`.

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
  Refine suggestions, and the chat assistant — uses `claude-sonnet-4-5` at `temperature: 0.2`
  (this is editing, not brainstorming); a smaller `claude-haiku-4-5` is configured but currently
  unused. The eval's extractor runs **cross-model** on the *other* provider (`gpt-4o-mini` /
  `gpt-4.1`) so the editor never grades itself.
- **Graceful degradation:** with no token set, the app still boots and the AI routes return a
  clean `503 { error: "AI is not configured" }` instead of crashing.
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

- **The parse is entity-safe *by construction*.** Parsing is hybrid: deterministic text+layout
  extraction, heuristics for the easy ~80% of structure, then **one LLM structuring call that
  labels line ranges by reference and never re-emits the document text.** Because that model can't
  rewrite text, it is *incapable* of altering `MECO`, a `041-560` job number, or a `$` figure
  during parsing — pushing every entity risk into exactly one place, the edit call, which is what
  makes the evaluation (§5) tractable. The parse is **cached by file hash** (`Doc.id` *is* the
  sha256 of the bytes) plus a committed pre-parsed seed, so each PDF is parsed once even though
  parsing is the slow, metered step.

- **The edit loop: one guardrailed, structured route.** `POST /api/edit` takes
  `{ block, instruction, docContext?, kbContext? }` and returns `{ newText, rationale? }`
  (`src/lib/edit.ts`). Two commitments make it safe: (1) the system prompt's **rule #1** —
  *preserve verbatim every proper noun, name, project/contract number, dollar amount, date, and
  quantity unless the instruction explicitly says to change that specific value* (rule #2: do
  exactly what's asked, nothing more); (2) **forced-tool structured output** — the model must
  call a `submit_edit` tool returning the rewrite as *data*, so a `"Sure, here's your revised
  paragraph:"` preamble can never leak into the document. Non-streaming on purpose: Apply is
  all-or-nothing and the diff needs the whole rewrite.

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
  `HistoryEntry { op, at, source, rationale? }`. **Undo/redo is an inverse-command log + a
  cursor** — one array, no second stack. Redo-invalidation and reject-isolation are correct *by
  construction*, and the log doubles as the demo's audit trail. Chat's multi-edit batches apply
  and undo as **one grouped transaction**.

- **UX for a Word-native, non-technical user — "recognisable, not identical."** The audience is a
  proposal manager or city engineer who lives in Word. So we borrow Word's **habits and plain
  words** — *Open* not Upload, *Keep this change / Discard* not Accept/Reject, Undo/Redo top-left,
  a page that looks like a document, one persistent **Assistant pane** on the right — but give the
  product its **own calm blueprint-teal skin** rather than cloning the ribbon (a faithful clone
  hits the "broken Word" uncanny valley the moment a right-click menu is missing). The AI's
  proposal is a **calm stacked card** — *"The wording now"* over *"The suggested new wording,"*
  read top-to-bottom like a letter — not a developer redline.

- **AI only via the Buoyant proxy, server-side; no database.** State lives in client memory; the
  parse cache is committed pre-parsed JSON (`src/parse-cache/`) plus an in-process map — no DB, no
  disk. (Vercel Blob only ferries a large PDF's bytes to the server on a cache miss.) The brief
  says DB is optional and nothing in the single-user loop needs one — adding one would be infra
  for its own sake.

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
- **Sub-paragraph text selection** — edits currently operate on a whole paragraph or other text
  block. Selecting an arbitrary span would be a useful future refinement, but the interaction
  needs more product thought first — especially how users clearly unselect text or switch to a
  different selection without accidentally starting an edit.
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
- **The full KB retrieve-and-insert flow ("Add a paragraph about a past project")** — the firm's
  *voice* is already distilled into the KB and grounds the editorial suggestions (§6), and the edit
  route exposes a `kbContext` hook — but the interactive *retrieval-and-insert* of a specific past
  project (feeding real snippets through that hook) ships only when the corpus is hand-verified.
  This is a *time + trust* cut, not a budget one (the owner was explicit spend isn't the
  constraint): a curated corpus is what makes grounding trustworthy, and better to ship the core
  loop rock-solid than a half-verified KB that cites a real-but-wrong project. (§7.)
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
  *Caveat:* the gate catches **alter/drop** of entities in the original, not a **fabricated new**
  entity the original didn't contain (a model-guardrail concern, §7); and **name** protection is
  corpus-based (`KNOWN_NAMES`) while PE-license / project # / $ / phone protection is regex-based
  and generalizes — so on an *unseen* proposal, numbers and licenses stay protected but a novel
  person name is not yet auto-shielded (open-class coverage is a §7 item).
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
  risk). The retrieve-and-insert design (§7) never lets the model invent: a human picks a *real*
  retrieved project **before** any generation, and a deterministic check requires every entity to
  appear verbatim, falling back to a template on failure.
- **Pre-customer checks I'd want:** the §5 fidelity number on a real grid, the preamble/refusal
  leak regex at zero, and a spot-check that the parse cache key (file hash) never collides across
  the corpus.

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
> **Caveat + next action:** fidelity alone has a perverse optimum (a no-op scores 100%) — the
> effectiveness numbers rule that out. The 3 misses are the same failure mode (`MO PE No.`
> reformatted), caught by the deterministic gate before Keep, so none reach the document silently.
> Two follow-ups flagged (not yet applied): a route-level `MO PE No.` normalization, and — the
> real remaining gap — a guardrail against a **fabricated new** entity the gate can't see.
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
  can't be run away with.
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
  review-and-apply card — same fidelity guarantees, nothing new to learn.
- **Operational polish** — clean `503`/`400`/`502` degradation on the AI routes, and a cross-model
  evaluation harness that keeps the editor from grading itself.

---

## 7. What I'd build next, given another 8 hours

1. **Harden the parse for real layouts** — proper multi-column and table reconstruction, then the
   densest `hard.pdf` brochure pages. Biggest generalization risk.
2. **Close the two fidelity gaps the confirm gate can't see.** (a) It catches *alter/drop* of
   entities in the original but not a **fabricated new** name or number the model invents — add a
   model-side guardrail plus a post-edit check for entities in the output but not the input (KB
   hallucination is one instance). (b) **Name** protection is a fixed `KNOWN_NAMES` roster —
   generalize it (NER) so an open-class person name in an *unseen* proposal is protected the way
   the license / project # / $ / phone regexes already are.
3. **Ship the KB retrieve-and-insert flow + grounded rationales.** The "Add similar experience"
   flow (retrieve *real* past projects, human picks *before* any generation, insert in the firm's
   voice with a verbatim fidelity net), plus a grounded "why" behind each suggestion — a plain
   **rubric check** or a **verbatim KB citation with provenance**, never free-form justification.
   Both reuse one retrieval spine; the corpus moves from fixed + hand-verified toward a live,
   user-uploaded KB (deferred because trust needs verification time, not spend).
4. **The suggestion-outcome feedback loop** — capture Keep/Discard/Adjust signal and pick a
   principled sink for it (ground future edits, personalization, or corpus enrichment) — and only
   *then* add persistence, if it earns its keep.
5. **Export back to PDF / DOCX** so the edited proposal leaves the tool in a format the firm sends.
6. **Put the eval in CI** — run the fidelity grid on every deploy and fail the build on a
   regression, so the guardrail can't silently rot.
7. **Persistence + multi-user** (documents, versions, comments) — the first thing a real customer
   asks for after the loop feels good.

---

_Repo conventions (history is intentionally unsquashed so the evolution is visible): all work
happens in worktrees landed through a local merge queue; `main` only advances via
`scripts/mq-land.sh` (`--no-ff`). See [`AGENTS.md`](AGENTS.md) and [`docs/`](docs/)._

_**License:** [**AGPL-3.0**](LICENSE) — required by the copyleft of [**mupdf**](https://mupdf.com)
(`mupdf@^1.28.0`, AGPL-3.0-or-later), used for PDF parsing; third-party credits are in
[`NOTICE`](NOTICE)._
