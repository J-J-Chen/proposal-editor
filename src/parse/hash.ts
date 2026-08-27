// Content hash — the cache key and the Doc.id. Isolated (no seed-barrel import) so offline
// scripts can hash + parse without pulling the generated L0 barrel into their module graph.
import { createHash } from 'node:crypto';

/** sha256 of the raw file bytes, hex-encoded. */
export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
