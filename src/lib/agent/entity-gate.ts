/**
 * The deterministic entity-fidelity gate.
 *
 * Entity fidelity is the product's headline promise (docs/goals.md): edits must never silently
 * alter a proper noun, project/license number, or dollar figure. The single-block flow enforces
 * this in the FE (Editor.tsx: `beforeEnts.filter(s => after.includes(s))`, then a confirm modal).
 *
 * The agentic batch flow proposes MANY edits at once, and a user reviewing a batch skims — so the
 * check has to be a real, server-side backstop that runs on every proposed edit, not just an FE
 * courtesy. This is that check, formalized and reusable: purely deterministic (string containment
 * against the same protected-entity extractor the UI highlights with), no model in the loop.
 *
 * Policy: we never silently drop a protected entity, and we never silently drop the user's
 * request either. A dropped entity becomes a WARNING on the proposed edit; the agent first tries
 * a bounded repair (re-edit forbidding the change), and only a still-broken edit ships flagged —
 * which the FE surfaces loudly, mirroring the single-block confirm.
 */
import { droppedEntities, protectedStrings } from '@/lib/entities';

export interface EntityFidelity {
  /** Protected entities from `before` whose full count survives in `after`. */
  kept: string[];
  /** Protected entities from `before` whose count DROPS in `after` (altered or removed). */
  dropped: string[];
}

/**
 * Check that every protected entity present in `before` survives — in the SAME COUNT — in `after`.
 * `extraNames` extends the known-names list with doc-specific names (e.g. the firm).
 *
 * Uses occurrence-COUNTING over the extracted entities (src/lib/entities.ts `droppedEntities`),
 * not a substring `.includes`: containment silently passes appended-digit tampering
 * ("041-560" ⊂ "041-5609", "$100" ⊂ "$1000") and a removed one-of-two duplicate. Counting the
 * `\b`-anchored extractions catches all three.
 */
export function checkEntityFidelity(
  before: string,
  after: string,
  extraNames?: readonly string[],
): EntityFidelity {
  const dropped = droppedEntities(before, after, extraNames);
  const droppedSet = new Set(dropped);
  const kept = protectedStrings(before, extraNames).filter((s) => !droppedSet.has(s));
  return { kept, dropped };
}
