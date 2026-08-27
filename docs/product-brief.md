# Product Brief

_Distilled from the Buoyant assignment. Full verbatim copy: [assignment-notion.md](assignment-notion.md)._

## Who / what
**Buoyant** (trybuoyant.ai) builds AI tooling for engineering & consulting firms that write
proposals to win civil / infrastructure / construction contracts. Customers spend dozens of
hours per proposal; Buoyant wants that down to a few. This is the **Founding Engineer
take-home** — representative of the real work.

## The product
A web app to **upload a proposal PDF and edit it section-by-section with AI**. The loop:
1. User uploads a PDF.
2. It's rendered in the browser so they can interact with its content.
3. User selects a unit (paragraph/section — our call) and asks AI to act on it: rewrite,
   tighten, fix names, change tone, add info from a knowledge base.
4. AI returns a proposed change; user sees what changed and decides whether to apply.
5. Applied changes reflect in the document; edits compose; undo if possible.

**Recovering structure from the PDF is the core problem** — PDFs expose no
paragraphs/sections/headings. How we do each step is our call.

## The bar (pass/fail)
`proposals/easy.pdf` must work **end-to-end on the deployed app** (upload → select → AI edit
→ apply). Miss this and the submission fails regardless of other polish. Scope so the loop
closes first.

## What they reward / penalize
- **Reward:** strong product instincts, UX detail, deliberate performance trade-offs, taste,
  polish, and *intentional* scope. "Two thoughtful additions beat ten half-finished ones."
- **Penalize:** feature count for its own sake; impressive-but-ungrounded work.
- They ask "why?" in the demo — reasoning must be grounded in the user.

## Constraints
- Stack: **Next.js + TypeScript**. Deploy: **Vercel** (recommended). DB: optional (default none).
- AI: **only via the Buoyant proxy** (see [fixtures.md](fixtures.md) / [workflow.md](workflow.md)); spend-capped.
- Must **generalize** — graders may run a hidden fixture.

## README is graded (7 required sections)
Setup/run · Design decisions · **What I cut and why** · **Failure modes I worried about** ·
**How I'd evaluate this (run one eval, real numbers)** · What I added beyond the brief · What
I'd build next in 8 hrs. The bolded ones are highest-signal.

## Submission & demo
Public GitHub repo (**don't squash history**), live URL, README. Then a 45-min call: 10 min
demo, 25 min code review + defend decisions, 10 min "what would v2 be."

## Time budget
~4 focused hours expected; submit by the deadline. Ask sharp clarifying questions early
(text Eric) — no penalty.
