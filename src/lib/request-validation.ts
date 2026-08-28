/** Shared public-route input bounds. Keep model prompts and pre-prompt processing predictable. */
import type { Block, BlockType, Doc } from './types';

export const REQUEST_INPUT_LIMITS = {
  maxBlockIdChars: 256,
  maxBlockTextChars: 12_000,
  maxInstructionChars: 4_000,
  maxBlocks: 300,
  maxAggregateBlockChars: 500_000,
  maxFilenameChars: 500,
  maxDocIdChars: 256,
  maxHeadings: 120,
  maxHeadingChars: 500,
  maxHeadingCharsTotal: 4_000,
  maxFirmChars: 200,
  maxVoiceSamples: 8,
  maxVoiceSampleChars: 1_500,
  maxVoiceSampleCharsTotal: 8_000,
  maxDocTextChars: 50_000,
  maxSubmittedHistoryTurns: 100,
  maxSubmittedHistoryChars: 100_000,
  maxHistoryTurnChars: 8_000,
} as const;

const BLOCK_TYPES = new Set<BlockType>([
  'heading',
  'paragraph',
  'list-item',
  'caption',
  'table',
  'other',
]);

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function boundedString(value: unknown, max: number, requireNonBlank = false): value is string {
  return (
    typeof value === 'string' &&
    value.length <= max &&
    (!requireNonBlank || value.trim().length > 0)
  );
}

function optionalBoundedString(value: unknown, max: number): boolean {
  return value === undefined || boundedString(value, max);
}

export function validDocumentContext(value: unknown, required = false): boolean {
  if (value === undefined) return !required;
  if (!record(value) || !Array.isArray(value.headings)) return false;
  const headings = value.headings;
  if (
    headings.length > REQUEST_INPUT_LIMITS.maxHeadings ||
    !headings.every((heading) =>
      boundedString(heading, REQUEST_INPUT_LIMITS.maxHeadingChars),
    ) ||
    headings.reduce((total, heading) => total + (heading as string).length, 0) >
      REQUEST_INPUT_LIMITS.maxHeadingCharsTotal
  ) {
    return false;
  }
  if (!optionalBoundedString(value.firm, REQUEST_INPUT_LIMITS.maxFirmChars)) return false;
  if (!optionalBoundedString(value.docId, REQUEST_INPUT_LIMITS.maxDocIdChars)) return false;
  if (!optionalBoundedString(value.docText, REQUEST_INPUT_LIMITS.maxDocTextChars)) return false;

  if (value.voiceSamples !== undefined) {
    if (!Array.isArray(value.voiceSamples)) return false;
    const samples = value.voiceSamples;
    if (
      samples.length > REQUEST_INPUT_LIMITS.maxVoiceSamples ||
      !samples.every((sample) =>
        boundedString(sample, REQUEST_INPUT_LIMITS.maxVoiceSampleChars),
      ) ||
      samples.reduce((total, sample) => total + (sample as string).length, 0) >
        REQUEST_INPUT_LIMITS.maxVoiceSampleCharsTotal
    ) {
      return false;
    }
  }
  return true;
}

/** `/api/edit` and `/api/kb/compose` target shape (page is validated by compose separately). */
export function validEditBlock(value: unknown): value is {
  id: string;
  text: string;
  type: BlockType;
} {
  if (!record(value)) return false;
  return (
    boundedString(value.id, REQUEST_INPUT_LIMITS.maxBlockIdChars, true) &&
    boundedString(value.text, REQUEST_INPUT_LIMITS.maxBlockTextChars) &&
    typeof value.type === 'string' &&
    BLOCK_TYPES.has(value.type as BlockType)
  );
}

function validDocumentBlock(value: unknown): value is Block {
  if (!validEditBlock(value) || !record(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (!Number.isInteger(candidate.page) || (candidate.page as number) < 1) return false;
  if (
    candidate.level !== undefined &&
    (!Number.isInteger(candidate.level) ||
      (candidate.level as number) < 1 ||
      (candidate.level as number) > 3)
  ) {
    return false;
  }
  return true;
}

export function validDocumentBlocks(value: unknown): value is Block[] {
  if (!Array.isArray(value) || value.length > REQUEST_INPUT_LIMITS.maxBlocks) return false;
  let total = 0;
  const ids = new Set<string>();
  for (const block of value) {
    if (!validDocumentBlock(block) || ids.has(block.id)) return false;
    ids.add(block.id);
    total += block.text.length;
    if (total > REQUEST_INPUT_LIMITS.maxAggregateBlockChars) return false;
  }
  return true;
}

export function validSuggestionDoc(value: unknown): value is Doc {
  if (!record(value)) return false;
  return (
    boundedString(value.id, REQUEST_INPUT_LIMITS.maxDocIdChars, true) &&
    boundedString(value.filename, REQUEST_INPUT_LIMITS.maxFilenameChars, true) &&
    validDocumentBlocks(value.blocks)
  );
}

export function validChatHistory(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > REQUEST_INPUT_LIMITS.maxSubmittedHistoryTurns) {
    return false;
  }
  let total = 0;
  for (const turn of value) {
    if (
      !record(turn) ||
      (turn.role !== 'user' && turn.role !== 'assistant') ||
      !boundedString(turn.content, REQUEST_INPUT_LIMITS.maxHistoryTurnChars)
    ) {
      return false;
    }
    total += turn.content.length;
    if (total > REQUEST_INPUT_LIMITS.maxSubmittedHistoryChars) return false;
  }
  return true;
}
