/**
 * Deterministic post-generation checks.
 *
 * Voice observations are advisory only. Fact/entity violations are a hard gate and are exported
 * for /api/edit, chat, and the KB composer to share without a runtime judge.
 */
import type { ResolvedVoiceGuidance } from '@/kb/voice-guidance';
import { entityCounts, extractEntities } from './entities';

export type VoiceAdvisory = 'added-exclamation' | 'added-hype' | 'first-person-drift';

const HYPE = /\b(?:best[- ]in[- ]class|game[- ]changing|revolutionary|unmatched|world[- ]class)\b/gi;
const FIRST_PERSON_SINGULAR = /\b(?:I|me|my|mine)\b/g;
const NUMBER_CORE = String.raw`(?:\d{1,4}(?:[/-]\d{1,4}){1,2}|\d[\d,]*(?:\.\d+)?|\.\d+)`;
const ENGINEERING_UNIT = String.raw`(?:%|percent|years?|months?|weeks?|days?|hours?|miles?|mi|mph|kph|inches?|in\.|[\"“”″]|feet|foot|ft\.?|['‘’′]|linear\s+feet|lf|yards?|yd|millimeters?|mm|centimeters?|cm|meters?|kilometers?|km|square\s+feet|sf|acres?|gallons?|barrels?|gpm|mgd|cfs|cfm|psi|psf|ksi|psia|psig|pa|kpa|mpa|bars?|degrees?\s*(?:celsius|fahrenheit|kelvin|[cfk])|°\s*[cfk]|volts?|kv|v|kilowatts?|kw|megawatts?|mw|kva|amps?|hertz|hz|khz|mhz|ghz|rpm|rph|btu|btuh|horsepower|hp|pounds?|lbs?|kilograms?|kg|tons?|poles?|wells?|pumps?|stations?|buildings?|bridges?|offices?|employees?|staff|(?:thousand|million|billion)(?:\s+dollars?)?)`;
const NUMERIC_FACT = new RegExp(
  String.raw`(?<![A-Za-z0-9])[-+]?\$?\s*[-+]?${NUMBER_CORE}(?:\s*[-–—]?\s*${ENGINEERING_UNIT})?(?![A-Za-z0-9])`,
  'gi',
);
const PROPER_SEQUENCE =
  /\b(?:[A-Z]{2,}|[A-Z][A-Za-z'’\-]+|[A-Z]\.)(?:\s+(?:(?:of|the|and|for|at|in|on)\s+)?(?:[A-Z]{2,}|[A-Z][A-Za-z'’\-]+|[A-Z]\.)){1,4}\b/g;
const NAMED_TOKEN = /\b(?:[A-Z]{2,}(?:\/[A-Z]{2,})?|[A-Z][a-z]+[A-Z][A-Za-z]*)\b/g;
const ALPHANUMERIC_TOKEN =
  /(?<![A-Za-z0-9.])[A-Za-z0-9]+(?:[-/][A-Za-z0-9]+)*(?:\(\d+\))?(?![A-Za-z0-9])/g;
const TECHNICAL_SHORT_TOKEN =
  /\b(?:Type|Class|Route|Option|Alternative|Building|Schedule|Phase|Section|Area|Zone|Unit|Package|Bid|Lot|Site|Plan)\s+(?:[\"'“‘])?[A-Z](?:[\"'”’])?(?=\b|\s|[,.;])|\b[A-Z]-[A-Za-z]{2,}\b|\b[A-Z]\/[A-Z]\b/g;
const CONTEXTUAL_SINGLE_NAME =
  /\b(?:client\s*(?:is|was|:)|for|in|at|serves?|serving|located\s+in)\s+((?:(?:St|Mt|Ft)\.\s+)?[A-Z][A-Za-z'’\-]{2,}(?:\s+(?:(?:of|the|and)\s+)?[A-Z][A-Za-z'’\-]{2,}){0,3})(?=\b|[,.;])/g;
const SENTENCE_SUBJECT_NAME =
  /(?:^|[.!?]\s+)([A-Z][A-Za-z'’\-]{2,})(?=\s+(?:(?:received|awarded|selected|retained|hired|contracted|requested|approved|funded|completed|constructed|built|owns?|operates?|manages?|serves?|has)\b|will\s+(?:receive|construct|build|own|operate|manage|serve)\b|(?:is|was)\s+(?:(?:the|a|an)\s+)?(?:project\s+)?(?:location|client|site|owner)\b))/g;
const NUMBER_WORD =
  String.raw`(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion)`;
const SPELLED_QUANTITY = new RegExp(
  String.raw`\b${NUMBER_WORD}(?:[-\s]+${NUMBER_WORD})*(?:[-\s]+(?:year|month|week|day|hour|mile|inch|foot|feet|yard|millimeter|centimeter|meter|kilometer|acre|gallon|barrel|pound|kilogram|ton|pole|well|pump|station|building|bridge|office|employee|engineer|lane|span|story|phase|wide|long|high|deep))s?\b`,
  'gi',
);

const GENERIC_TITLE_WORDS = new Set([
  'a',
  'an',
  'and',
  'approach',
  'benefits',
  'care',
  'clear',
  'client',
  'communication',
  'commitment',
  'construction',
  'consultant',
  'cost',
  'delivers',
  'design',
  'detail',
  'engineering',
  'experienced',
  'experience',
  'firm',
  'for',
  'key',
  'local',
  'management',
  'of',
  'our',
  'professional',
  'project',
  'proposal',
  'proven',
  'public',
  'quality',
  'qualifications',
  'relationships',
  'relevant',
  'responsive',
  'results',
  'schedule',
  'scope',
  'section',
  'services',
  'similar',
  'solutions',
  'standard',
  'strong',
  'sector',
  'team',
  'technical',
  'the',
  'this',
  'treatment',
  'water',
  'wastewater',
  'work',
  'your',
]);

function count(text: string, pattern: RegExp): number {
  pattern.lastIndex = 0;
  return [...text.matchAll(pattern)].length;
}

/** Flag obvious drift for observability; the user's requested edit is still returned for review. */
export function assessVoiceAdvisories(
  before: string,
  after: string,
  voice: ResolvedVoiceGuidance,
): VoiceAdvisory[] {
  const issues: VoiceAdvisory[] = [];
  if (count(after, /!/g) > count(before, /!/g)) issues.push('added-exclamation');
  if (count(after, HYPE) > count(before, HYPE)) issues.push('added-hype');
  if (
    voice.source === 'firm-kb' &&
    count(after, FIRST_PERSON_SINGULAR) > count(before, FIRST_PERSON_SINGULAR)
  ) {
    issues.push('first-person-drift');
  }
  return issues;
}

export type FactEntityViolationKind =
  | 'dropped-protected'
  | 'dropped-number'
  | 'dropped-proper-name'
  | 'introduced-protected'
  | 'introduced-number'
  | 'introduced-proper-name';

export interface FactEntityViolation {
  kind: FactEntityViolationKind;
  value: string;
}

export interface FactEntityGateInput {
  before: string;
  after: string;
  /** The actual user's instruction, not a model-authored per-block plan. */
  authoritativeInstruction: string;
  /** Server-resolved, explicitly selected facts. Voice samples must never be passed here. */
  authoritativeFacts?: readonly string[];
  /** Original document wording available only for an explicit restore/put-back instruction. */
  authoritativeReference?: string;
  extraNames?: readonly string[];
}

export interface FactEntityGateResult {
  ok: boolean;
  violations: FactEntityViolation[];
}

function valueCounts(values: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const value of values) out.set(value, (out.get(value) ?? 0) + 1);
  return out;
}

function regexValues(text: string, pattern: RegExp): string[] {
  pattern.lastIndex = 0;
  return [...text.matchAll(pattern)].map((match) => match[0].trim());
}

function numericFacts(text: string): string[] {
  return regexValues(text, NUMERIC_FACT);
}

function properNameCandidates(text: string): string[] {
  PROPER_SEQUENCE.lastIndex = 0;
  const out: string[] = [];
  for (const match of text.matchAll(PROPER_SEQUENCE)) {
    const candidate = match[0].trim();
    const words = candidate
      .replace(/[.,]/g, '')
      .split(/\s+/)
      .map((word) => word.toLocaleLowerCase('en-US'));
    if (words.every((word) => GENERIC_TITLE_WORDS.has(word))) continue;
    // Unfamiliar title-cased sequences are conservatively factual. This catches unknown people,
    // organizations, and places at sentence start too; the generic lexicon above prevents
    // ordinary proposal headings such as "Our Project Team" from being treated as entities.
    out.push(candidate);
  }
  return out;
}

function namedTokens(text: string): string[] {
  return regexValues(text, NAMED_TOKEN);
}

/** Embedded engineering identifiers such as BP1, BRO-B087(18), C94, and US54. */
function alphanumericFacts(text: string): string[] {
  return regexValues(text, ALPHANUMERIC_TOKEN).filter(
    (value) => /[A-Za-z]/.test(value) && /\d/.test(value),
  );
}

/** Short technical distinctions whose one-letter payload generic word tokenizers tend to lose. */
function technicalShortFacts(text: string): string[] {
  return regexValues(text, TECHNICAL_SHORT_TOKEN);
}

/** Single-token client/place names are protected only in an explicit proposal-fact context. */
function contextualSingleNames(text: string): string[] {
  CONTEXTUAL_SINGLE_NAME.lastIndex = 0;
  const out: string[] = [];
  for (const match of text.matchAll(CONTEXTUAL_SINGLE_NAME)) {
    const value = match[1];
    const words = value
      .replace(/[.'’\-]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word.toLocaleLowerCase('en-US'));
    if (!words.every((word) => GENERIC_TITLE_WORDS.has(word))) out.push(value);
  }
  SENTENCE_SUBJECT_NAME.lastIndex = 0;
  for (const match of text.matchAll(SENTENCE_SUBJECT_NAME)) {
    const value = match[1];
    if (!GENERIC_TITLE_WORDS.has(value.toLocaleLowerCase('en-US'))) out.push(value);
  }
  return out;
}

/** Spelled-out counts and dimensions are facts too (`two buildings`, `five-foot-wide`). */
function spelledQuantityFacts(text: string): string[] {
  return regexValues(text, SPELLED_QUANTITY);
}

function exactOccurrenceCount(text: string, value: string): number {
  const source = text.replace(/\s+/g, ' ').trim();
  const needle = value.replace(/\s+/g, ' ').trim();
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  while (from < source.length) {
    const index = source.indexOf(needle, from);
    if (index === -1) break;
    const before = index > 0 ? source[index - 1] : undefined;
    const afterIndex = index + needle.length;
    const after = afterIndex < source.length ? source[afterIndex] : undefined;
    if (
      (!isTokenChar(needle[0]) || !isTokenChar(before)) &&
      (!isTokenChar(needle[needle.length - 1]) || !isTokenChar(after))
    ) {
      count++;
    }
    from = index + Math.max(1, needle.length);
  }
  return count;
}

function contextualNameCounts(text: string, candidates: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    const occurrences = exactOccurrenceCount(text, candidate);
    if (occurrences > 0) counts.set(candidate, occurrences);
  }
  return counts;
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-US');
}

function isTokenChar(value: string | undefined): boolean {
  return Boolean(value && /[a-z0-9]/i.test(value));
}

/** Count exact, token-bounded occurrences; `24` must not match inside `2024`. */
function sourceOccurrenceCount(sources: readonly string[], value: string): number {
  const needle = normalize(value);
  if (!needle) return 0;
  let count = 0;
  for (const rawSource of sources) {
    const source = normalize(rawSource);
    let from = 0;
    while (from < source.length) {
      const index = source.indexOf(needle, from);
      if (index === -1) break;
      const before = index > 0 ? source[index - 1] : undefined;
      const afterIndex = index + needle.length;
      const after = afterIndex < source.length ? source[afterIndex] : undefined;
      const leftBounded = !isTokenChar(needle[0]) || !isTokenChar(before);
      const rightBounded =
        !isTokenChar(needle[needle.length - 1]) || !isTokenChar(after);
      if (leftBounded && rightBounded) count++;
      from = index + Math.max(1, needle.length);
    }
  }
  return count;
}

const NEGATED_INTENT =
  /\b(?:do\s+not|don['’]?t|did\s+not|didn['’]?t|would\s+not|wouldn['’]?t|(?:was|were)\s+not\s+ask(?:ed|ing)?|(?:wasn|weren)['’]?t\s+ask(?:ed|ing)?|(?:have|has)\s+not\s+ask(?:ed|ing)?|(?:haven|hasn)['’]?t\s+ask(?:ed|ing)?|does\s+not\s+mean|doesn['’]?t\s+mean|is\s+not\s+necessary|isn['’]?t\s+necessary|never|avoid|without|cannot|can[n'’]?t|must(?:\s+not|n['’]?t)|should(?:\s+not|n['’]?t)|may(?:\s+not|n['’]?t)|not\s+(?:to|allowed\s+to|authorized\s+to|permitted\s+to|supposed\s+to)|no\s+(?:need|reason)\s+to|declin(?:e|es|ed|ing)\s+to|forbidden\s+to|prohibited\s+(?:from|to))\b/i;
const DROP_INTENT = /\b(?:change|replace|remove|delete|omit|update|correct|fix)\b/i;
const DESTRUCTIVE_DROP_INTENT = /\b(?:remove|delete|omit)\b/i;
const ADD_INTENT =
  /\b(?:add|insert|include|state|say|write|change|replace|update|correct|set|make|become)\b|\b(?:should|must)\s+be\b/i;
const RETAIN_INTENT =
  /\b(?:keep(?:ing|s|t)?|preserv(?:e|es|ed|ing)|retain(?:s|ed|ing)?|remain(?:s|ed|ing)?|stay(?:s|ed|ing)?|leave|leaves|left|leaving)\b/i;
const META_REFERENCE_RELATION =
  /\b(?:sentence|wording|grammar|paragraph|description|text|passage|copy)\s+(?:about|around|containing|with|in|of)\s+(?:the\s+)?$/i;
const NEGATIVE_SUBJECT_RELATION =
  /\b(?:no|not|nothing(?:\s+(?:about|regarding|concerning))?|neither|nor|zero\s+(?:references?|mentions?)\s+to|rather\s+than|other\s+than|aside\s+from|apart\s+from|with\s+the\s+exception\s+of|instead\s+of|except(?:ing)?|excluding|without|besides|save)\b/i;
const DESTRUCTIVE_SUBJECT_RELATION =
  /\b(?:delete|exclude|omit|remove)(?:s|d|ing)?\b|\bleave\s+out\b/i;
const CASE_RESTYLE_SUBJECT =
  /\b(?:capitalization|casing|case|names?|spelling|acronyms?|titles?)\b/i;
const CASE_RESTYLE_INTENT =
  /\b(?:change|correct|fix|capitaliz(?:e|es|ed|ing)|uppercase|lowercase|standardize)\b/i;
const RESTORE_INTENT =
  /(?:\b(?:put|bring|add)\b[^.!?;]{0,48}\bback\b|\b(?:restore|reinstate|reintroduce)\b)/i;

function instructionClauses(instruction: string): string[] {
  return maskQuotedControlWords(normalize(instruction))
    // "anything but add X" is an exclusion relation, not a fresh positive clause. Convert only
    // these quantified forms; ordinary "do not remove X, but add Y" still splits at `but`.
    .replace(/\b(anything|everything|nothing|all)\s+but\b/gi, '$1 except')
    // A period followed by a digit belongs to a decimal/leading-decimal value, not a sentence.
    .split(/\.(?!\d)|[!?;\n]+|\bbut\b|,\s*(?:and\s+then|instead)\b/i)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function boundedValuePattern(value: string): RegExp {
  const token = normalize(value);
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `${isTokenChar(token[0]) ? '(?<![a-z0-9])' : ''}${escaped}${
      isTokenChar(token[token.length - 1]) ? '(?![a-z0-9])' : ''
    }`,
    'i',
  );
}

/** Natural-language aliases for compact PDF notation in an explicit human instruction. */
function instructionValueAliases(value: string): string[] {
  const normalizedValue = value.replace(/\s+/g, ' ').trim();
  const quantity = quantityParts(normalizedValue);
  if (quantity && /^[\"“”″]$/.test(quantity.unit)) {
    return [...new Set([
      normalizedValue,
      `${quantity.number}"`,
      `${quantity.number}”`,
      `${quantity.number}″`,
      `${quantity.number} inch`,
      `${quantity.number} inches`,
      `${quantity.number}-inch`,
      `${quantity.number}-inches`,
      `${quantity.number} in.`,
    ])];
  }
  if (quantity && /^['‘’′]$/.test(quantity.unit)) {
    return [...new Set([
      normalizedValue,
      `${quantity.number}'`,
      `${quantity.number}’`,
      `${quantity.number}′`,
      `${quantity.number} foot`,
      `${quantity.number} feet`,
      `${quantity.number}-foot`,
      `${quantity.number}-feet`,
      `${quantity.number} ft`,
      `${quantity.number} ft.`,
    ])];
  }
  const quotedType = normalizedValue.match(
    /^(Type|Class|Route|Option|Alternative|Building|Schedule|Phase|Section|Area|Zone|Unit|Package|Bid|Lot|Site|Plan)\s+[\"'“‘]?([A-Z])[\"'”’]?$/i,
  );
  if (quotedType) {
    const [, label, letter] = quotedType;
    return [
      `${label} ${letter}`,
      `${label} "${letter}"`,
      `${label} “${letter}”`,
      `${label} '${letter}'`,
      `${label} ‘${letter}’`,
    ];
  }
  return [normalizedValue];
}

function instructionValuePattern(value: string): RegExp {
  const alternatives = instructionValueAliases(value)
    .sort((left, right) => right.length - left.length)
    .map((alias) => boundedValuePattern(alias).source);
  return new RegExp(`(?:${alternatives.join('|')})`, 'i');
}

function instructionValueOccurrenceCount(text: string, value: string): number {
  const pattern = instructionValuePattern(value);
  return [...text.matchAll(new RegExp(pattern.source, 'gi'))].length;
}

function quotedRanges(value: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const quoted = /"[^"]*"|“[^”]*”|(?<![A-Za-z0-9])'[^']+'(?![A-Za-z0-9])|‘[^’]*’|(?<![A-Za-z0-9])`[^`]+`(?![A-Za-z0-9])/g;
  let match: RegExpExecArray | null;
  while ((match = quoted.exec(value))) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  return ranges;
}

/** Quoted reference text is data: keep its values visible, but mask words that look like intent. */
function maskQuotedControlWords(value: string): string {
  const ranges = quotedRanges(value);
  if (!ranges.length) return value;
  const chars = [...value];
  const control = new RegExp(
    [
      NEGATED_INTENT.source,
      DROP_INTENT.source,
      ADD_INTENT.source,
      RETAIN_INTENT.source,
      NEGATIVE_SUBJECT_RELATION.source,
      CASE_RESTYLE_INTENT.source,
    ]
      .map((source) => `(?:${source})`)
      .join('|'),
    'gi',
  );
  for (const { start, end } of ranges) {
    const quoted = value.slice(start, end);
    for (const match of quoted.matchAll(control)) {
      if (match.index === undefined) continue;
      const matchStart = start + match.index;
      for (let index = matchStart; index < matchStart + match[0].length; index++) {
        if (/[a-z]/i.test(chars[index])) chars[index] = ' ';
      }
    }
  }
  return chars.join('');
}

function positiveClauses(
  instruction: string,
  subject: RegExp,
  intent: RegExp,
): string[] {
  return instructionClauses(instruction).filter((clause) => {
    if (NEGATED_INTENT.test(clause)) return false;
    const clauseQuotedRanges = quotedRanges(clause);
    const subjectFlags = [...new Set(`${subject.flags.replace(/y/g, '')}g`)].join('');
    const subjectMatches = [...clause.matchAll(new RegExp(subject.source, subjectFlags))];

    return subjectMatches.some((subjectMatch) => {
      if (subjectMatch.index === undefined) return false;
      const subjectEnd = subjectMatch.index + subjectMatch[0].length;
      const enclosingQuote = clauseQuotedRanges.find(
        ({ start, end }) => subjectMatch.index > start && subjectEnd < end,
      );
      if (enclosingQuote) {
        const quotedSubject = clause.slice(enclosingQuote.start + 1, enclosingQuote.end - 1);
        // A value inside a quoted sentence is reference data even when a general mutation verb
        // precedes the quote ("Change the sentence 'Completed in 2024' for clarity"). A quote may
        // grant authority only when its complete content is the exact value being changed, as in
        // `Change "2024" to "2025"`.
        if (normalize(quotedSubject) !== normalize(subjectMatch[0])) return false;
      }
      const subjectSuffix = clause.slice(subjectEnd, subjectEnd + 72);
      if (
        /^\s*(?:,?\s*(?:which|and)\s+)?(?:(?:(?:should|must|shall|is|are|was|were)(?:\s+to)?\s+)?(?:remain|stay|be\s+(?:kept|preserved|retained))|(?:(?:should|must|shall|is|are|was|were)\s+)?(?:left\s+)?(?:unchanged|excluded|omitted|removed|deleted|preserved|retained|kept))\b/i.test(
          subjectSuffix,
        )
      ) {
        return false;
      }

      // Require a positive mutation verb to govern the subject, not merely coexist elsewhere in
      // the sentence ("change the tone and keep 2024" must not authorize changing 2024).
      const prefixStart = Math.max(0, subjectMatch.index - 96);
      const prefix = clause.slice(prefixStart, subjectMatch.index);
      const intentMatches = [
        ...prefix.matchAll(new RegExp(intent.source, intent.flags.includes('i') ? 'gi' : 'g')),
      ].filter((match) => {
        if (match.index === undefined) return true;
        const negatingPrefix = prefix.slice(Math.max(0, match.index - 20), match.index);
        if (
          /\b(?:no|without|except(?:ing)?|excluding|save|besides|rather\s+than|instead\s+of|other\s+than|aside\s+from|apart\s+from|with\s+the\s+exception\s+of)\s*$/i.test(
            negatingPrefix,
          ) ||
          /\bnot\s+(?:(?:allowed|permitted|supposed)\s+)?to\s*$/i.test(negatingPrefix)
        ) {
          return false;
        }
        return !clauseQuotedRanges.some(({ start, end }) => {
          const absoluteIndex = prefixStart + match.index!;
          return absoluteIndex >= start && absoluteIndex < end;
        });
      });
      const lastIntent = intentMatches[intentMatches.length - 1];
      if (lastIntent?.index !== undefined) {
        const afterIntent = prefix.slice(lastIntent.index + lastIntent[0].length);
        // The nearest mutation verb does not govern a value introduced by a contrast/exception
        // ("add 24, not 25" / "24 rather than 25") or a retention phrase
        // ("change the tone while preserving 2024").
        if (
          !RETAIN_INTENT.test(afterIntent) &&
          !NEGATIVE_SUBJECT_RELATION.test(afterIntent) &&
          !META_REFERENCE_RELATION.test(afterIntent) &&
          !(intent === ADD_INTENT && DESTRUCTIVE_SUBJECT_RELATION.test(afterIntent))
        ) {
          return true;
        }
      }

      // Also accept an explicit passive value assignment ("2025 should be the year"). Negated
      // forms were already excluded above.
      const suffix = clause.slice(subjectEnd, subjectMatch.index + 96);
      if (intent !== ADD_INTENT) return false;
      const passive = suffix.match(/\b(?:should|must)\s+be\s+([^,;.!?]{1,48})/i);
      if (!passive) return false;
      const complement = passive[1].trim();
      // Passive syntax is authority only when it assigns/includes the value, never when it says
      // the value should be excluded, omitted, removed, deleted, avoided, or merely preserved.
      return /^(?:(?:added|included|inserted|stated|used|written|set)\b|(?:the\s+)?(?:new|updated|correct|replacement)\b|the\s+(?:year|date|number|amount|quantity|value|cost|budget)\b)/i.test(
        complement,
      );
    });
  });
}

/** Prefix of the same instruction clause, mirroring `instructionClauses` delimiters. */
function containingClausePrefix(value: string, end: number): string {
  const prefix = value.slice(0, end);
  const separator = /\.(?!\d)|[!?;\n]+|\bbut\b|,\s*(?:and\s+then|instead)\b/gi;
  let start = 0;
  let match: RegExpExecArray | null;
  while ((match = separator.exec(prefix))) start = match.index + match[0].length;
  return prefix.slice(start);
}

function mutationAuthorizesDrop(instruction: string, value: string): boolean {
  const token = normalize(value);
  if (!normalize(instruction) || !token) return false;
  // A deterministic cleanup may quote one exact span to remove. Values inside that governed
  // quoted span are authorized even when the span is long; unrelated facts elsewhere in the
  // clause are not. This avoids weakening the general 96-character relation window.
  const normalizedInstruction = normalize(instruction);
  const quoted = /\b(?:remove|delete|omit)\b([^"“”]{0,80})["“]([^"”]+)["”]/gi;
  let quotedMatch: RegExpExecArray | null;
  while ((quotedMatch = quoted.exec(normalizedInstruction))) {
    const lead = maskQuotedControlWords(
      containingClausePrefix(normalizedInstruction, quotedMatch.index),
    );
    if (
      !NEGATED_INTENT.test(lead) &&
      !/\b(?:all|anything|everything|nothing)\s+(?:but|except)\s*$/i.test(lead) &&
      !/\b(?:all|anything|everything|nothing)\s+but\b/i.test(quotedMatch[1]) &&
      !NEGATIVE_SUBJECT_RELATION.test(quotedMatch[1]) &&
      !RETAIN_INTENT.test(quotedMatch[1]) &&
      sourceOccurrenceCount([quotedMatch[2]], value) > 0
    ) {
      return true;
    }
  }
  // The value must be close to an explicit mutation verb. Merely quoting the original (as the
  // follow-up editor does), saying "keep X", or saying "do not change X" does not authorize it.
  if (positiveClauses(instruction, instructionValuePattern(value), DROP_INTENT).length) return true;

  // If the instruction explicitly mentions this value but its relation was retaining/excluding,
  // that failed exact relation is decisive. Do not later reinterpret a broad "remove dates" or
  // "remove clients" phrase as permission to remove the named exception.
  if (instructionValueOccurrenceCount(instruction, token) > 0) return false;

  // A generic "change the year/number" can authorize a category only when the instruction does
  // not simultaneously name some other number. Thus "change the year to 2024" cannot silently
  // authorize dropping an unrelated quantity of 24; callers can name the old value explicitly.
  if (
    /\d/.test(token) &&
    numericFacts(instruction).length > 0 &&
    sourceOccurrenceCount([instruction], token) === 0
  ) {
    return false;
  }

  const entity = extractEntities(value)[0];
  const kindWords: Record<string, string> = {
    name: '(?:name|client|firm|agency|person)',
    license: '(?:licenses?|pe numbers?)',
    projectNo: '(?:project|contract) numbers?',
    money: '(?:amounts?|costs?|budgets?|dollar figures?)',
    phone: '(?:phone|telephone) numbers?',
  };
  const kind = entity ? kindWords[entity.kind] : '(?:number|date|year|quantity)';
  // A generic category may authorize deletion only with an explicit destructive verb. "Fix the
  // date" is not permission to erase it; "remove the date" is. Change/replace/fix still work when
  // the instruction names the exact old value through the path above.
  return (
    positiveClauses(
      instruction,
      new RegExp(`\\b${kind}\\b`, 'i'),
      DESTRUCTIVE_DROP_INTENT,
    ).length > 0
  );
}

function instructionAuthorizesAdditionCount(instruction: string, value: string): number {
  return positiveClauses(instruction, instructionValuePattern(value), ADD_INTENT).reduce(
    (total, clause) => total + instructionValueOccurrenceCount(clause, value),
    0,
  );
}

interface QuantityParts {
  number: string;
  unit: string;
  currency: boolean;
}

const QUANTITY_PARTS = new RegExp(
  String.raw`^([-+]?\$?\s*[-+]?${NUMBER_CORE})(?:\s*[-–—]?\s*(.*?))?$`,
  'i',
);

function quantityParts(value: string): QuantityParts | null {
  const match = normalize(value).match(QUANTITY_PARTS);
  if (!match) return null;
  return {
    number: match[1].replace(/\s+/g, '').replace(/,/g, ''),
    unit: (match[2] ?? '').replace(/[.\s]+/g, ' ').trim(),
    currency: match[1].includes('$'),
  };
}

type GateDetector =
  | 'protected'
  | 'number'
  | 'proper-name'
  | 'contextual-name'
  | 'named-token'
  | 'alphanumeric'
  | 'technical-short'
  | 'spelled-quantity';
type ReplacementCategory = 'money' | 'date' | 'number' | 'name' | 'license' | 'project' | 'phone';

const CATEGORY_REPLACE_INTENT = /\b(?:change|replace|update|correct|fix|set)\b/i;

function dateLikeQuantity(value: string): boolean {
  const quantity = quantityParts(value);
  if (!quantity || quantity.currency || quantity.unit) return false;
  return /^(?:\d{4}|\d{1,4}[/-]\d{1,4}(?:[/-]\d{1,4})?)$/.test(quantity.number);
}

function replacementCategory(
  detector: GateDetector,
  beforeValue: string,
  afterValue: string,
): ReplacementCategory | null {
  if (detector === 'number') {
    const before = quantityParts(beforeValue);
    const after = quantityParts(afterValue);
    if (!before || !after) return null;
    if (before.currency && after.currency) return 'money';
    if (dateLikeQuantity(beforeValue) && dateLikeQuantity(afterValue)) return 'date';
    if (!before.currency && !after.currency && !dateLikeQuantity(beforeValue) && !dateLikeQuantity(afterValue)) {
      return 'number';
    }
    return null;
  }
  if (
    detector === 'proper-name' ||
    detector === 'contextual-name' ||
    detector === 'named-token'
  ) {
    return 'name';
  }
  if (detector !== 'protected') return null;

  const beforeKind = extractEntities(beforeValue)[0]?.kind ?? 'name';
  const afterKind = extractEntities(afterValue)[0]?.kind ?? 'name';
  if (beforeKind !== afterKind) return null;
  switch (beforeKind) {
    case 'money':
      return 'money';
    case 'name':
      return 'name';
    case 'license':
      return 'license';
    case 'projectNo':
      return 'project';
    case 'phone':
      return 'phone';
  }
}

function categorySubject(category: ReplacementCategory): RegExp {
  switch (category) {
    case 'money':
      return /\b(?:amount|cost|budget|money|dollar\s+figure)\b/i;
    case 'date':
      return /\b(?:year|date)\b/i;
    case 'number':
      return /\b(?:number|quantity|count)\b/i;
    case 'name':
      return /\b(?:client(?:\s+name)?|firm(?:\s+name)?|agency(?:\s+name)?|person(?:\s+name)?|name|location|place)\b/i;
    case 'license':
      return /\b(?:license|pe)\s*(?:number)?\b/i;
    case 'project':
      return /\b(?:project|contract)\s+number\b/i;
    case 'phone':
      return /\b(?:phone|telephone)\s+number\b/i;
  }
}

function valueCategory(
  detector: GateDetector,
  value: string,
): ReplacementCategory | null {
  return replacementCategory(detector, value, value);
}

function changedValues(
  from: Map<string, number>,
  to: Map<string, number>,
): string[] {
  const out: string[] = [];
  for (const [value, countFrom] of from) {
    const delta = countFrom - (to.get(value) ?? 0);
    for (let index = 0; index < delta; index++) out.push(value);
  }
  return out;
}

/**
 * Permit the common shorthand "Change the year to 2024" without letting a category instruction
 * erase an arbitrary old fact. The pair must be one-for-one, the target must contain exactly one
 * value of that category, and the replacement value must be explicitly governed in the same ask.
 */
function unambiguousCategoryReplacement(
  instruction: string,
  beforeValues: Map<string, number>,
  afterValues: Map<string, number>,
  detector: GateDetector,
): { before: string; after: string } | null {
  const dropped = changedValues(beforeValues, afterValues);
  const introduced = changedValues(afterValues, beforeValues);
  if (dropped.length !== 1 || introduced.length !== 1) return null;

  const category = replacementCategory(detector, dropped[0], introduced[0]);
  if (!category) return null;
  const beforeCategoryCount = [...beforeValues].reduce(
    (total, [value, occurrences]) =>
      total + (valueCategory(detector, value) === category ? occurrences : 0),
    0,
  );
  const afterCategoryCount = [...afterValues].reduce(
    (total, [value, occurrences]) =>
      total + (valueCategory(detector, value) === category ? occurrences : 0),
    0,
  );
  if (beforeCategoryCount !== 1 || afterCategoryCount !== 1) return null;

  const categoryPattern = categorySubject(category);
  const introducedQuantity = quantityParts(introduced[0]);
  const introducedPattern = boundedValuePattern(
    introducedQuantity ? introducedQuantity.number : introduced[0],
  );
  const directAssignment = new RegExp(
    `${CATEGORY_REPLACE_INTENT.source}[^.!?;]{0,48}${categoryPattern.source}[^.!?;]{0,32}\\b(?:to|with|as)\\b[^.!?;]{0,32}${introducedPattern.source}`,
    'i',
  );
  const authorized = instructionClauses(instruction).some(
    (clause) =>
      !NEGATED_INTENT.test(clause) &&
      directAssignment.test(clause) &&
      positiveClauses(clause, categoryPattern, CATEGORY_REPLACE_INTENT).length > 0 &&
      positiveClauses(clause, introducedPattern, ADD_INTENT).length > 0,
  );
  return authorized ? { before: dropped[0], after: introduced[0] } : null;
}

function instructionAuthorizesQuantityChange(
  instruction: string,
  beforeValue: string,
  afterValue: string,
): boolean {
  const before = quantityParts(beforeValue);
  const after = quantityParts(afterValue);
  if (
    !before ||
    !after ||
    before.number === after.number ||
    before.unit !== after.unit ||
    before.currency !== after.currency
  ) {
    return false;
  }
  return (
    positiveClauses(instruction, boundedValuePattern(before.number), DROP_INTENT).length > 0 &&
    positiveClauses(instruction, boundedValuePattern(after.number), ADD_INTENT).length > 0
  );
}

function quantityChangeCredit(
  instruction: string,
  value: string,
  direction: 'dropped' | 'introduced',
  beforeValues: Map<string, number>,
  afterValues: Map<string, number>,
): number {
  if (direction === 'dropped') {
    return [...afterValues].reduce((total, [afterValue, countAfter]) => {
      const introduced = countAfter - (beforeValues.get(afterValue) ?? 0);
      return introduced > 0 && instructionAuthorizesQuantityChange(instruction, value, afterValue)
        ? total + introduced
        : total;
    }, 0);
  }
  return [...beforeValues].reduce((total, [beforeValue, countBefore]) => {
    const dropped = countBefore - (afterValues.get(beforeValue) ?? 0);
    return dropped > 0 && instructionAuthorizesQuantityChange(instruction, beforeValue, value)
      ? total + dropped
      : total;
  }, 0);
}

function instructionAuthorizesRestoreCount(
  instruction: string,
  reference: string | undefined,
  value: string,
): number {
  if (!reference) return 0;
  const relevantCategory = /\d/.test(value)
    ? /\b(?:(?:[a-z]+\s+)?count|number|date|year|quantity|amount|cost|budget|money|dollar|value|fact|license|project|contract)s?\b/i
    : /\b(?:name|client|firm|agency|person|place|location|entity|term|acronym|fact)s?\b/i;
  const authorized = instructionClauses(instruction).some((clause) => {
    if (NEGATED_INTENT.test(clause)) return false;
    RESTORE_INTENT.lastIndex = 0;
    const restore = RESTORE_INTENT.exec(clause);
    if (!restore || restore.index === undefined) return false;
    const prefix = clause.slice(Math.max(0, restore.index - 48), restore.index);
    if (
      NEGATIVE_SUBJECT_RELATION.test(prefix) ||
      /\bnot\s+(?:(?:allowed|permitted|supposed)\s+)?to\s*$/i.test(prefix)
    ) {
      return false;
    }
    const suffix = clause.slice(restore.index + restore[0].length);
    const exception = suffix.match(
      /\b(?:not|except(?:ing)?|excluding|other\s+than|aside\s+from|apart\s+from|with\s+the\s+exception\s+of|instead\s+of|without|besides|save)\b([\s\S]*)/i,
    );
    if (
      exception &&
      (sourceOccurrenceCount([exception[1]], value) > 0 || relevantCategory.test(exception[1]))
    ) {
      return false;
    }
    return relevantCategory.test(clause) || /\b(?:it|that|original|wording)\b/i.test(clause);
  });
  return authorized ? sourceOccurrenceCount([reference], value) : 0;
}

function caseVariantOccurrenceCount(before: string, value: string): number {
  const source = before.replace(/\s+/g, ' ').trim();
  const needle = value.replace(/\s+/g, ' ').trim();
  if (!needle) return 0;
  const sourceFolded = source.toLocaleLowerCase('en-US');
  const needleFolded = needle.toLocaleLowerCase('en-US');
  let variants = 0;
  let from = 0;
  while (from < source.length) {
    const index = sourceFolded.indexOf(needleFolded, from);
    if (index === -1) break;
    const beforeChar = index > 0 ? source[index - 1] : undefined;
    const afterIndex = index + needle.length;
    const afterChar = afterIndex < source.length ? source[afterIndex] : undefined;
    const bounded =
      (!isTokenChar(needle[0]) || !isTokenChar(beforeChar)) &&
      (!isTokenChar(needle[needle.length - 1]) || !isTokenChar(afterChar));
    if (bounded && source.slice(index, afterIndex) !== needle) variants++;
    from = index + Math.max(1, needle.length);
  }
  return variants;
}

/**
 * Permit only a character-for-character value whose casing changed, and only for an affirmative
 * casing/name/spelling instruction. This lets `scott vogler, pe` become `Scott Vogler, PE`
 * without giving a generic "fix names" action authority to substitute a different person.
 */
function instructionAuthorizesCaseRestyleCount(
  instruction: string,
  before: string,
  after: string,
  value: string,
  direction: 'dropped' | 'introduced',
): number {
  const affirmative = positiveClauses(
    instruction,
    CASE_RESTYLE_SUBJECT,
    CASE_RESTYLE_INTENT,
  ).length;
  if (!affirmative) return 0;
  const beforeVariants = caseVariantOccurrenceCount(before, value);
  const afterVariants = caseVariantOccurrenceCount(after, value);
  // Restyling conserves the case-folded occurrence count. Credit a dropped spelling only for a
  // newly added opposite-case variant, and an introduced spelling only for an opposite-case
  // variant that actually disappeared. A surviving lowercase original cannot authorize a copy.
  return direction === 'dropped'
    ? Math.max(0, afterVariants - beforeVariants)
    : Math.max(0, beforeVariants - afterVariants);
}

function addDeltaViolations(
  out: FactEntityViolation[],
  beforeValues: Map<string, number>,
  afterValues: Map<string, number>,
  droppedKind: FactEntityViolationKind,
  introducedKind: FactEntityViolationKind,
  instruction: string,
  authoritativeFacts: readonly string[],
  beforeText: string,
  afterText: string,
  authoritativeReference: string | undefined,
  detector: GateDetector,
): void {
  const categoryReplacement = unambiguousCategoryReplacement(
    instruction,
    beforeValues,
    afterValues,
    detector,
  );
  for (const [value, countBefore] of beforeValues) {
    const droppedCount = countBefore - (afterValues.get(value) ?? 0);
    const caseRestyledCount = instructionAuthorizesCaseRestyleCount(
      instruction,
      beforeText,
      afterText,
      value,
      'dropped',
    );
    const quantityChangedCount = quantityChangeCredit(
      instruction,
      value,
      'dropped',
      beforeValues,
      afterValues,
    );
    const categoryChangedCount =
      categoryReplacement && normalize(categoryReplacement.before) === normalize(value) ? 1 : 0;
    if (
      droppedCount > caseRestyledCount + quantityChangedCount + categoryChangedCount &&
      !mutationAuthorizesDrop(instruction, value)
    ) {
      out.push({ kind: droppedKind, value });
    }
  }
  for (const [value, countAfter] of afterValues) {
    const introducedCount = countAfter - (beforeValues.get(value) ?? 0);
    const explicitlyRestyledCount = [...beforeValues].reduce((total, [beforeValue, countBefore]) => {
      const actuallyDropped = countBefore - (afterValues.get(beforeValue) ?? 0);
      return normalize(beforeValue) === normalize(value) &&
        beforeValue !== value &&
        actuallyDropped > 0 &&
        mutationAuthorizesDrop(instruction, beforeValue)
        ? total + actuallyDropped
        : total;
    }, 0);
    const authorizedCount =
      sourceOccurrenceCount(authoritativeFacts, value) +
      instructionAuthorizesAdditionCount(instruction, value) +
      explicitlyRestyledCount +
      quantityChangeCredit(
        instruction,
        value,
        'introduced',
        beforeValues,
        afterValues,
      ) +
      instructionAuthorizesRestoreCount(
        instruction,
        authoritativeReference,
        value,
      ) +
      (categoryReplacement && normalize(categoryReplacement.after) === normalize(value) ? 1 : 0) +
      instructionAuthorizesCaseRestyleCount(
        instruction,
        beforeText,
        afterText,
        value,
        'introduced',
      );
    if (
      introducedCount > 0 &&
      authorizedCount < introducedCount
    ) {
      out.push({ kind: introducedKind, value });
    }
  }
}

/**
 * Hard deterministic boundary for factual tokens. It catches occurrence-counted protected
 * entities, every digit-bearing value/date/quantity, and likely multi-word proper names. It does
 * not pretend to prove qualitative entailment; selected-fact composition adds a stricter anchor
 * check on top of this helper.
 */
export function checkFactEntityGate(input: FactEntityGateInput): FactEntityGateResult {
  const violations: FactEntityViolation[] = [];
  const authoritativeFacts = input.authoritativeFacts ?? [];
  // Once either side identifies a title-cased token as a labeled client/place, count that same
  // exact token across both complete texts. Moving an unchanged name into a clearer labeled
  // construction must not look like a factual introduction (or the reverse like a drop).
  const contextualNameCandidates = [
    ...new Set([
      ...contextualSingleNames(input.before),
      ...contextualSingleNames(input.after),
    ]),
  ];

  addDeltaViolations(
    violations,
    entityCounts(input.before, input.extraNames),
    entityCounts(input.after, input.extraNames),
    'dropped-protected',
    'introduced-protected',
    input.authoritativeInstruction,
    authoritativeFacts,
    input.before,
    input.after,
    input.authoritativeReference,
    'protected',
  );
  addDeltaViolations(
    violations,
    valueCounts(numericFacts(input.before)),
    valueCounts(numericFacts(input.after)),
    'dropped-number',
    'introduced-number',
    input.authoritativeInstruction,
    authoritativeFacts,
    input.before,
    input.after,
    input.authoritativeReference,
    'number',
  );

  addDeltaViolations(
    violations,
    valueCounts(properNameCandidates(input.before)),
    valueCounts(properNameCandidates(input.after)),
    'dropped-proper-name',
    'introduced-proper-name',
    input.authoritativeInstruction,
    authoritativeFacts,
    input.before,
    input.after,
    input.authoritativeReference,
    'proper-name',
  );

  addDeltaViolations(
    violations,
    valueCounts(namedTokens(input.before)),
    valueCounts(namedTokens(input.after)),
    'dropped-proper-name',
    'introduced-proper-name',
    input.authoritativeInstruction,
    authoritativeFacts,
    input.before,
    input.after,
    input.authoritativeReference,
    'named-token',
  );

  addDeltaViolations(
    violations,
    contextualNameCounts(input.before, contextualNameCandidates),
    contextualNameCounts(input.after, contextualNameCandidates),
    'dropped-proper-name',
    'introduced-proper-name',
    input.authoritativeInstruction,
    authoritativeFacts,
    input.before,
    input.after,
    input.authoritativeReference,
    'contextual-name',
  );

  addDeltaViolations(
    violations,
    valueCounts(alphanumericFacts(input.before)),
    valueCounts(alphanumericFacts(input.after)),
    'dropped-protected',
    'introduced-protected',
    input.authoritativeInstruction,
    authoritativeFacts,
    input.before,
    input.after,
    input.authoritativeReference,
    'alphanumeric',
  );

  addDeltaViolations(
    violations,
    valueCounts(technicalShortFacts(input.before)),
    valueCounts(technicalShortFacts(input.after)),
    'dropped-protected',
    'introduced-protected',
    input.authoritativeInstruction,
    authoritativeFacts,
    input.before,
    input.after,
    input.authoritativeReference,
    'technical-short',
  );

  addDeltaViolations(
    violations,
    valueCounts(spelledQuantityFacts(input.before)),
    valueCounts(spelledQuantityFacts(input.after)),
    'dropped-number',
    'introduced-number',
    input.authoritativeInstruction,
    authoritativeFacts,
    input.before,
    input.after,
    input.authoritativeReference,
    'spelled-quantity',
  );

  // A value can match more than one detector (e.g. a project number). Report it once per
  // direction, preferring the more specific protected-entity classification.
  const seenDirectionValue = new Set<string>();
  const deduped = violations.filter((violation) => {
    const direction = violation.kind.startsWith('dropped') ? 'dropped' : 'introduced';
    const key = `${direction}:${normalize(violation.value)}`;
    if (seenDirectionValue.has(key)) return false;
    seenDirectionValue.add(key);
    return true;
  });
  return { ok: deduped.length === 0, violations: deduped };
}
