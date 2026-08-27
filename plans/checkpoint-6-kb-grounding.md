# Checkpoint 6 — KB Grounding (stretch)

**Goal:** ground edits in the firm's past work. The brief's literal example — *"add a
paragraph about a past project we did"* — should pull **real** content from the `kb/` corpus,
rewritten in MECO's voice, with every entity verbatim and its **provenance shown**. This is
the product's actual differentiator — build it only after the core loop closes.

> Prereq gate (Hard Rule 1): **do not start CP6 until `easy.pdf` works end-to-end on the
> _deployed_ app** (upload → select → AI edit → apply → undo/redo). CP6 competes with the bar
> for the same hours; the bar wins every time.

## The one interaction: "Add similar experience"
At an insertion point in the current SOQ's experience area, the consultant types a plain-language
ask (*"a bridge we've done"*) → zero-token keyword retrieval returns real past projects as
**candidate cards, each showing source doc + page _before_ anything is generated** → the human
**picks one** → the AI composes a proposal-ready paragraph **in MECO's voice, matching the
existing entry format**, using **only** that project's facts → it's inserted as a new block via
the existing apply/compose/undo path, with a word-level (all-add) diff and a persistent
provenance badge.

**Why this shape:** *pull, don't write* + *human picks the project before any generation* (the
anti-contamination move) + *provenance as the built-in trust layer*. It's the exact beat a
grader rewards, and it's honest — the app never invents a project.

## Compose: voice-first, with a fidelity net (owner directive)
Every edit must sound like MECO, so the inserted paragraph must match the **voice and format** of
the surrounding entries — a mechanical mail-merge template does not. Therefore:

- **Default = LLM compose.** Prompt gets the chosen chunk's facts in a delimited `<past_work>`
  block, **1–2 real MECO project entries as few-shot format exemplars**, and the firm voice card
  (below). Instruction: write one paragraph in MECO's voice matching the exemplar format, using
  **only** `<past_work>` facts, copying every proper noun / client / location / dollar figure
  **verbatim**, inventing nothing. Extends the CP4 preserve-entities guardrail with *"never
  transfer a number/name/estimate between projects."*
- **Fidelity net (deterministic, cheap):** after compose, assert every entity/number from the
  chosen chunk appears **verbatim** in the output, and no dollar figure appears that isn't in the
  chunk. On failure → fall back to the template (or flag). **The AI supplies voice; code
  guarantees the facts.**
- **Fallback = zero-LLM template.** Framing sentence + verbatim present fields, degrading
  gracefully when a field is absent. Used when the LLM call fails the fidelity net or errors — a
  safe, deterministic floor, not the primary path.

This makes CP5 (name/entity fidelity) more load-bearing — it now measures the exact surface most
likely to alter a fact. Good: the KB feature and the eval reinforce each other.

## Voice everywhere (touches CP4, not just KB)
"All edits in their voice" is a property of the **whole** edit loop, not a KB-only feature. Build
a small **firm voice card once, offline** — a short style descriptor + a handful of exemplar
sentences mined from the KB (first-person plural, "MECO", full credentials like *"James D.
Bensman, PE, SE"*, recurring phrasing) — and inject it into the `docContext` of **every** edit
call. Cheap, high-payoff, and a clean "why?" answer in the demo. (This is the voice-consistency
idea, correctly scoped: context every edit carries, not a button.)

## Grounded rationale — the "why" behind a suggestion
When the app *suggests* an edit (the CP7 "Refine" layer), it should show **why**, grounded in
evidence a new consultant can verify — turning the tool into a **teacher of the firm's
conventions** rather than a black box. This is **not the eval**; it's the eval's **user-facing
twin**. The CP7 rubric is one shared spine: run over many edits it yields the CP5 **numbers**
(offline); run on *this* block it yields a **reason** (in-UI). Same source of truth, two audiences.

Two grounded forms — difficulty runs *opposite* to intuition:
- **Level 1 — rubric reason (deterministic, ~free).** The check *is* the reason. From the entity
  dictionary + voice card: *"You wrote 'MECO Engineering'; your last 4 SOQs say 'MECO Engineering
  Company.'"* / *"Cite him as 'James D. Bensman, PE, SE' — that's how every past proposal lists
  him."* No LLM, no hallucination risk.
- **Level 2 — a real KB example as evidence (reuses CP6 exactly).** Point the same retrieval +
  provenance at the *rationale*: *"Here's how you've described a comparable project before:
  '…valued at $1,075,770.35 for the Marion County Commission' (NEMO RPC Bridge SOQ, p.8)."* This
  is composition, not new machinery — and it's the **safe** way to show reasoning: the "why" is a
  verifiable quote with a source, not the model's opinion.

**Not built: Level 3 — free-form LLM justification** ("here's why I changed it"). Trivial to
generate, and exactly the *impressive-but-ungrounded* trap the brief warns against — a grader
pokes it in the demo. Acceptable only as phrasing over Level 1/2 evidence, never as the source.

**Degrade gracefully:** show a KB example where retrieval finds an apt one; fall back to the rubric
reason where it doesn't; **never manufacture a reason** (same rule as the insert flow).

**Where it lives:** the suggestion-rationale *UX* is CP7 (the Refine layer); CP6 supplies the
Level-2 evidence (retrieval + provenance — build steps 1–2) and CP5's rubric supplies the Level-1
reason. Near-zero new machinery: it surfaces the evidence the system already used to decide. This
doc owns the mechanism; the UX is a hand-off to CP7.

## Architecture (deliberately small)
```
OFFLINE (build-time, ~$0 at runtime)              RUNTIME (Vercel Node route)
────────────────────────────────                 ──────────────────────────────────────
ingest 5 kb/*.pdf via the CP2 parser              user: "＋ Add similar experience" + "a bridge…"
  → hand-VERIFY each field is bound to text            │
    co-located with its project title                  ▼   POST /api/kb/search { query, k }
  → mine the firm voice card + format exemplars    keyword-overlap over imported chunks[] (in-mem,
  │                                                 ZERO tokens) → candidate cards w/ source line
  ▼                                                     │   human picks ONE
src/kb/index.json  (committed to git)                   ▼   compose: LLM in-voice (default)
  chunks[] + voiceCard + exemplars                       │   → fidelity net → template on fail
  no DB · no embeddings · no vector store · no BM25       ▼
  stats · no runtime ingest                          insert-after as a new block (reserved 'insert'
                                                     op) · all-add diff · provenance on block +
                                                     history entry · undo removes it
```

- **Fixed, committed index.** The KB is a fixed, read-only 5-doc corpus → a bundled
  `src/kb/index.json`, versioned in git. No DB, no runtime ingest.
- **Ingest is programmatic + hand-verified.** Reuse the CP2 hybrid parser to extract, then
  **hand-verify the field bindings** (the corpus is small and fact-fidelity matters more than
  full automation). Defensible in code review: *"ingestion is programmatic; I verified bindings
  by hand because fidelity on a curated corpus beats blind automation."*
- **Retrieval = ~20 lines of keyword overlap, in-memory, zero tokens.** For a few dozen tiny
  chunks it's sub-ms and indistinguishable from BM25; the human's pick-from-list already provides
  the precision a ranker would buy. Discipline stays a plain tag for a coarse filter only.

## Data model (aligns with the existing block + EditOp union)
```ts
type Discipline =
  | 'bridge' | 'electrical' | 'city-services'
  | 'demolition' | 'transportation-grant' | 'general';

interface KbChunk {
  snippetId: string;          // `${sourceDoc}#${page}#${slug(title)}`
  discipline: Discipline;     // plain keyword tag (no detection pass)
  sourceDoc: string;          // 'nemo_rpc_bridge_soq.pdf'   ┐ provenance,
  sourceTitle: string;        // 'NEMO RPC Bridge SOQ'       │ REQUIRED
  page: number;               //                             ┘
  title: string;              // content — hand-bound VERBATIM to title-adjacent text.
  scope?: string;             // absent field ⇒ omit it (empty is the DEFAULT case).
  client?: string; location?: string; role?: string;
  estimate?: string;          // "$1,075,770.35" — only where genuinely present
  // NOTE: no projectNumber — the 001-xxx values are the SOQ's own doc id, not the project's.
  cleaned: string;            // cleaned hover-to-verify text (not the jumbled raw)
}
interface KbIndex {
  version: 1; builtAt: string;
  chunks: KbChunk[];          // project chunks only
  voiceCard: string;          // firm voice descriptor injected into every edit
  formatExemplars: string[];  // 1–2 real MECO project entries, for few-shot format matching
}

// Retrieval — server route, ZERO tokens
interface KbSearchRequest  { query: string; discipline?: Discipline; k?: number }
interface KbCandidate      { chunk: KbChunk; score: number }
interface KbSearchResponse { candidates: KbCandidate[] }

// Insert — the reserved structural EditOp (see architecture.md "The edit loop"); undo removes it.
type KbInsertOp = { kind: 'insert'; blockId: string; block: Block; afterId: string };
// The inserted Block carries KB provenance; the HistoryEntry rationale records the source.

// Grounded rationale — the "why" shown with a suggestion (CP7 UX; CP6/CP5 supply the evidence)
interface GroundedRationale {
  reason: string;              // Level 1: a rubric check, in plain words (deterministic)
  evidence?: {                 // Level 2: a real KB citation, where retrieval finds an apt one
    quote: string;             // verbatim snippet from a past proposal
    sourceDoc: string; sourceTitle: string; page: number;
  };
  // No free-form LLM justification (Level 3): reason = a rubric check, evidence = a real quote.
}
```
The insert is the **reserved `'insert'` op** the undo/redo design already carved out — routed
through `applyOp`/`invertOp`, undo removes the block. No parallel undo mechanism.

## Corpus facts that drove this (verified via pymupdf; real recon)
- **All 5 kb docs + easy.pdf are the same MECO SOQ template** — consistent voice/spine.
- **`001-xxx` "project numbers" are the SOQ's own document id, not per-project** — and are even
  inconsistent within a doc (the bridge SOQ carries both `001-902` and `001-9002`). Indexing them
  would let provenance rubber-stamp a real-but-wrong number → **don't index `projectNumber`.**
- **Only the bridge and Palmyra carry real per-project dollar estimates**;
  electrical/demolition/macon have none → **empty fields are the default; degrade gracefully.**
- **easy.pdf's "RELEVANT EXPERIENCE" is a municipality list (City of Dixon), discipline `general`**
  → insert under a small **"Representative Project"** sub-heading so a bridge write-up isn't
  bolted-on; demo a deliberately cross-discipline ask.
- **Ideal demo case:** Taylor Bridge (`nemo_rpc_bridge_soq.pdf`, p8) — title + scope +
  `$1,075,770.35` + Marion County Commission client all co-located on one clean page.

## Build steps (ordered; only after the gate)
1. **Ingest → `src/kb/index.json`** (M, offline): parse the 5 docs via CP2, hand-verify field
   bindings, mine `voiceCard` + `formatExemplars`, leave `projectNumber` unset. Commit the JSON.
2. **`POST /api/kb/search`** (S, runtime): keyword-overlap top-k + coarse discipline filter, zero
   tokens. Smoke-test on real queries.
3. **"Add similar experience" UI + candidate cards** (M): NL input, cards showing present fields +
   a source line (doc · p.N). Provenance visible **before** generation; human picks one.
   *Demoable already at this step.*
4. **Voice-first compose + fidelity net** (M): LLM-in-voice via the edit route (with `<past_work>`
   + exemplars + voice card) → entity-verbatim check → template fallback on failure.
5. **Insert via the reserved `'insert'` op** (M): insert-after under a "Representative Project"
   sub-heading; all-add diff; provenance on the block + history entry; undo removes it. Reverify
   the easy.pdf core loop after wiring.
6. **No-match fallback** (S): nothing clears the match floor → offer "edit without past work" or
   refine. Never fabricate.
7. **Voice card into every edit** (S, CP4 touch-up): inject the voice card into `docContext` for
   all edits, not just KB.

## Failure modes & mitigations
- **Cross-project fact mis-binding at ingest** (a correct chunk whose estimate/client drifted to a
  neighbor during multi-column extraction — the human pick can't catch it, it precedes candidates)
  → **hand-verify bindings at ingest**; this is why the blind LLM structuring pass isn't trusted
  for KB facts.
- **`projectNumber` contamination** → not indexed (see corpus facts).
- **Empty fields deflate cards/paragraphs** → treat empty as default; lead the demo with hero
  projects (bridge, Palmyra).
- **Insert/undo bug breaks the core `easy.pdf` demo** → smallest additive change on the reserved
  `'insert'` op; reverify the core loop after wiring.
- **Tonal/format mismatch** → few-shot exemplars + voice card + "Representative Project" heading.
- **LLM alters an entity while rewriting for voice** → the deterministic fidelity net + CP5 eval.
- **Scope creep back toward a second mode / auto-arm / validation subsystem** → hold the line:
  one explicit action, additive insert only.

## Deliberately cut (say so in the README)
- **Grounding/replace mode with inline citations** — additive insert is the one mode.
- **Keyword auto-arm on free-text edits** — explicit action only; protects the spend cap and the
  change-only-what's-asked contract.
- **Vector DB / embeddings / precomputed BM25 stats** — keyword overlap over a committed index.
- **Per-fact `citations[]`, discipline-detection pass, field boosts / score-floor tuning,
  server-side substring validation** — the human pick + hand-verified bindings + fidelity net
  cover the same ground more cheaply. (Substring validation only proves a string *exists*, never
  that a fact *belongs* to the project.)
- **FirmFacts / firm / team / list chunk tiers** — v1 indexes project chunks only.
- **Multi-paragraph / whole-section synthesis.**

## Deferred → README ("what I'd build next")
- **Live / user-uploaded KB.** v1 assumes a fixed, read-only 5-doc corpus served from a committed
  JSON index. Runtime upload would force a heavier path (Blob + first-run parse) — a deliberate,
  noted deferral, not an oversight.
- Export edited doc back to PDF/DOCX · graceful `hard.pdf` · multi-paragraph chat.

## Done when
A KB-type ask inserts a **real** past-project paragraph — in MECO's voice, every entity verbatim,
with visible provenance — into `easy.pdf` on the **deployed** app, and undo removes it cleanly.
Demo: *"a bridge we've done"* → pick Taylor Bridge → insert under "Representative Project" with
the real `$1,075,770.35` and Marion County client + a source line.
