# Checkpoint 7 — Refine Suggestions (proactive review layer)

**Status: SHIPPED (2026-08-27)** — the Refine layer is built (`/api/suggest` + `src/lib/suggest.ts` + `src/refine/scan.ts` + the Refine panel); the design doc below is historical. Decided: build order (below) and **no KB enrichment** (KB is
read-only). Deferred: the "feed outcomes back into the KB" sink (noted in the README). Still open:
ambition — Phase 1 vs Phase 1+2. This is a design doc for a feature the owner requested: after
import, proactively **suggest
places to look at and refine** as a clickable list (accept / reject / adjust), with outcomes
that **feed back**. It was researched before writing (prior-art UX, rubric/LLM-judge design,
real civil-proposal scoring criteria, repo integration).

> **Hard gate:** this is effectively CP7. **Do not start it before the bar is green** — the
> `easy.pdf` loop (CP2→CP3→CP4) must work end-to-end on the deployed app first. This feature
> *consumes* the block model, the render/select surface, and the diff/apply/undo loop; it
> builds nothing new underneath them. It's upside, not the bar.

---

## The one idea: a **rubric** is the shared spine

The owner's three questions — *"rubrics? evals or kb?"* — resolve to a single answer:

**Author ONE small rubric (a registry of scored "dimensions") and consume it three ways.**

```
                      ┌──────────────────────────────────────┐
                      │   RUBRIC  (src/lib/ai/rubric.ts)      │
                      │   a registry of ~4–6 dimensions:      │
                      │   id · what "good" looks like ·       │
                      │   appliesTo · defaultInstruction ·    │
                      │   usesKb? · severity · deterministic? │
                      └──────────────────────────────────────┘
                        │                │                 │
             FINDINGS mode        SCORING mode        KB is an input+sink
                        │                │                 │
              ┌─────────▼──────┐  ┌──────▼───────┐  ┌───────▼─────────────┐
              │ Refine inbox   │  │ CP5 eval     │  │ grounds KB-type      │
              │ (this feature, │  │ (the "real   │  │ suggestions; accepted│
              │  the PRODUCT)  │  │  number")    │  │ text feeds back in   │
              └────────────────┘  └──────────────┘  └──────────────────────┘
```

So: **"evals or kb?" is a false choice.** The suggestion feature is a *third thing* — a
proactive review/critique pass — and the rubric is what ties it to both. Improve a rubric
anchor and you improve the product **and** the eval in lockstep; they can't drift because
they're literally the same artifact.

### Why rubrics specifically (not ad-hoc "make it better")
An **analytic** rubric decomposes quality into separately-scored dimensions, each pinned by an
**anchored, observable descriptor** (not a vague adjective). That anchor does double duty: it's
the trigger for a suggestion *and* the definition of an eval failure. "Improve clarity" gives a
useless suggestion list and an uncalibrated score; *"a proper noun / project number / $ figure
present in the source was altered"* gives an actionable flag and a countable metric.

---

## "Feed back into the core KB" — DEFERRED (decision 2026-08-26)

> **Decided:** **the KB stays read-only grounding — we are NOT enriching it.** No accepted-text
> write-back into the retrieval index, no accepted-proposal-as-new-reference. The broader question
> of feeding suggestion *outcomes* back is **deferred** and noted in the README as a deferral.
> **Note (from `docs/fixtures.md`): "KB" = the *product* KB, NOT our internal `docs/` KB.**

The phrase originally meant three different sinks. Where each now stands:

| Sink | What feeds back | Status |
|------|-----------------|--------|
| **Grounding** (write accepted text back into the product KB) | Accepted rewrites → the retrieval index so later edits ground in them; accepted proposal → a new corpus reference. | **CUT — no enrichment.** KB is read-only. |
| **Eval / metrics** | accept/reject/adjust outcomes are labeled data → acceptance-rate per dimension = that check's precision; free human labels for calibration. | **Live** — a local outcome **log** (touches no KB); export → README numbers. |
| **Learning / personalization** | reject-twice → suppress that dimension this session; per-dimension accept-rates persisted → auto enable/disable next import. | **Deferred** (needs localStorage). |

What survives the "no enrichment" call, because it only ever **reads** the KB: the canonical
entity dictionary below (read-only extraction from `kb/`) and the in-session outcome log (which
never writes to any KB). Both are safe and stay in scope.

**The sleeper unifier: a canonical *entity dictionary*.** One artifact — firm name + variants,
personnel with titles/licenses, client/agency names, project names + numbers, $ figures, dates —
extracted from the 5 `kb/` proposals and confirmed by accepted edits. It powers **three** things
at once: the consistency suggestion (D2), the **guardrail on every edit**, and the **CP5
name-fidelity eval**. Build it once; it de-risks the eval we already committed to.

---

## The product story (grounds the "why" for the demo)

Public agencies score engineering SOQs on a remarkably **stable rubric** — canonicalized by
**SF-330 / FAR 36.602** under the Brooks Act's Qualifications-Based Selection:

- Relevant/specialized **experience** (25–35%) · key **personnel** (20–30%) · **capacity**/team
  (15–25%) · **past performance** (15–25%) · **location**/local knowledge (0–15%)
- plus a **pass/fail responsiveness & completeness gate** (deadline, page limits, mandatory
  forms/certs, every required item addressed) applied *before* scoring.

**The pitch: "we mirror the rubric the client will grade you on."** That reframes the tool from
grammar-helper to **win-rate helper** — grounded in real user value (exactly what the brief
rewards).

**Honest boundary (state it in-product):** without the actual RFP we can only check rubric-
*aligned intrinsic quality* (evidence density, quantified claims, named-personnel-to-role,
consistency, completeness, placeholder/junk hygiene) — **not** true responsiveness to a specific
solicitation. So offer an optional **"paste the RFP's evaluation criteria"** upgrade that turns
the generic rubric into *this client's* rubric. The honesty is itself a feature — it's what a
firm's proposal manager already knows.

---

## What it looks like (interaction design)

Grounded in how Grammarly / MS Editor / Google Docs / GitHub suggested-changes / IDE "Problems"
panels actually work.

- **Trigger:** a **"Scan for refinements"** button after parse — *not* auto-on-import (protects
  upload latency + the spend cap).
- **Surface: list-primary, highlight-secondary.** A right-side **Refine inbox** is the main
  surface; a flagged block gets a subtle left-border/highlight. Selecting a list item scrolls its
  block into view and pulses it. **No** persistent per-word underlines (that's noise for
  judgment-level edits).
- **Two-tier grouping (kills the wall-of-items):** **Recommended** (expanded, the sharp few) vs
  **Optional / polish** (collapsed behind "show N more"). Rank by severity × rubric-weight, then
  page order so "next" walks the PDF top-to-bottom.
- **Card anatomy:** title (imperative, e.g. *"Fix inconsistent firm name"*) · category chip ·
  severity · **before→after diff** (reuse the CP4 word-level diff) · **one-line "why" grounded in
  the actual text** (*"'MECO' on p.1 vs 'MECO Engineering' here"*) · actions. List rows stay
  collapsed to title+chip; expand the full card only for the focused item.
- **Actions — one click, no confirm** (undo is the safety net):
  - **Accept** → routes through the **CP4 apply** (instruction preset) → mutate `block.text` →
    push `{blockId, before, after}` onto the undo stack. Accept **is** an edit-loop apply.
  - **Reject** → logged, removed from the queue, **never resurrected** on a re-scan.
  - **Adjust v1** → drop the editable after-text into the block (flows through the existing
    edit/undo pipeline). **Adjust v2** → a "try again with a hint" re-prompt (the strong second
    feature).
- **Keyboard:** `Enter` accept · `Esc` dismiss · `J/K` next/prev · `E` adjust. A queue of 12
  should take two minutes.
- **States:** N-of-M progress bar · calm **"Nothing to refine — looks good"** empty state (never
  invent filler) · **"Reviewed X of Y (accepted N)"** completion summary.

---

## Dimensions to ship (precision-first subset)

Start narrow and high-precision; expand later. Best precision-per-effort first:

| # | Dimension | How it's judged | Maps to |
|---|-----------|-----------------|---------|
| **D1** | **Entity & number fidelity** — proper nouns / project #s / $ / dates unchanged on preservation edits | **Deterministic** set-diff (regex + cheap extractor) | = the CP5 metric + the edit guardrail |
| **D2** | **Consistency** — firm/client/project name & number variants across blocks | Deterministic vs the entity dictionary | the brief's *"client name is wrong"* |
| **D6** | **Artifact / completeness hygiene** — placeholder text (`[INSERT]`/`TBD`/`Lorem`), duplicated cover junk, glued headings | Deterministic/heuristic | known `easy.pdf` parse messes |
| **D4** | **Tighten / concreteness** — wordy boilerplate, unquantified claims | Cheap LLM (Haiku) | evaluators reward specificity |
| D3 | **KB experience-opportunity** — "add a comparable past project here," with provenance | LLM + BM25 over `kb/` | *stretch — needs CP6 RAG* |
| D5 | **Voice / house-style** — matches the firm's terminology across the 5 KB docs | LLM, reference-guided | *stretch* |

**D5 framing rule:** "match house style & terminology," **never** "make it generic." Evaluators
reward specificity and quantified outcomes — a naive voice-normalizer strips exactly what wins.

---

## Guardrails & pitfalls (bake these in)

1. **Deterministic fidelity, never a generative judge.** An LLM will confidently miss a silently
   altered project number. Extract the before/after entity set and `set-diff` in code; the LLM
   only adjudicates genuine ambiguity (case/whitespace). *Same code = the guardrail on every edit
   **and** the CP5 number — write it once.*
2. **Precision over recall — the whole trust strategy.** Cap the list (~5–8), confidence-gate
   (drop < ~0.6), let the judge **abstain**. A noisy list trains reject-all. (Documented:
   Copilot review's ~15–25% bad-comment rate makes teams mute it entirely.)
3. **De-noise parse artifacts FIRST.** Dedupe cover text, unglue headings, attach a parse-
   confidence; suppress consistency/missing-section checks over low-confidence regions — else
   every suggestion is secretly about the parser.
4. **One suggestion = one block** → 1:1 with a single apply + undo entry. No multi-block edits in
   v1.
5. **Only ACCEPTED/adjusted outcomes feed the KB.** Never launder raw, unreviewed model output
   into the "canonical" store.
6. **Cost:** deterministic checks first; reserve Haiku for the fuzzy dimensions; **cache the scan
   by doc hash**; one batched call, not one-per-block-per-check.
7. **Judge bias:** anchor "tighten" on information density (not length) to beat verbosity bias;
   keep D1 deterministic to sidestep same-family self-preference.

---

## Phased plan

- **Phase 0 — the spine (fold into CP5, no new UI).** The rubric registry
  (`src/lib/ai/rubric.ts`) + the deterministic entity dictionary + the entity set-diff. Ships
  value even if the panel never does: it *is* the CP5 eval and the edit guardrail.
- **Phase 1 — MVP panel (the demo).** `/api/suggest` (Haiku, batched, structured output, capped)
  running D1/D2/D6 + D4 · a client-state suggestion slice (`src/lib/model/suggestions.ts`, no DB,
  mirrors the doc/undo pattern) · `RefinePanel` inbox (list + highlight + reuse CP4 diff) ·
  Accept/Reject through the CP4 loop · N-of-M + empty/complete states · in-session reject-
  suppression of same-dimension siblings. No persistence, no precomputed rewrites (Accept runs
  one edit call), no Adjust.
- **Phase 2 — the "second thoughtful" polish.** Adjust (edit-result, then re-prompt) ·
  precomputed `proposedText` for instant diff preview · outcome-log **export → README numbers** ·
  two-tier Recommended/Optional grouping · keyboard flow · scan cache by doc hash.
- **Phase 3 — v2 / stretch.** D3 KB-grounded experience-opportunity (needs CP6, **read-only**) ·
  RFP-paste upgrade · cross-session learned priors (localStorage) · acceptance-rate + Cohen's-κ
  calibration eval. *(KB enrichment / accepted-text write-back is **cut**, not deferred — see the
  feedback section; a DB-backed shared KB would only return if enrichment is ever revived.)*

**Cut for v1 (say so in the README):** any persistence · **KB enrichment / write-back (KB stays
read-only)** · RFP-paste · KB dimension · cross-session learning · per-dimension settings UI ·
fancy grouping/pagination · auto-scan on import · multi-block suggestions · writing back to repo
files.

---

## Data model (sketch)

```ts
import type { BlockType } from '../model/doc'; // Block/Doc live here (CP2)

/** One thing worth checking a block for. The scan runs enabled dimensions over
 *  eligible blocks and emits Suggestions. The SAME registry scores the CP5 eval —
 *  that eval IS the 'entity-fidelity' dimension. This is why rubrics unify everything. */
export interface RubricDimension {
  id: string;                       // 'entity-fidelity' | 'consistency' | 'hygiene' | 'tighten' | ...
  label: string;
  description: string;              // what "good" looks like — also fed to the model
  appliesTo: BlockType[] | 'all';
  defaultInstruction: string;       // seed handed to the edit loop on Accept/Adjust
  severity: 'warn' | 'suggest' | 'info';
  deterministic?: boolean;          // judged in code, not by the LLM (D1/D2/D6)
  usesKb?: boolean;                 // pulls kb/ snippets (D3/D5)
  enabledByDefault: boolean;
}

export type SuggestionStatus = 'pending' | 'accepted' | 'rejected' | 'adjusted' | 'stale';

export interface Suggestion {
  id: string;              // stable: hash(blockId + dimensionId)
  blockId: string;         // anchor into Doc.blocks (survives re-parse)
  page: number;            // provenance — scroll/highlight
  dimensionId: string;
  severity: 'warn' | 'suggest' | 'info';
  confidence: number;      // 0–1; gate + rank on this
  title: string;           // imperative one-liner
  rationale: string;       // grounded "why", one clause
  instruction: string;     // seed for the edit loop (editable in Adjust)
  evidence?: string;       // the span that triggered it (for highlight)
  proposedText?: string;   // optional precompute → instant diff (Phase 2)
  kbRefs?: { docId: string; snippet: string }[]; // provenance when usesKb
  status: SuggestionStatus;
}

/** Logged on every decision — the raw material for BOTH "feed back into the KB"
 *  and the acceptance-rate eval. Client state; optional localStorage. */
export interface SuggestionOutcome {
  suggestionId: string; blockId: string; dimensionId: string;
  decision: 'accepted' | 'rejected' | 'adjusted';
  before?: string; after?: string; editedInstruction?: string;
  decidedAt: number;
}
```

New pieces: `src/app/api/suggest/route.ts` (modeled on the health route: `isAiConfigured()`
guard, try/catch → structured JSON), `src/lib/ai/rubric.ts`, `src/lib/model/suggestions.ts`,
`src/components/RefinePanel.tsx`, and a thin `src/lib/model/feedback.ts` for the sinks. Everything
else is **reuse** of CP2 (blocks + parse cache), CP3 (select), CP4 (diff/apply/undo), CP5 (eval),
CP6 (retrieval).

---

## Open questions / decisions

1. ~~Which "feed back" sink?~~ **Decided (2026-08-26):** KB enrichment is **cut** — the KB stays
   read-only grounding. The outcome **log** (eval signal, touches no KB) stays; the broader
   "feed outcomes back into the KB" choice is **deferred** and noted in the README.
2. ~~Sequencing?~~ **Decided:** after CP5, **ahead of CP6** — Accept/Reject demos without RAG, so
   this is the headline "beyond the brief" feature and doesn't wait on retrieval.
3. **Open — ambition for the take-home:** ship **Phase 1 only** (tight, safe), or **Phase 1 + 2**
   (Adjust + the README numbers, i.e. the "two thoughtful features")?

## Done when
- "Scan for refinements" on `easy.pdf` returns a short, high-precision list; the user clicks
  through Accept/Reject; each Accept applies through the existing diff→apply→undo loop and
  composes with manual edits; the rubric that drives it also prints the CP5 number.
```
