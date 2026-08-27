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
import { protectedStrings } from '@/lib/entities';

export interface EntityFidelity {
  /** Protected entities from `before` that appear verbatim in `after`. */
  kept: string[];
  /** Protected entities from `before` that no longer appear verbatim in `after`. */
  dropped: string[];
}

/**
 * Check that every protected entity present in `before` survives verbatim in `after`.
 * `extraNames` extends the known-names list with doc-specific names (e.g. the firm).
 */
export function checkEntityFidelity(
  before: string,
  after: string,
  extraNames?: readonly string[],
): EntityFidelity {
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const ent of protectedStrings(before, extraNames)) {
    (after.includes(ent) ? kept : dropped).push(ent);
  }
  return { kept, dropped };
}
