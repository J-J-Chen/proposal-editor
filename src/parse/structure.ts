// STRUCTURE — the single LLM pass. Groups the numbered lines into ordered blocks and assigns
// heading levels. It references LINE RANGES only and never emits text, so entity fidelity is
// guaranteed downstream by assemble.ts. On any failure it throws; the pipeline falls back to the
// deterministic heuristic grouping (never crashes).
//
// Structured output via TOOL USE (input_schema) — the reliable path through the Buoyant proxy
// (the SDK `messages.parse()` structured-output format is unverified there; tool-use is not).
import { z } from 'zod';
import { getAnthropic, AI_MODELS } from '@/lib/ai';
import type { AnnotatedLine, BlockRef } from './types';
import { toNumberedInput } from './heuristics';

const BLOCK_TYPES = ['heading', 'paragraph', 'list-item', 'caption', 'table', 'other'] as const;

const StructureZ = z.object({
  blocks: z
    .array(
      z.object({
        type: z.enum(BLOCK_TYPES),
        level: z.number().int().min(1).max(3).nullable(),
        startLine: z.number().int().min(0),
        endLine: z.number().int().min(0),
      }),
    )
    .min(1),
});

/** Model for the structuring pass. Mechanical (label-by-reference) → the main model is plenty;
 *  spend is not a constraint, so override up if it improves boundaries on a hard fixture. */
export const STRUCTURE_MODEL = process.env.ANTHROPIC_STRUCTURE_MODEL ?? AI_MODELS.anthropicMain;

const SYSTEM = [
  'You segment a PDF that has already been extracted into numbered text lines.',
  'Each input line is: "<idx> p<page> <B|.><C|.> x<left> <heuristic-label> | <verbatim text>".',
  'B=bold, C=ALL-CAPS. The heuristic-label is a guess you may correct.',
  '',
  'Return blocks as CONTIGUOUS, NON-OVERLAPPING ranges of line indices covering the lines in order.',
  'Rules:',
  '- Group wrapped body lines into one paragraph. Keep each real heading as its own block.',
  '- Headings are bold + ALL-CAPS + short (e.g. "OUR FIRM", "SERVICES"). Assign level 1..3',
  '  (section titles = 1). A bold but mixed-case line (a person name) is NOT a heading.',
  '- On brochure/infographic/cover pages, do NOT over-segment: label decorative stat blurbs and',
  '  scattered labels coarsely as "other" or "caption" rather than many tiny headings/list-items.',
  '- Org chart / staff listing: a person entry is a name line (e.g. "Scott Vogler, PE") followed by',
  '  a short title line (e.g. "President" / "Vice-President"). Emit EACH PERSON as its own list-item',
  '  (name + title together) — never merge several people, or a pile of titles, into one block.',
  '- Merge a split title (e.g. "Statement of" + "Qualifications") into one heading block.',
  '- Every input line index must appear in exactly one block. Never emit text — ranges only.',
].join('\n');

/** Run the LLM structuring pass. Returns line-range refs, or throws (→ heuristic fallback). */
export async function structure(lines: AnnotatedLine[]): Promise<BlockRef[]> {
  const numbered = toNumberedInput(lines);
  const anthropic = getAnthropic();

  const res = await anthropic.messages.create({
    model: STRUCTURE_MODEL,
    max_tokens: 8000,
    temperature: 0, // deterministic structuring → stable, reproducible seeds
    system: SYSTEM,
    tools: [
      {
        name: 'emit_blocks',
        description: 'Emit the ordered document blocks as line-index ranges.',
        input_schema: {
          type: 'object',
          properties: {
            blocks: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: BLOCK_TYPES as unknown as string[] },
                  level: { type: ['integer', 'null'], minimum: 1, maximum: 3 },
                  startLine: { type: 'integer', minimum: 0 },
                  endLine: { type: 'integer', minimum: 0 },
                },
                required: ['type', 'level', 'startLine', 'endLine'],
              },
            },
          },
          required: ['blocks'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'emit_blocks' },
    messages: [{ role: 'user', content: numbered }],
  });

  const toolUse = res.content.find((c) => c.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('structure: no tool_use block in response');
  }
  return StructureZ.parse(toolUse.input).blocks;
}
