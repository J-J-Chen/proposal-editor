/**
 * Hard limits for /api/chat — the abuse/spend backstop.
 *
 * /api/chat is a PUBLIC, unauthenticated endpoint, and one request fans out to multiple model
 * calls (a planner + one guarded edit per targeted block + an optional repair each). Without a
 * ceiling that is a spend-amplification vector. These caps bound BOTH the input size and the total
 * number of model calls a single request can ever cause. `maxModelCalls` is the true guarantee:
 * whatever the planner returns, one /api/chat request makes at most `maxModelCalls` model calls.
 *
 * Kept in one place so the route (input validation) and the agent (fan-out budget) agree.
 */
export const LIMITS = {
  // ── Input bounds (enforced in the route; reject with 400) ──
  /** Max characters in the user's message. A chat turn, not a document paste. */
  maxMessageChars: 4_000,
  /** Max blocks accepted in one request (easy.pdf is ~76; this is generous but bounds the map). */
  maxBlocks: 300,
  /** Max prior turns considered (older turns are dropped, newest kept). */
  maxHistoryTurns: 20,
  /** Max total characters across all history turns (bounds the planner prompt). */
  maxHistoryChars: 8_000,

  // ── Fan-out bounds (enforced in the agent) ──
  /** Max blocks the agent will propose edits for in one turn (also caps human review load). */
  maxEditBlocks: 8,
  /**
   * HARD ceiling on TOTAL model calls per /api/chat request — planner + every block edit + every
   * repair retry, all counted against this one budget. Was ~33 worst-case (1 + 16 + 16); now 12.
   */
  maxModelCalls: 12,
} as const;

/**
 * A synchronous, single-request call budget. JS is single-threaded, so `take()` (check-and-spend
 * before an await) is race-free across the concurrent edit pool. `take()` returns false once the
 * ceiling is hit, and the caller must then skip the call rather than make it.
 */
export interface CallBudget {
  take(): boolean;
  spent(): number;
  remaining(): number;
}

export function makeCallBudget(max: number): CallBudget {
  let used = 0;
  return {
    take() {
      if (used >= max) return false;
      used++;
      return true;
    },
    spent: () => used,
    remaining: () => Math.max(0, max - used),
  };
}
