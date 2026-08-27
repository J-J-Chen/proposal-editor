/**
 * The edit service — the AI half of the edit loop (Track C).
 *
 * Takes one block + an instruction and returns the rewritten text via the Buoyant proxy.
 * Server-only (imports the proxy client, which reads the secret token). The route handler
 * (`app/api/edit`) is a thin wrapper around `runEdit`; the prompt-building and output-parsing
 * live here so they stay isolated and independently testable.
 *
 * Two design commitments, both from docs/architecture.md ("The edit loop"):
 *  - **Entity guardrail:** the system prompt forbids touching any proper noun, project number,
 *    or dollar/date figure unless the instruction explicitly says to. This is the #1 silent
 *    failure in proposals and is exactly what the CP5 eval measures.
 *  - **Structured output (no preamble):** we force a tool call, so the model returns
 *    `{ newText, rationale }` as data — never prose with the edit buried inside. This kills the
 *    "Sure, here's your revised paragraph:" leak that would otherwise land in the document.
 *
 * Non-streaming by design: Apply is all-or-nothing and the diff needs the whole rewrite to be
 * meaningful, so there's no UX win from streaming tokens here (see decisions.md).
 */
import { AI_MODELS, getAnthropic } from './ai';
import type { EditRequest, EditResponse } from './contracts';

/** Structured-output schema. Forcing this tool guarantees clean data back, no preamble. */
export const EDIT_TOOL = {
  name: 'submit_edit',
  description: 'Return the rewritten block text to replace the original.',
  input_schema: {
    type: 'object' as const,
    properties: {
      newText: {
        type: 'string',
        description:
          'The FULL rewritten block, ready to drop in verbatim. Not a diff, not a fragment, ' +
          'no surrounding quotes or markdown.',
      },
      rationale: {
        type: 'string',
        description: 'One short sentence: what you changed and why. Omit if nothing changed.',
      },
    },
    required: ['newText'],
  },
};

export const EDIT_SYSTEM_PROMPT = `You are an expert editor of professional engineering and architecture proposals — statements of qualifications, cover letters, project descriptions. You rewrite ONE block of a document in place.

Rules, in order of importance:
1. PRESERVE VERBATIM every proper noun, every person / firm / agency / place name, every project or contract number, and every dollar amount, date, and quantity — UNLESS the instruction explicitly tells you to change that specific value. Silently altering a name or a number is a critical failure; when in doubt, keep it exactly as written.
2. Do exactly what the instruction asks and nothing more. If it says shorten, only shorten; if it says fix tone, change only tone. Never volunteer unrequested edits.
3. Keep the author's voice, tense, and point of view, in the formal register of a proposal.
4. Return the FULL rewritten block, ready to drop in — not a diff, not a fragment, no surrounding quotes, labels, or markdown.
5. If the instruction does not apply to this block, return the block unchanged.

Return your result by calling the submit_edit tool.`;

/** Build the user message: the instruction, light document context, then the block itself. */
export function buildEditUserMessage(req: EditRequest): string {
  const parts: string[] = [`Block type: ${req.block.type}`, `Instruction: ${req.instruction}`];

  const ctx = req.docContext;
  if (ctx && (ctx.firm || (ctx.headings && ctx.headings.length))) {
    const lines: string[] = ['', 'Document context (for voice and consistency only):'];
    if (ctx.firm) lines.push(`- Firm: ${ctx.firm}`);
    if (ctx.headings && ctx.headings.length) lines.push(`- Section: ${ctx.headings.join(' › ')}`);
    parts.push(lines.join('\n'));
  }

  if (req.kbContext && req.kbContext.length) {
    parts.push(
      ['', 'Relevant past work (facts you may draw on; do not invent beyond these):']
        .concat(req.kbContext.map((s) => `- ${s}`))
        .join('\n'),
    );
  }

  parts.push(['', 'Block to rewrite:', '"""', req.block.text, '"""'].join('\n'));
  return parts.join('\n');
}

/** Roomy but bounded token budget, scaled to the block so a long paragraph isn't truncated. */
function maxTokensFor(text: string): number {
  const approx = Math.ceil(text.length / 3); // ~3 chars/token, rough
  return Math.min(4096, Math.max(512, approx * 2));
}

/**
 * Run one edit through the proxy. Throws on a missing/empty model result so the route can
 * surface a 502; the caller is responsible for the not-configured (503) check.
 */
export async function runEdit(req: EditRequest): Promise<EditResponse> {
  const anthropic = getAnthropic();

  const res = await anthropic.messages.create({
    model: AI_MODELS.anthropicMain,
    max_tokens: maxTokensFor(req.block.text),
    temperature: 0.2, // low, for fidelity — this is editing, not brainstorming
    system: EDIT_SYSTEM_PROMPT,
    tools: [EDIT_TOOL],
    tool_choice: { type: 'tool', name: EDIT_TOOL.name },
    messages: [{ role: 'user', content: buildEditUserMessage(req) }],
  });

  const toolUse = res.content.find((b) => b.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('model did not return a structured edit');
  }

  const input = toolUse.input as { newText?: unknown; rationale?: unknown };
  const newText = typeof input.newText === 'string' ? input.newText.trim() : '';
  if (!newText) throw new Error('model returned an empty edit');

  const rationale = typeof input.rationale === 'string' ? input.rationale.trim() : undefined;
  return rationale ? { newText, rationale } : { newText };
}
