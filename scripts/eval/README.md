# Name / entity-fidelity eval

Runs the **preservation instruction grid** over the entity-bearing blocks of the parsed Doc,
against the **shipped `/api/edit` route**, and reports the two-axis numbers required by
[`plans/checkpoint-5-eval-readme.md`](../../plans/checkpoint-5-eval-readme.md).

## Why it's built this way
- **Against the shipped product, not a reimplemented prompt.** Every trial POSTs the exact
  browser request shape (`{ block, instruction, docContext }` → `{ newText }`) that
  [`scripts/e2e-verify.mjs`](../e2e-verify.mjs) uses. Measuring an SDK call with our own prompt
  would describe a system no user runs.
- **The instrument is deterministic-first.** Closed-class entities (`$`, project/contract numbers,
  `MO PE No.`, years, ZIPs, dates, ordinals) are scored by regex ground truth — the LLM may never
  override them. An optional **cross-model** layer (OpenAI `gpt-4o-mini`, while the editor is
  Anthropic `claude-sonnet-4-5`) catches open-class proper nouns so the same eval generalizes to
  the hidden fixture, and never lets the editor grade itself.
- **Two axes, because fidelity alone has a perverse optimum:** a no-op scores 100% on
  preservation. The effectiveness axis (`after != before`, tighten-doesn't-grow, and a cross-model
  "was the instruction applied?" judge) is the ceiling a no-op fails.

## Run
```sh
# 1. one-time, in this worktree (Turbopack rejects a symlinked node_modules):
cp ../../.env.local .env.local   # or your own; needs BUOYANT_PROXY_TOKEN
npm ci

# 2. start the app (any port):
PORT=3121 npm run dev

# 3. run the eval against it:
node scripts/eval/run.mjs --base http://localhost:3121 --out /tmp/eval.json
```

### Flags
| flag | meaning |
| --- | --- |
| `--base URL` | parse/edit route base (default `http://localhost:3121`; pass the **deployed URL** for the recorded run) |
| `--limit N` | cap entity-bearing blocks (quick smoke test) |
| `--no-llm` | deterministic layer only — no proxy calls beyond the edits themselves |
| `--out FILE` | write the full JSON result artifact |
| `--sha SHA` | stamp the deploy SHA into the report (recorded prod run) |
| `--concurrency N` | parallel edit calls (default 4) |

## What it prints
- **Per-instruction preservation `k/n`** (clean trials / total), hard instructions marked `★`.
- **The violation list** — `[block · instruction] kind "entity" note`, before → after — led with, not the %.
- **Cross-model flags** for open-class misses to hand-adjudicate before they count.
- **Effectiveness**, **leak** (validates the forced-tool structured output), and **length drift**.

Exit code is non-zero if any deterministic violation is found **or** effectiveness collapses
(every substantial block no-ops) — so it doubles as a CI guard.

## Files
- `entities.mjs` — the deterministic instrument (regex ground truth + known-corpus alias groups). Zero deps.
- `instructions.mjs` — the preservation grid (hard instructions over-sampled) + the excluded entity-changing set.
- `llm-extractor.mjs` — optional cross-model diff extractor + effectiveness judge (dynamic SDK import).
- `run.mjs` — the harness.
