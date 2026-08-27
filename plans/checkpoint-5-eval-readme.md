# Checkpoint 5 — Evaluation + README

**Goal:** run one real evaluation against the shipped product and report actual numbers,
then fill in the graded README. Required for grading.

## The evaluation: name / entity fidelity
The brief foregrounds names ("client name is wrong", "fix names"), so the highest-signal,
most automatable metric is: **do preservation-type edits keep the entities they should?**

Method:
1. Pull ~15–20 blocks from `easy.pdf`.
2. Run a preservation edit on each (e.g. "tighten this paragraph") — entities should not change.
3. Extract the entity set (names, orgs, project numbers, $ figures) before and after
   (deterministic regex + an LLM extractor).
4. Report **% of edits that preserved every should-be-untouched entity** (and list any
   violations). Real number goes in the README.

## The README (7 required sections — fill all)
1. Setup & run instructions
2. Design decisions (PDF representation, agent design, UX) — brief justifications
3. What I cut and why (be specific — pull from `00-overview.md` cut list)
4. Failure modes I worried about (silent-failure risks; pre-customer checks)
5. How I'd evaluate this — include the real name-fidelity numbers from above
6. What I added beyond the brief and why
7. What I'd build next given another 8 hours
- Also: live URL at top; `.env` / proxy setup notes.

## Done when
- The eval script runs against the deployed/real pipeline and prints numbers.
- All 7 README sections are filled with real, specific content (no TODOs).

## Risks
- Eval that's method-only with no numbers → the brief explicitly wants the loop closed
  from "measure X" to "here's what X is." Run it for real.
