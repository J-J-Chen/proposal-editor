/**
 * KB corpus — a committed, deployable distillation of the firm's own sample proposals.
 *
 * Two cards, both derived from already-committed material (src/parse-cache/*.json), so nothing
 * confidential is published:
 *  - FIRM_VOICE — how the firm writes (steers editorial tone; consumed by src/lib/suggest.ts).
 *  - FIRM_FACTS — a closed, reference-only set of real facts (grounding, never fabrication).
 *
 * See docs/decisions.md for the sourcing + anti-fabrication rationale.
 */
export { FIRM_VOICE, type FirmVoiceCard } from './voice';
export { FIRM_FACTS, type FirmFacts, type FirmProject } from './facts';
