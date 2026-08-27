# How We Work

## The invariant: the main BRANCH, not the root working tree
**The `main` branch advances only through the merge queue** — `--no-ff`, history preserved,
never a hand commit or `git push`. That is the *entire* invariant, and it's about the **branch**
(the commit graph), NOT about the shared repo-root checkout being spotless. (The one genesis
commit that created the repo was the only direct commit to main.)

**Canonical main = `origin/main`.** The queue is fully isolated: it merges + gates + pushes in
its **own dedicated worktree** (`../proposal_editor-worktrees/.queue`, detached) and **never
touches the shared root**. So stray edits in the root (every session's cwd) are simply
irrelevant — there is nothing to stash and nothing to clobber; lands are independent. The root's
local `main` ref is not advanced by the queue — always treat `origin/main` as the source of
truth (`wt-new` branches off it). Therefore:

- **Do all real work in your own worktree** (`scripts/wt-new.sh <task>`), commit there, land it.
- **The repo root is not a workspace.** Edits made directly under `/Users/john/proposal_editor`
  are never landed — move to a worktree.

## Worktrees + local merge queue
Worktrees are siblings at `../proposal_editor-worktrees/<slug>`. This is what lets multiple
agents work in parallel without stepping on each other.

```sh
scripts/wt-new.sh <name>                 # new worktree + branch feat/<slug> off latest main
cd ../proposal_editor-worktrees/<slug>   # do the work; commit in small, real steps
scripts/mq-land.sh                        # serialized merge into main (current branch)
scripts/mq-land.sh --cleanup             # ...and remove the worktree + branch after
scripts/mq-status.sh                      # worktrees, lock state, recent lands
scripts/wt-list.sh ; scripts/wt-rm.sh <name> --delete-branch
```

How the queue behaves:
- A `mkdir` lock **serializes** lands (FIFO) so the queue worktree is single-writer.
- It runs entirely in its **own detached worktree** (`.queue`) off `origin/main` — never the
  shared root, so a dirty root can't block or corrupt a land. Nothing is stashed.
- Merges are **`--no-ff`** → branch history preserved (brief forbids squashing).
- A **light gate check** (`.mq/check.sh`, typecheck only, no tests — speed-first) runs in the
  queue worktree; failure aborts the land (nothing is pushed). Bypass with `MQ_SKIP_CHECK=1`.
- On conflict: merge `origin/main` into your branch, resolve, retry.
- The `.queue` worktree is created on first land and reused; it appears in `wt-list`/`mq-status`.

## Best-practice structure, cheaply
Decompose by concern (parse / model / ai / api / ui) — not everything in one file — but don't
over-abstract a 4-hour app. See [architecture.md](architecture.md) "Boundaries".

## Environment & secrets
**Never commit the proxy token or any secret.** Copy `.env.example` → `.env.local`
(gitignored). All AI calls run **server-side**.

Proxy = drop-in for the official SDKs:
```ts
import Anthropic from '@anthropic-ai/sdk';
const anthropic = new Anthropic({
  apiKey: process.env.BUOYANT_PROXY_TOKEN,
  baseURL: process.env.ANTHROPIC_BASE_URL, // https://hiring-proxy.trybuoyant.ai/anthropic
});
```
```ts
import OpenAI from 'openai';
const openai = new OpenAI({
  apiKey: process.env.BUOYANT_PROXY_TOKEN,
  baseURL: process.env.OPENAI_BASE_URL,    // https://hiring-proxy.trybuoyant.ai/openai
});
```
Spend is **capped** — cache parses, keep prompts small, use a cheaper model where quality holds.

## GitHub account
Repo: **https://github.com/J-J-Chen/proposal-editor** (public, required). Owned by the personal
**J-J-Chen** account (John Chen / jjchen2019@gmail.com). Pushes rely on `J-J-Chen` being the
active `gh` account (`gh auth switch --user J-J-Chen`) with `gh` as the git credential helper.
Switch back to your other (work) account afterward with `gh auth switch --user <work-account>`.

## Deploying (Vercel — personal account only)
**Live app:** https://proposal-editor-sandy.vercel.app
(alias of `proposal-editor-john-chen-s-projects.vercel.app`)

Deploy under the **personal** Vercel account **jjchen2019@gmail.com** (`jjchen2019-5995` /
"John Chen's projects", project `proposal-editor`). **Never the work account.** The machine's
Vercel CLI is logged into a *non-personal work* account, so we deploy with a
**personal access token** instead — it has no work scope, so a wrong-account deploy is
impossible.

```sh
export VERCEL_TOKEN=<personal access token from vercel.com/account/tokens as jjchen2019>
scripts/deploy.sh prod     # production; omit "prod" for a preview
# equivalently: vercel deploy --prod --yes --token "$VERCEL_TOKEN"
```
- First time in a fresh checkout: `vercel link --yes --project proposal-editor --token "$VERCEL_TOKEN"`.
- `ssoProtection` is **off** so the URL is public (required for grading). Don't re-enable it.
- App env vars (set on the Vercel project, not committed): `BUOYANT_PROXY_TOKEN` (+ optionally
  the base URLs). Add with `vercel env add BUOYANT_PROXY_TOKEN production --token "$VERCEL_TOKEN"`
  then redeploy. Until it's set, `/api/health/ai` returns 503 "not configured" (by design).

## Session context for agents
A `SessionStart` hook (`.claude/settings.json`) cats `docs/README.md` into context on
startup/resume/clear, so every session loads the KB index automatically. Read the deeper docs
relevant to your task. When you make a non-obvious call, log it in [decisions.md](decisions.md).
