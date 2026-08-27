# Name / entity-fidelity eval

Runs a **preservation instruction grid** over the entity-bearing blocks of a parsed Doc, against
the **shipped `/api/edit` route**, and reports **per-entity-class** fidelity on two honest axes
plus an applicability-aware effectiveness number. Required by
[`plans/checkpoint-5-eval-readme.md`](../../plans/checkpoint-5-eval-readme.md).

## Two datasets
- **easy.pdf** — the primary, recorded result.
- **hard.pdf** — a longer SOQ used as an **additive holdout**: 279 blocks, 8 with `$` figures.
  easy.pdf has **zero** `$` figures, so hard is what actually exercises the advertised
  dollar-fidelity guardrail. It is never tuned to; it is the generalization set.

## Design (and the anti-overfit contract)
- **Against the shipped product.** Every trial POSTs the exact browser request shape
  (`{ block, instruction, docContext }` → `{ newText }`) that [`../e2e-verify.mjs`](../e2e-verify.mjs)
  uses — not a reimplemented SDK call.
- **No test-set tuning.** `entities.mjs` contains **no** entity name from either PDF. Closed-class
  entities are matched by generic regex; proper nouns by generic capitalized-phrase + acronym
  extraction with a **domain-generic** stoplist (ordinary English + civil-engineering vocabulary
  and units — never the names under test). The **same code path** scores easy and hard.
- **Two honest numbers.** STRICT-verbatim is primary (the shipped prompt asks for verbatim, so
  `$5.6M` → `$5.6 million` counts as a *change*); VALUE-aware is secondary (a reformat that keeps
  the value — `$` by magnitude, a name by its distinctive token, a date by m/d/y parts — is
  forgiven). The gap between them is reported.
- **Deterministic-first instrument.** Closed classes (`$`, PE#, project#, year, date, ZIP,
  program-id) are regex ground truth. Proper nouns add an optional **cross-model** layer
  (OpenAI `gpt-4.1` while the editor is Anthropic `claude-sonnet-4-5`) so the editor never grades
  itself and the eval generalizes; a `--no-llm` run uses the deterministic layer only.
- **No perverse optimum.** Fidelity alone scores 100% for a no-op, so effectiveness is scored
  **applicability-aware**: the cross-model judge marks trials where a competent editor would make
  no change (a short header, already-correct text) *not applicable* and excludes them, instead of
  scoring a correct no-op as a failure.

## Run
```sh
# one-time in this worktree (Turbopack rejects a symlinked node_modules):
cp ../../.env.local .env.local   # needs BUOYANT_PROXY_TOKEN
npm ci

# against the deployed app (the recorded run):
node scripts/eval/run.mjs --doc hard --base https://<deployed-url> --sha <DEPLOY_SHA> \
  --max-blocks 22 --out eval-hard.json

# against a local dev server (PORT=3121 npm run dev), deterministic-only, quick:
node scripts/eval/run.mjs --doc easy --base http://localhost:3121 --no-llm
```

### Flags
| flag | meaning |
| --- | --- |
| `--doc easy\|hard` | which seeded dataset to parse (sets the real cache hash + filename) |
| `--hash SHA` | override the parse hash (advanced) |
| `--base URL` | parse/edit base (default `http://localhost:3121`; pass the deployed URL for the recorded run) |
| `--sha SHA` | stamp the deploy SHA into the report |
| `--max-blocks N` | class-diverse cap; **all `$`-bearing blocks are always kept** |
| `--limit N` | hard block cap (smoke test) |
| `--no-llm` | deterministic layer only |
| `--out FILE` | write the JSON artifact |
| `--concurrency N` | parallel edit calls (default 6) |

## Output
Per-entity-class `k/n` (strict │ value), the **violation list** (real value losses) led first,
the strict-only reformat count, per-instruction preservation, applicability-aware effectiveness,
leaks, length drift, and the anti-overfit checklist. Exit code is non-zero on any value violation
or an effectiveness collapse.

## Files
- `entities.mjs` — the deterministic instrument (generic regex + generic proper-noun extraction). Zero deps.
- `instructions.mjs` — the preservation grid (hard instructions over-sampled) + the excluded entity-changing set.
- `llm-extractor.mjs` — cross-model diff extractor + applicability/effectiveness judge (dynamic SDK import).
- `run.mjs` — the harness.
