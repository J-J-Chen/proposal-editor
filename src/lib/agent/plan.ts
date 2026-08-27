/**
 * The planning half of the agent.
 *
 * The agentic chat is two stages on purpose. This one PLANS: given the user's message and a
 * compact map of the document (block ids + types + short previews — never the full text, to keep
 * the prompt small and spend capped), it decides (a) a short conversational reply and (b) which
 * blocks to edit, with a single-block instruction for each. It writes NO document text itself —
 * every rewrite goes through the same guarded per-block editor as /api/edit (src/lib/edit.ts).
 *
 * Splitting plan from edit is what makes the over-edit guard real: the planner names a minimal,
 * relevant set of blocks (structured output, forced tool), and the editor then only ever touches
 * exactly those. A question ("what does this say about scheduling?") yields a reply and zero edits.
 */
import { AI_MODELS, getAnthropic } from '@/lib/ai';
import type { Block } from '@/lib/types';
import type { ChatTurn } from './contract';
import { LIMITS } from './limits';

/** How much of each block we show the planner. Enough to identify relevance, small enough to cap spend. */
const PREVIEW_CHARS = 180;

/** One planned unit of work: a block id and the single-block instruction to apply to it. */
export interface PlannedEdit {
  blockId: string;
  instruction: string;
}

export interface Plan {
  reply: string;
  summary?: string;
  edits: PlannedEdit[];
}

export const PLAN_TOOL = {
  name: 'submit_plan',
  description:
    'Return your conversational reply and the minimal set of per-block edits to propose. ' +
    'Do NOT rewrite any block text yourself — only name the block and the instruction.',
  input_schema: {
    type: 'object' as const,
    properties: {
      reply: {
        type: 'string',
        description:
          'A short, friendly reply to the user in plain language. If you are proposing edits, ' +
          'say what you are about to change and that they can review each one. If the user only ' +
          'asked a question, answer it here and propose no edits.',
      },
      summary: {
        type: 'string',
        description:
          'One short line summarizing the batch for the review header, e.g. ' +
          '"Tightening 6 paragraphs across the cover letter and approach." Omit if no edits.',
      },
      edits: {
        type: 'array',
        description:
          'The minimal set of blocks to edit. Include ONLY blocks the request clearly implies. ' +
          'Leave empty for a question or if nothing needs changing.',
        items: {
          type: 'object',
          properties: {
            blockId: { type: 'string', description: 'The id of a block from the document map.' },
            instruction: {
              type: 'string',
              description:
                'A single, self-contained instruction for THIS block only (e.g. "Make this more ' +
                'concise without dropping any facts"). The guarded editor applies it in isolation.',
            },
          },
          required: ['blockId', 'instruction'],
        },
      },
    },
    required: ['reply', 'edits'],
  },
};

export const PLAN_SYSTEM_PROMPT = `You are the planning half of an editing assistant for professional engineering and architecture proposals (statements of qualifications, cover letters, project descriptions). The user talks to you and can make sweeping requests that touch many parts of the document ("make the whole proposal more concise", "make the tone more confident", "fix any passive voice").

Your job is to PLAN, not to write. You will:
1. Reply to the user briefly and plainly.
2. Choose which blocks to edit and give each ONE short, self-contained instruction. A separate, guarded editor rewrites each block in isolation — you never write document text yourself.

Rules, in order of importance:
1. OVER-EDIT GUARD: touch only the blocks the request clearly implies. Do not edit blocks that are already fine, are off-topic, or are pure names/numbers/signatures/addresses. When a request is broad ("make it concise"), still skip blocks that are already tight or that are mostly protected data. Fewer, well-targeted edits beat rewriting everything.
2. Never invent facts, numbers, names, or claims. The editor preserves proper nouns, project/license numbers, dollar figures, and dates verbatim — write instructions that respect that (don't ask it to change a name or number unless the user explicitly asked to).
3. If the user only asks a question, answer it in "reply" and propose zero edits.
4. Keep each instruction specific to its block and consistent with the user's overall ask.

Headings, captions, and very short blocks are rarely worth editing unless the request is specifically about them. Return your plan by calling the submit_plan tool.`;

/** Compact, spend-bounded map of the document for the planner: id + type + a short preview. */
export function buildDocMap(blocks: Block[]): string {
  return blocks
    .map((b) => {
      const preview = b.text.length > PREVIEW_CHARS ? b.text.slice(0, PREVIEW_CHARS) + '…' : b.text;
      const kind = b.type === 'heading' ? `heading${b.level ? ` h${b.level}` : ''}` : b.type;
      // One line per block; newlines in the preview collapsed so the map stays scannable.
      return `[${b.id}] (${kind}) ${preview.replace(/\s+/g, ' ').trim()}`;
    })
    .join('\n');
}

function buildPlanUserMessage(
  message: string,
  blocks: Block[],
  selection?: string | null,
): string {
  const parts: string[] = [];
  if (selection) {
    const sel = blocks.find((b) => b.id === selection);
    if (sel) parts.push(`The user currently has this block selected: [${sel.id}].`);
  }
  parts.push('Document map (blockId, type, preview):', '"""', buildDocMap(blocks), '"""', '');
  parts.push(`User: ${message}`);
  return parts.join('\n');
}

/**
 * Prior turns as SDK messages. History is client-supplied and goes into the prompt, so bound it:
 * keep only the most recent `maxHistoryTurns`, and within those keep newest-first until
 * `maxHistoryChars` is reached. Trims rather than rejects — a long conversation stays usable.
 */
function historyMessages(history?: ChatTurn[]): { role: 'user' | 'assistant'; content: string }[] {
  if (!history?.length) return [];
  const recent = history.slice(-LIMITS.maxHistoryTurns);
  const out: { role: 'user' | 'assistant'; content: string }[] = [];
  let chars = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    const content = typeof recent[i]?.content === 'string' ? recent[i].content : '';
    if (!content) continue;
    chars += content.length;
    if (chars > LIMITS.maxHistoryChars && out.length > 0) break;
    out.unshift({ role: recent[i].role, content });
  }
  return out;
}

/** Ask the model for a plan. Throws if it doesn't return the forced tool (route surfaces a 502). */
export async function runPlan(
  message: string,
  blocks: Block[],
  opts: { history?: ChatTurn[]; selection?: string | null } = {},
): Promise<Plan> {
  const anthropic = getAnthropic();

  const res = await anthropic.messages.create({
    model: AI_MODELS.anthropicMain,
    max_tokens: 1024, // the plan is small: a reply + a list of ids/instructions
    temperature: 0.2,
    system: PLAN_SYSTEM_PROMPT,
    tools: [PLAN_TOOL],
    tool_choice: { type: 'tool', name: PLAN_TOOL.name },
    messages: [
      ...historyMessages(opts.history),
      { role: 'user', content: buildPlanUserMessage(message, blocks, opts.selection) },
    ],
  });

  const toolUse = res.content.find((b) => b.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('planner did not return a structured plan');
  }
  const input = toolUse.input as { reply?: unknown; summary?: unknown; edits?: unknown };

  const reply = typeof input.reply === 'string' ? input.reply.trim() : '';
  const summary = typeof input.summary === 'string' && input.summary.trim() ? input.summary.trim() : undefined;

  // Keep only well-formed edits that name a real block, de-duplicated (one edit per block),
  // and capped. This is the last line of the over-edit guard, enforced deterministically.
  const known = new Set(blocks.map((b) => b.id));
  const seen = new Set<string>();
  const edits: PlannedEdit[] = [];
  if (Array.isArray(input.edits)) {
    for (const raw of input.edits) {
      const e = raw as Partial<PlannedEdit>;
      if (typeof e?.blockId !== 'string' || typeof e?.instruction !== 'string') continue;
      const instruction = e.instruction.trim();
      if (!instruction || !known.has(e.blockId) || seen.has(e.blockId)) continue;
      seen.add(e.blockId);
      edits.push({ blockId: e.blockId, instruction });
      if (edits.length >= LIMITS.maxEditBlocks) break;
    }
  }

  return { reply: reply || 'Here’s what I found.', summary, edits };
}
