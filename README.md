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

---

## 1. Setup & run

```sh
npm install
cp .env.example .env.local     # then paste your Buoyant proxy token (sent separately)
npm run dev                     # http://localhost:3000
```

Other scripts: `npm run build` · `npm run start` · `npm run lint` · `npm run typecheck`.

**AI / proxy notes.** All AI runs through the **Buoyant hiring proxy**, which is a drop-in for
the official OpenAI/Anthropic SDKs — same SDK, `baseURL` pointed at the proxy, the proxy token
as the API key. One token works for both providers; you pick a provider by choosing a client.
Everything AI-related is **server-side only** (`src/lib/ai.ts` reads the token from the env and
is never imported into a client component), so **the token never reaches the browser and is
never committed** — it lives only in `.env.local` (gitignored).

- **Env vars** (`.env.example`): `BUOYANT_PROXY_TOKEN` (required), `ANTHROPIC_BASE_URL`,
  `OPENAI_BASE_URL` (both default to the hiring proxy; override only if Buoyant moves them).
- **Models** (overridable via env): edits use `claude-sonnet-4-5` at `temperature: 0.2` (this
  is editing, not brainstorming); health checks / the cheap structuring pass use
  `claude-haiku-4-5`; the eval's cross-model extractor uses `gpt-4o-mini`.
- **Graceful degradation:** with no token set, the app still boots — the routes return a clean
  `503 { error: "AI is not configured" }` and the home screen shows an "AI proxy not ready"
  badge instead of crashing.
- **One real gotcha, documented in code:** the proxy returns compressed bodies that the SDKs'
  bundled fetch fails to decode, so we send `Accept-Encoding: identity`. See the comment in
  `src/lib/ai.ts` — this cost real debugging time and is exactly the kind of thing a second
  engineer needs written down.

**Deploy:** Vercel (Next.js 16 / React 19), personal account. **Live:**
https://proposal-editor-sandy.vercel.app — deployed commit `5c6a0ae`
(`5c6a0ae0b164fe79f71f1ae7a622326a03fd81d4`), 2026-08-27. Verified end-to-end on `easy.pdf`
(open/upload → select → AI edit → keep → undo/redo) via `scripts/e2e-verify.mjs` against the
live URL.

---

## 2. Design decisions

Full rationale lives in [`docs/architecture.md`](docs/architecture.md) (the model),
[`docs/design-ui.md`](docs/design-ui.md) (the UX), and the append-only
[`docs/decisions.md`](docs/decisions.md) (every non-obvious call, with alternatives rejected).
The load-bearing ones:

- **Edit a structured block model, not the PDF.** We convert the PDF **once** into an ordered
  list of typed **blocks** (`heading | paragraph | list-item | caption | table | other`), each
  with a stable id and page provenance, and run the *entire* loop on that model — rendered as
  clean semantic HTML. Selection becomes clicking a DOM node; apply becomes replacing
  `block.text`; compose and undo fall out for free. We deliberately drop pixel-fidelity to the
  original PDF — the brief explicitly blesses this ("the core problem is the edit loop, not PDF
  reconstruction"). Re-rendering the original pixel-perfect is the trap that sinks the budget.

- **The parse is entity-safe *by construction*, not by luck.** Parsing is hybrid: deterministic
  text+layout extraction, heuristics for the easy ~80% of structure, then **one cheap LLM call
  that labels line ranges by reference and never re-emits the document text.** Because the
  structuring model can't rewrite text, it is *incapable* of altering `MECO`, a `041-560` job
  number, or a `$` figure during parsing. That pushes every entity risk into exactly one place —
  the edit call — which is what makes the evaluation (§5) tractable. The parse is **cached by
  file hash** (the `Doc.id` *is* the sha256 of the bytes), so each PDF is parsed once even
  though parsing is the slow, metered step.

- **The edit loop: one guardrailed, structured route.** `POST /api/edit` takes
  `{ block, instruction, docContext?, kbContext? }` and returns `{ newText, rationale? }`
  (`src/lib/edit.ts`). Two commitments make it safe:
  - **Entity guardrail in the system prompt** — rule #1, above everything else: *preserve
    verbatim every proper noun, name, project/contract number, dollar amount, date, and quantity
    unless the instruction explicitly says to change that specific value.* Rule #2: do exactly
    what's asked and nothing more. This is the #1 silent failure in the domain and is exactly
    what §5 measures.
  - **Forced-tool structured output** — the model must call a `submit_edit` tool returning the
    rewrite as *data*, so a `"Sure, here's your revised paragraph:"` preamble can never leak into
    the applied document. Non-streaming on purpose: Apply is all-or-nothing and the diff needs
    the whole rewrite, so token streaming buys no UX here.

- **One `EditOp` union powers AI edits, manual edits, KB inserts, *and* undo/redo.** Edits are
  `replace | insert | delete` ops (`src/lib/types.ts`); each applied op is recorded as a
  `HistoryEntry { op, at, source, rationale? }`. **Undo/redo is an inverse-command log + a
  cursor** — one array, no second stack. Redo-invalidation (a new edit after an undo) and
  reject-isolation (a rejected proposal can't pollute history) are correct *by construction*, and
  the log doubles as the demo's audit trail. `insert` is what "Add similar experience" (§6) uses,
  so its undo is just "remove the block" — no special case.

- **UX for a Word-native, non-technical user — "recognisable, not identical."** The real audience
  is a proposal manager or city engineer who lives in Microsoft Word. So we borrow Word's
  **habits and plain words** — *Open* not Upload, *Keep this change / Discard* not Accept/Reject,
  Undo/Redo top-left, a page that looks like a document, a single persistent **Assistant pane** on
  the right — but give the product its **own calm blueprint-teal skin** rather than cloning the
  ribbon (a faithful clone hits the "broken Word" uncanny valley the moment a right-click menu is
  missing). The AI's proposal is shown as a **calm stacked card** — *"The wording now"* over
  *"The suggested new wording,"* read top-to-bottom like a letter — not a developer redline. See
  the design study: [Familiar as Word](https://claude.ai/code/artifact/acc75563-5a8d-463f-9fbc-97e8623d4404).

- **AI only via the Buoyant proxy, server-side; no database.** State lives in client memory
  (optional localStorage/Blob for the parse cache only). The brief says DB is optional and nothing
  in the single-user loop needs one — so adding one would be infra for its own sake.

---

## 3. What I cut, and why

Speed-first, and *intentional* scope beats feature count. Explicit cuts:

- **Pixel-perfect PDF fidelity and export-back-to-PDF** — the deliverable is a clean editable
  document, not a PDF replica. Round-tripping to PDF is a large, low-signal effort the brief
  waves off.
- **Robust multi-column / complex-table handling and `hard.pdf`** — we clean the messes we
  actually verified in `easy.pdf` (duplicated cover text, headings glued to bodies, two-column
  reading order) and treat exotic table reconstruction as out of scope for the bar.
- **OCR / scanned PDFs** — a *documented* gap, not an accident. The owner confirmed the hidden
  generalization fixture is another SOQ **with a real text layer**, so building an OCR path would
  be effort against an input that won't appear.
- **DB, auth, multi-user, real-time collaboration** — a single-user editing session needs none of
  it; a CRDT would be pure collaboration tax with no single-user payoff.
- **KB *write-back* / enrichment** — accepted edits are **not** written back into the knowledge
  base. The product KB stays **read-only grounding**; laundering unreviewed model output into
  "canonical past work" is a trust hazard, not a feature.
- **The full KB grounding feature ("Add similar experience") is a stretch that ships only if time
  allows — and it's a *time + trust* cut, not a budget one.** The owner was explicit that **spend
  is not the constraint**; the reason KB is last is that a curated, hand-verified corpus is what
  makes grounding trustworthy, and that verification takes wall-clock time. Better to ship the
  core loop rock-solid than a half-verified KB that cites a real-but-wrong entity.
- **Exhaustive automated tests** — one real evaluation with real numbers (§5) is far higher
  signal for this brief than broad unit coverage of a 4-hour app.

---

## 4. Failure modes I worried about

- **Silent name / number / dollar changes — the catastrophic one.** A proposal that ships with a
  wrong client name or a mangled PE license loses the contract *and* the client. Defenses, in
  layers: (1) the parse can't touch text at all (§2); (2) the edit prompt's #1 rule is verbatim
  entity preservation; (3) structured output keeps stray prose out of the document; (4) the
  planned UX makes fidelity *visible* — protected entities carry a gold tint and a "Kept exactly
  as written" line, and an edit that would touch one triggers a one-question confirm, so a swap is
  hard to make *by accident*; (5) the §5 eval measures how often we actually hold the line.
- **Over-eager edits** — the model "improving" things it wasn't asked to. Mitigated by the
  explicit "do exactly what's asked and nothing more" rule and by tuning toward small, surgical
  edits so a one-word fix reads as one word in the card.
- **Parse edge cases** — duplicated/overlapping cover text, headings glued to body text,
  multi-column reading order (all seen in `easy.pdf` pages 1–2), and tables. The hybrid parse
  targets these; genuinely adversarial layouts and `hard.pdf` are a known, stated limit.
- **The hidden fixture** — grading may run a PDF we've never seen. The hybrid parse generalizes
  better than fixture-specific heuristics; a scanned/no-text-layer input is the documented gap.
- **Model preamble leaking into applied text** — killed structurally by forced-tool output.
- **KB hallucination — inventing a project that doesn't exist** (the inverse of the fidelity
  risk). The stretch KB never lets the model invent: a human picks a *real* retrieved past
  project **before** any generation, and a deterministic check requires every entity to appear
  verbatim, falling back to a template on failure.
- **Pre-customer checks I'd want:** the §5 fidelity number on a real grid, the preamble/refusal
  leak regex at zero violations, and a spot-check that the parse cache key (file hash) never
  collides across the corpus.

---

## 5. How I'd evaluate this — and the numbers

**North star: Apply/Reject acceptance rate** — the truest "is this actually useful" signal. It
needs users, so the shipped, automatable **proxy** for it is *name / entity fidelity*, run
against the real deployed edit route.

**A single-axis fidelity number is a trap, so the eval has two axes:**

- **Preservation (the floor):** of preservation-type edits, the % that keep every
  should-be-untouched entity intact (value present, ≥1×). But *alone this has a perverse
  optimum* — a no-op, or a too-timid model that barely changes anything, scores a perfect 100%.
- **Effectiveness (the ceiling a no-op fails):** the edit actually did the thing — `after !=
  before`, length drops for "make it shorter," a one-shot "did this apply the instruction? y/n"
  for tone/rewrite. Plus a free, zero-LLM **preamble/refusal-leak regex** and output-length
  drift.

**Run against the shipped product, not a reimplemented prompt.** Every trial POSTs to the **real
`/api/edit` route** with the exact request shape the browser sends (`docContext` included, so
context contamination is in scope) and scores the exact text the UI would apply. Grading it any
other way measures a prompt no user runs.

**The instrument is more reliable than what it measures:** deterministic regex is ground truth
for closed-class entities (`$`, job numbers like `041-560`, `MO PE No.`, MoDOT/TAP ids, years);
**one diff-aware LLM call** handles open-class proper nouns (sees before+after together, so two
stochastic passes can't manufacture false diffs); extraction runs **cross-model** (on the *other*
provider) so the editor never grades itself; a small alias + `$`-normalization table stops legit
rewordings (`MECO Engineering Company` → `MECO`, `$2.4M` → `$2.4 million`) from counting as
violations; and every flagged violation is **hand-adjudicated** before it counts.

**How the results get reported** (spend is not a constraint, so the grid is the full ≈60–80
trials, over-weighting the hard "rewrite in our voice" / "change tone" cases):
- **Lead with the violation list** — `block id · instruction · entity · before → after` — not the
  headline %.
- **Raw k/n per instruction** with the entity-bearing denominator stated (e.g. "tighten 18/18 ·
  rewrite-in-voice 14/17"); any blended % is a rounded headline only — no false precision.
- A one-line caveat naming the metric's own weakness (a no-op scores 100%) and pointing at the
  effectiveness number that rules it out.
- **Close the loop:** measure → insight → action → re-run.

> **Numbers** — recorded run against the **shipped** route: deploy `5c6a0ae`, editor
> `claude-sonnet-4-5` @ temp 0.2, 2026-08-27. 31 entity-bearing blocks of the real parsed
> `easy.pdf` × the preservation instruction set (`change-tone` / `rewrite-voice` over-sampled
> 3×) = **279 trials**. Extraction is deterministic-regex ground truth for closed-class entities
> (`$` figures, `MO PE No.`, project #, years) plus a cross-model **gpt-4o-mini** diff-aware pass
> for open-class names, so the Anthropic editor never grades itself.
>
> **Violations (3 — the honest lead):** all *reformats* of the PE-license string under
> formalizing instructions (no invented or swapped values):
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
> effectiveness numbers rule that out. The 3 misses are the same failure mode: `MO PE No.`
> reformatted under "make formal / rewrite," which the deterministic extractor already flags. The
> fix is a `MO PE No.` normalization/confirm guard in the edit post-check (would take
> rewrite-voice to 93/93) — flagged for the next iteration, not yet applied. Reproduce:
> `node scripts/eval/run.mjs --base <url> --sha <sha> --out eval.json` (artifact not committed —
> it contains verbatim proposal text).

---

## 6. What I added beyond the brief, and why

- **Entity fidelity as a *visible* trust surface, not just a guardrail.** The same before/after
  entity extractor that scores the eval also drives the in-UI "Kept exactly as written" line and
  the gold protected-entity tint. It turns the required evaluation into the product's strongest
  on-brand trust beat: the user *sees* what was protected on every edit.
- **Grounded rationales — the "why" behind a suggestion.** When the app explains *why* it
  suggests an edit, the reason is one of two **grounded** forms: a plain-words **rubric check**,
  or a **real, verbatim KB citation with provenance** — never free-form LLM justification (the
  brief's "impressive but ungrounded" trap). Grounded reasons are verifiable *and* teach firm
  conventions to a new consultant. One rubric spine, two audiences: numbers offline (§5), reasons
  in the UI.
- **Proactive "Refine" suggestions** — a rubric-driven list of "places to tighten," each Accept
  routing through the exact same review-and-apply loop. Same card, same fidelity guarantees.
- **KB grounding: "Add similar experience"** — retrieve *real* past projects from the firm's own
  proposals (with provenance shown), let the human pick one **before** any generation, and insert
  it in the firm's voice with a verbatim entity-fidelity net. The app never invents a project.
- **Operational polish** — a live AI-proxy health badge, clean 503/400/502 degradation, and a
  cross-model evaluation harness that doesn't let the editor grade itself.

---

## 7. What I'd build next, given another 8 hours

1. **Harden the parse for real layouts** — proper multi-column and table reconstruction, then take
   on `hard.pdf`. This is the biggest generalization risk.
2. **Ship KB grounding end-to-end** — the "Add similar experience" flow above, moving from the
   fixed hand-verified corpus toward a **live, user-uploaded KB** (deferred today because trust
   requires verification time, not because of spend).
3. **The suggestion-outcome feedback loop** — capture Accept/Reject/Adjust signal and pick a
   principled sink for it (ground future edits, personalization, or corpus enrichment) — and only
   *then* add persistence, if it earns its keep.
4. **Export back to PDF / DOCX** so the edited proposal leaves the tool in a format the firm sends.
5. **Put the eval in CI** — run the fidelity grid on every deploy and fail the build on a
   regression, so the guardrail can't silently rot.
6. **Persistence + multi-user** (documents, versions, comments) — the first thing a real customer
   asks for after the loop feels good.

---

_Repo conventions (history is intentionally unsquashed so the evolution is visible): all work
happens in worktrees landed through a local merge queue; `main` only advances via
`scripts/mq-land.sh` (`--no-ff`). See [`AGENTS.md`](AGENTS.md) and [`docs/`](docs/)._
