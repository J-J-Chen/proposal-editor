# Checkpoint 1 — Scaffold + Deploy

> **STATUS — BUILT.** Scaffold + Vercel deploy shipped; the live app and the `/api/health/ai` route are up. Historical plan below.

**Goal:** a live Next.js/TS app on Vercel that can make a real AI call through the
Buoyant proxy from a server route. Deploy in the first ~30 minutes; the graded artifact
is the *deployed* app, so get the pipeline working before building features.

## In scope
- `create-next-app` (TypeScript, App Router, Tailwind). Runs on this first worktree.
- Env wiring: `BUOYANT_PROXY_TOKEN`, `ANTHROPIC_BASE_URL`, `OPENAI_BASE_URL` (server-side only).
- Anthropic + OpenAI SDKs installed and pointed at the proxy.
- A tiny health route (e.g. `GET /api/health/ai`) that makes one cheap model call and
  returns ok/latency — proves the proxy works in prod.
- Deploy to Vercel; set env vars in the Vercel project; confirm the health route in prod.
- Minimal landing page with an upload affordance (wired next checkpoint).

## Out of scope
Any real parsing, rendering, or editing. Auth. DB.

## Approach
- Use the merge queue to land the scaffold — validates the whole flow on a real change.
- Keep the health call cheap (small model, tiny prompt) to protect spend caps.
- All AI calls behind server route handlers; token never sent to the browser.

## Done when
- App builds and deploys green on Vercel.
- Hitting the deployed `/api/health/ai` returns a real model response.
- `scripts/mq-land.sh` landed the branch and main is clean + pushed.

## Risks
- Proxy auth/CORS quirks — test the health route in prod, not just locally.
- Committing the token by accident — it lives only in `.env.local` / Vercel env.
