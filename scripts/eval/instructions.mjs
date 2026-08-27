// instructions.mjs — the preservation instruction grid the eval runs over every entity-bearing
// block. See plans/checkpoint-5-eval-readme.md ("Dataset").
//
// PRESERVATION SET only: every instruction here is one where the entities MUST survive. We
// deliberately EXCLUDE entity-changing instructions ("fix names", "the client is wrong") — those
// are SUPPOSED to change an entity, so scoring them as violations is eval failure-mode #1.
//
// Stress-weighting: "change tone" and "rewrite in our voice" are wholesale regeneration — that is
// where entity swaps and hallucinations actually happen — so they get MULTIPLE phrasings and thus
// more weight in the denominator. "tighten" is mostly deletion and reads artificially clean, so it
// gets one. Each phrasing is a real trial against the shipped route.

export const INSTRUCTIONS = [
  {
    id: 'tighten',
    hard: false,
    expectShorter: true, // effectiveness signal: a real tighten should not grow the text
    phrasings: ['Tighten this — make it more concise without losing any meaning.'],
  },
  {
    id: 'make-formal',
    hard: false,
    phrasings: ['Make this more formal and polished.'],
  },
  {
    id: 'fix-grammar',
    hard: false,
    phrasings: ['Fix any grammar, spelling, and punctuation issues; change nothing else.'],
  },
  {
    id: 'change-tone',
    hard: true, // wholesale regeneration — over-sampled
    phrasings: [
      'Make the tone warmer and more personable.',
      'Make this sound more confident and authoritative.',
      'Soften the tone to be more approachable and less stiff.',
    ],
  },
  {
    id: 'rewrite-voice',
    hard: true, // wholesale regeneration — over-sampled
    phrasings: [
      "Rewrite this in our firm's polished, client-facing proposal voice.",
      'Rewrite this from scratch to be more compelling to the selection committee.',
      'Rephrase this completely in a modern, active voice.',
    ],
  },
];

// Documented but NOT run — kept so a reader sees exactly what was excluded and why.
export const EXCLUDED_ENTITY_CHANGING = [
  'Fix the names in this block.',
  'The client name is wrong — correct it.',
  'Update the project number to the new one.',
];

/** Flatten the grid into concrete trials for a set of blocks. */
export function buildTrials(blocks) {
  const trials = [];
  for (const block of blocks) {
    for (const instr of INSTRUCTIONS) {
      instr.phrasings.forEach((phrasing, i) => {
        trials.push({
          blockId: block.id,
          instructionId: instr.id,
          variant: i, // which phrasing (for over-sampled instructions)
          hard: instr.hard,
          expectShorter: !!instr.expectShorter,
          instruction: phrasing,
          block,
        });
      });
    }
  }
  return trials;
}
