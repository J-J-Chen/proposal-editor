# UI Design — the editor surface

How the app looks and behaves, and *why*. Companion to [architecture.md](architecture.md) (the
data/model design). Decisions here are logged in [decisions.md](decisions.md); the visual study
that produced them is the **"Familiar as Word"** design pitch (interactive mockups + the four
scored directions): <https://claude.ai/code/artifact/acc75563-5a8d-463f-9fbc-97e8623d4404>.

> **The current editor surface** is a single **conversational** surface where *selection = scope* —
> see [**Evolution: conversational editing**](#evolution-conversational-editing-the-just-ask-direction)
> below. "The Assistant" (next section) is the direction it grew from and still supplies the
> foundation (recognisable-not-identical, the calm stacked card, the token palette); the
> conversational surface is how those principles are arranged today.

## Who we're designing for (the driver)
Older, largely **tech-illiterate** users who live in **Microsoft Word** all day and little else
(a municipal / engineering firm's proposal manager or city engineer). This audience is the whole
design driver.

**The principle: recognisable, not identical.** It does **not** have to *look* like Word — it has
to *feel* like something they already know. We borrow Word's **habits and plain words**, not its
chrome. A too-faithful clone hits the uncanny-valley trap: the closer to real Word, the more a
missing right-click menu reads as *"broken Word"* instead of "a simpler tool." So the product wears
its **own calm skin** (a blueprint-teal, grounded in the civil-engineering subject — see the token
palette below), while every *interaction* maps to a Word habit.

## The foundation: "The Assistant"
*The first shipped direction — the current [conversational surface](#evolution-conversational-editing-the-just-ask-direction)
builds directly on it (calm card, visible fidelity, tokens, Word habits).* Of four Word-grounded
directions (scored: Word Calm 8.3 · Assistant-on-the-Right 8.2 · Word Classic 8.0 · Guided Steps
7.5), we led with a hybrid of the two axis-winners:

- **Spine — one persistent right-hand Assistant pane.** The single home for every AI moment: the
  quick edit actions, a free-text request, and the stretch "Refine" list all appear there as the
  same kind of card. One thing to learn. Its header always names the current step
  (`Assistant` → `Working on: OUR FIRM` → `Here is the suggested change`), so the app always
  answers *"what do I do next?"*.
- **Review surface — the calm stacked card.** The AI's proposed change is shown as two labelled
  boxes — **"The wording now"** (grey) above **"The suggested new wording"** (tinted) — read top to
  bottom like a letter. Comprehension is *reading, not merging*; a user who's never seen a redline
  needs zero training.
- **Fidelity made visible.** Protected facts (firm/personnel names, PE license numbers, project
  numbers, dollar figures, phone) carry a gold "shield" tint in the document and a **"Kept exactly
  as written:"** line in the card. An edit that would touch one triggers a plain one-question
  confirm — so a silent name/number swap is structurally impossible, not just discouraged. (This is
  the domain's #1 catastrophic failure; see [goals.md](goals.md) name/entity fidelity.)

**Dropped** (each flagged by the critic panel): a literal ribbon / Home-vs-Review tab split; a
wizard "Step X of 4" counter and mandatory "Next" gate; margin comment-balloons; a dual-place
preview. Desktop-only for the demo.

## Evolution: conversational editing (the "Just Ask" direction)
> **This is the current editor surface.** It grew out of "The Assistant" (previous section) as real
> use exposed the gaps below. Interactive walkthrough on the real `easy.pdf` raster (every flow
> live): **"Just Ask"** — <https://claude.ai/code/artifact/2cf2fd0d-c615-46bb-83dc-b155309ea00f>. It
> supersedes the *pane mechanics* of "The Assistant" where they differ; the **principles**
> (recognisable-not-identical, the calm stacked card, visible fidelity, plain words) are unchanged —
> this is how they're *arranged*, not a new skin.

"The Assistant" shipped first, and real use exposed gaps the owner named. Each pivot below, with the
reasoning behind it (owner-driven, 2026-08-27):

**1. The AI was hard to find, and whole-document editing was cornered.** *Owner:* "the AI editing
part is not very clear," and "it's not intuitive to click the top-right to do the entire doc." The
AI only appeared *after* you selected a paragraph (a discovery cliff), and the whole-doc action sat
in a corner. For a tech-illiterate, Word-native user, "everything should be dead simple."

**2. → One conversational surface; selection = scope.** *Owner:* "Could we have a single chat
interface? If something is selected it modifies just that; nothing selected, it does the whole
thing. Right now it's very disjointed." One persistent ask box replaces the scattered controls. The
make-or-break risk is *silent wrong scope*, so scope is shown **loudly on a bar directly above the
input** ("Editing the **whole proposal**" ↔ "Editing **just this paragraph** — [excerpt] — [×
whole proposal]"), mirrored by the document highlight and captured at send-time. Click a paragraph
to focus it; deselect to return to the whole proposal.

**3. Per-*change* undo, not per-*section* threads.** *Owner* asked whether each section should carry
its own chat/history; we agreed that re-fragments the very thing the single surface just unified.
Kept instead: resolved review cards **collapse to slim one-line undoable receipts** (fat cards
never pile up), a durable **"Changes you've made"** record with per-change *"Undo this one"* +
*"Go to this section,"* and the global top-left Undo.

**4. Proactively-found issues get their own surface — separate, but integrated.** *Owner:* "the
search for issues shouldn't natively be in the chat — too easy to lose them if there are a lot …
but it still has to feel integrated," then: "below the chat, persistently open … they should still
**review** the changes instead of instantly fixing them; reviewing should be **consistent** … but
two panes that look the same need to be **differentiated**." Result: issues get a dedicated surface
with an **amber "attention" identity** (against the teal chat); "Fix this" runs the **same** Keep/
Discard review card in place (never an instant apply); the two surfaces are told apart by **colour,
not layout**.

**5. Onboarding-first: suggestions before manual editing (two tabs).** *Owner:* "after upload the
first thing they go through are the suggestions, then manual refinement — high-impact, high-
confidence, saves time. Not required; switch to manual any time. Two tabs on top, defaults to
fixing issues. Also collects data on good/bad suggestions." Right pane = two tabs: **Suggestions**
(default) and **Ask for a change**. A 5-lens design critique *validated* defaulting to suggestions
and forced refinements we adopted: reframe the copy so it never reads as *already changed*
(**"Suggestions,"** plus a loud **"Nothing has changed yet — you choose each one"**); the default
pass is **objective grounded fixes only** (placeholders, names, repeats), with subjective voice
rewrites demoted to an optional **"More ideas"**; **intent overrides** — clicking a paragraph or
typing jumps straight to *Ask for a change*, scoped; "Edit myself" renamed **"Ask for a change."**
> **Data caveat (matters for the owner's data goal).** A defaulted, "high-confidence"-framed Keep/
> Discard queue shown to a non-technical user **manufactures Keeps** — acquiescence, not judgment.
> The honest signal is the **downstream fate** of a kept edit (did it survive to the exported PDF,
> or get undone via the receipts), **not** the in-the-moment Keep. Never headline Keep-rate as a
> KPI; keep Keep/Discard symmetric. This is a backend/logging decision — flagged, not built.

**6. Every review card is a conversation.** *Owner:* "do the review changes allow them to chat about
it? it should still follow the normal chat — right now there's no back and forth." Keep/Discard was
a dead end: if the rewrite was *almost* right, the only moves were accept-as-is or retype from
scratch. Now every review card — chat, whole-doc stepper, and Suggestions tab alike — carries a
**"Tell me how to adjust it"** row (quick chips *Even shorter / More formal / Plainer words* + a
free-text box). A tweak rewrites the suggestion **in place**, stacks the asks as a visible thread
("You asked: ↻ shorter ↻ more formal"), and Keep/Discard then apply to the *latest* wording. The
back-and-forth is anchored **to the change** (not routed through the main composer) so it behaves
identically on all three surfaces, keeps the Suggestions queue intact, and never loses which change
you're discussing. If a tweak wouldn't actually help, the assistant **keeps the wording and says
why** ("it's already plain enough") instead of faking a change — which also signals it won't
blindly churn the text.

**What did *not* change (invariants across every pivot):** the calm stacked *"the wording now / the
suggested new wording"* card; the protected-fact gold tint + un-bypassable confirm; the **Keep this
change / Discard** verbs; Undo top-left; the plain-words vocabulary; and the single
review-and-apply loop that every surface reuses. The redesign rearranges these into one
conversation — it does not replace them.

**Biggest open risk:** whether the reframe is *enough* to avoid first-contact distrust ("did it
already edit my proposal?") can only be settled by watching one real tech-illiterate Word user
upload cold. If not, the fallback is a co-visible fixes dock over a single chat (superseded design
iterations "Six Ways In" and "Two Doors In" — links in the [decision log](decisions.md)).

## The Word habits we borrow (feature → familiar convention)
| App feature | The habit we borrow | How it shows up |
|---|---|---|
| Get a PDF in | **"Open"**, never "Upload" | Big blue *Open a proposal* button + a one-click **sample** so a nervous user never hunts for a file |
| Slow parse | A narrated wait | *Reading your proposal… → Finding the sections… → Almost ready…* — never a blank screen or a stalling % |
| The document | Print-Layout page on a grey canvas | A clean white page, big serif body, real headings; the PDF's messes silently cleaned |
| Pick a unit | Click into a paragraph | Plain single click selects a whole block; strong blue fill + *"You selected this paragraph"* |
| Common edits | Plain-language buttons | *Rewrite this · Make it shorter · Fix names and spelling · Make it more formal* — never "Tighten"/"Tone" |
| Review a change | **Track Changes → Accept/Reject** | The calm card; verbs softened to **Keep this change / Discard** |
| Reverse anything | **Undo/Redo, top-left** | Always-visible arrows in the title bar (Quick Access Toolbar spot); ⌘Z/⌘⇧Z also work |
| The record | A plain changes list | *Changes you've made* — what you asked, before→after, when. Not a "commit history" |
| Never-touch facts | Locked-region shading | Gold entity tint + an extra confirm to change one |

## Confirmed decisions (owner, 2026-08-26)
1. **Verbs: "Keep this change" / "Discard"** (calm), not literal Accept/Reject.
2. **Added text = green underline; removed = red strikethrough** — colour never carries meaning
   alone (the underline/strikethrough *shape* does, so it's colour-blind-safe).
3. **The inline redline marks inside the card are the first thing to cut** if the build runs long —
   the two plain stacked boxes are enough on their own.
4. **Desktop-only** for the demo; a responsive layout is post-bar polish.
5. **Tune the model toward small, surgical edits** (change only what's asked; lead with the changed
   sentence) so a one-word fix reads as one word in the card.

## Plain-language vocabulary (never leak jargon)
`Upload → Open a proposal` · `Parsing → Reading your proposal` · `Diff → What will change` ·
`Apply/Commit → Keep this change` · `Reject → Discard` · `Tighten → Make it shorter` ·
`Undo stack/history → Changes you've made` · `Block/section unit → this paragraph` ·
`Knowledge base → Your past proposals` · `Refine/findings → Suggestions to review / Make this fix`.
Never surface: *diff, parse, block, commit, token, upload, KB, cache, render*.

## Readability floor (functional, not polish — presbyopic eyes)
- **Document body ≥ 20px** (never below 19px), line-height 1.6, content column ≤ 720px.
- **Min tap target 48×48px**; the one **primary** action per screen is 56px tall.
- **Contrast ≥ 7:1** (AAA) for body & essential UI text; focus ring 3px, ≥3:1.
- One primary action per screen; **no** hover-only affordances, right-click-only menus, or
  keyboard-only paths; confirm before anything destructive; Undo always visible.

## Token palette (the product's own "blueprint" skin)
Blueprint-teal accent (subject-grounded in civil engineering), warm-neutral document, semantic
green/red for changes, gold for protected facts. Implemented as CSS custom properties in
`src/app/globals.css`.

| Token | Value | Use |
|---|---|---|
| `--accent` | `#1F6A86` | headings, selection bar, links, the pane icon |
| `--cta` | `#1A6E8C` | primary request buttons (Open, Ask, Check my proposal) |
| `--keep` | `#217346` | the "Keep this change" commit action (green = go) |
| `--added` / `--removed` | `#2E7D32` / `#C0392B` | added (underline) / removed (strikethrough) in the card |
| `--protect` / `--protect-ink` | `#FDF3D1` / `#8A6D1B` | protected-entity tint + its text |
| `--canvas` / `--page` | `#E6E6E6` / `#FFFFFF` | the grey desk / the document page |
| `--panel` | `#F5F6F8` | the right Assistant pane |
| Document body font | `Georgia, "Times New Roman", serif` | the proposal text |
| UI font | `system-ui, "Segoe UI", Roboto, sans-serif` | chrome, buttons, pane |

## Implementation map (aligned to the parallel build — see [build-plan.md](build-plan.md))
The document model and API shapes are the **frozen contract** every track builds against
(`src/lib/types.ts`: `Doc`/`Block`/`EditOp`/`HistoryEntry`; `src/lib/contracts.ts`:
`EditRequest`/`EditResponse`, `ParseRequest`/`ParseResponse`; mock `src/fixtures/easy.doc.json`).
**This UI does not define its own types.** The design maps onto the tracks:

- **Track B — Render + Select** (`src/components/DocumentView.tsx`, `BlockView.tsx`): `Doc` → the
  clean document page, click-to-select, the **gold protected-entity tint**. The "clean document"
  and selection design lives here.
- **Track D — Edit-loop, FE** (`src/state/editor.ts`, `EditPanel.tsx`, `DiffView.tsx`): the
  right-hand **Assistant pane** (quick actions + free text = `EditPanel`), the **calm stacked
  review card** (= `DiffView`), and the inverse-command **undo/redo** log (`state/editor.ts`).
  Calls `POST /api/edit`; applies via an `EditOp` on the block model.
- **Track C — Edit API** (`src/ai/edit.ts` + `src/app/api/edit/route.ts`): the real rewrite +
  **entity-fidelity guardrail** (change only what's asked; preserve names / project #s / `$`).
  Currently a stub that echoes a visible edit so Track D can build now.
- **Track A — Parse** (`src/app/api/parse/route.ts`): real `Doc` (stub returns the fixture).
- **Design system (this doc's remit):** the token palette + shared visual language, in
  `src/app/globals.css`, consumed by B and D so the four tracks read as **one product**. Protected-
  entity detection (for B's tint / the "Kept exactly" line) is shared logic — a small `entities`
  helper both B and C can use.

## Build phases (from build-plan.md)
- **Phase 0 — Contracts:** done (types, contracts, mock Doc, stub routes).
- **Phase 1 — Fan out:** Tracks A/B/C/D build in parallel against the contract + mocks. The design
  above is the spec Tracks B & D implement.
- **Phase 2 — Integration:** real parse → render; FE → real `/api/edit`; wire `page.tsx`. **Closes
  the bar on deployed `easy.pdf`.**
- **Phase 3 — Stretch:** the "Refine" list (Track G) reuses this exact card + apply path.

## Refine ("Check my proposal for things to fix") — v1 shipped
A proactive review pass (Track G / CP7). v1 is **deterministic and client-side** (`src/refine/scan.ts`)
— no model call, no spend — flagging only things it can quote verbatim: leftover placeholder text,
lowercased names/titles ("vogler, pe"), and repeated-word runs ("Vice-President Vice-President…").
Each suggestion's **"why" is grounded** in that quoted text (per [decisions.md](decisions.md): a
grounded rubric check, never free-form LLM justification). The `RefinePanel` lists them; **"Make this
fix" routes through the existing `/api/edit` → review card → Keep/Discard/Undo loop** (the suggestion
supplies the instruction), so accepting a suggestion *is* an edit-loop apply. Precision over recall:
capped, high-confidence, with a calm "nothing to fix — looks good" empty state. **Next:** an
`/api/suggest` route on a cheap model for the fuzzy checks (tighten wordy boilerplate, richer
consistency) that a regex can't judge.
