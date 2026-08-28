/**
 * Offline audit for the fixed five-proposal KB.
 *
 * This script never generates or rewrites the committed corpus: the final selection remains a
 * human review decision. It re-extracts the five allowlisted PDFs with the app's MuPDF extractor
 * and proves that every committed citation occurs on its stated page.
 *
 * Usage:
 *   node --import ./scripts/_register.mjs scripts/build-kb.ts /path/to/ExampleProposals/kb
 *   KB_PROPOSALS_DIR=/path/to/ExampleProposals/kb node --import ./scripts/_register.mjs scripts/build-kb.ts
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  FIRM_PROJECTS,
  FIRM_STYLE_EXAMPLES,
  FIRM_VOICE,
  FIRM_VOICE_RULES,
  KB_SOURCE_DOCUMENTS,
  type KbProvenance,
} from '../src/kb/index';
import { extractLines } from '../src/parse/extract';

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Join visual line wrapping without changing the source's wording or punctuation. */
function normalizeExtractedText(text: string): string {
  return text
    .replace(/-\s*\n\s*(?=[a-z])/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

const sourceDirArg = process.argv[2] ?? process.env.KB_PROPOSALS_DIR;
invariant(
  sourceDirArg,
  'Pass the directory containing exactly the five KB PDFs, or set KB_PROPOSALS_DIR.',
);
const sourceDir = resolve(sourceDirArg);

const expectedFilenames = KB_SOURCE_DOCUMENTS.map((source) => source.filename).sort();
const actualPdfFilenames = readdirSync(sourceDir)
  .filter((filename) => filename.toLowerCase().endsWith('.pdf'))
  .sort();

invariant(
  JSON.stringify(actualPdfFilenames) === JSON.stringify(expectedFilenames),
  `Expected exactly the five allowlisted KB PDFs. Expected ${expectedFilenames.join(', ')}; found ${actualPdfFilenames.join(', ')}.`,
);

// Source descriptors are intentionally filename/title only. This prevents local paths, cache keys,
// or accidental fixture metadata from becoming deployed KB data.
for (const source of KB_SOURCE_DOCUMENTS) {
  invariant(
    Object.keys(source).sort().join(',') === 'filename,title',
    `${source.filename}: source descriptors may contain only filename and title.`,
  );
}

const committedData = JSON.stringify({
  sources: KB_SOURCE_DOCUMENTS,
  projects: FIRM_PROJECTS,
  voice: FIRM_VOICE,
});

for (const excludedFilename of ['easy.pdf', 'hard.pdf']) {
  invariant(
    !committedData.toLowerCase().includes(excludedFilename),
    `Excluded fixture ${excludedFilename} must not appear in committed KB data.`,
  );
}
invariant(
  !/\b[a-f\d]{64}\b/i.test(committedData),
  'No PDF hash (including a hash for an excluded fixture) may appear in committed KB data.',
);
invariant(
  !/\b001-\d{3,4}\b/.test(committedData),
  'Proposal-cover SOQ identifiers (001-…) must not be treated as project facts.',
);
invariant(
  !/(?:\/Users\/|\/home\/|[A-Za-z]:\\\\)/.test(committedData),
  'Committed KB data must not contain an absolute machine-local path.',
);

const sourceByFilename = new Map(
  KB_SOURCE_DOCUMENTS.map((source) => [source.filename, source] as const),
);
const pagesByFilename = new Map<string, Map<number, string>>();

for (const source of KB_SOURCE_DOCUMENTS) {
  const bytes = new Uint8Array(readFileSync(join(sourceDir, source.filename)));
  const lines = extractLines(bytes);
  const pages = new Map<number, string>();
  const pageCount = Math.max(...lines.map((line) => line.page));

  for (let page = 1; page <= pageCount; page++) {
    const text = lines
      .filter((line) => line.page === page)
      .map((line) => line.text.trimEnd())
      .join('\n');
    pages.set(page, normalizeExtractedText(text));
  }
  pagesByFilename.set(source.filename, pages);
  process.stdout.write(`extracted ${source.filename}: ${pageCount} pages\n`);
}

function validateProvenance(citation: KbProvenance, owner: string): void {
  const source = sourceByFilename.get(citation.sourceDoc);
  invariant(source, `${owner}: source ${citation.sourceDoc} is not one of the five allowlisted PDFs.`);
  invariant(
    citation.sourceTitle === source.title,
    `${owner}: source title does not match ${citation.sourceDoc}.`,
  );
  invariant(Number.isInteger(citation.page) && citation.page > 0, `${owner}: invalid page number.`);
  invariant(citation.quote.trim().length >= 12, `${owner}: citation quote is too short to audit.`);

  const pageText = pagesByFilename.get(citation.sourceDoc)?.get(citation.page);
  invariant(pageText, `${owner}: page ${citation.page} does not exist in ${citation.sourceDoc}.`);
  const normalizedQuote = normalizeExtractedText(citation.quote);
  invariant(
    pageText.includes(normalizedQuote),
    `${owner}: exact quote was not found on ${citation.sourceDoc} page ${citation.page}: ${JSON.stringify(normalizedQuote)}`,
  );
}

const projectIds = new Set<string>();
const projectSources = new Set<string>();
let projectCitationCount = 0;
for (const project of FIRM_PROJECTS) {
  invariant(!projectIds.has(project.id), `Duplicate project id: ${project.id}`);
  projectIds.add(project.id);
  invariant(project.title.trim(), `${project.id}: missing title.`);
  invariant(project.client.trim(), `${project.id}: missing client.`);
  invariant(project.summary.trim(), `${project.id}: missing summary.`);
  invariant(project.disciplines.length > 0, `${project.id}: missing disciplines.`);
  invariant(project.searchTerms.length > 0, `${project.id}: missing search terms.`);
  invariant(project.facts.length > 0, `${project.id}: missing grounded facts.`);
  invariant(project.provenance.length > 0, `${project.id}: missing provenance.`);

  const recordSources = new Set(project.provenance.map((citation) => citation.sourceDoc));
  invariant(recordSources.size === 1, `${project.id}: a project record must be bound to one source.`);
  for (const citation of project.provenance) {
    validateProvenance(citation, `project ${project.id}`);
    projectSources.add(citation.sourceDoc);
    projectCitationCount += 1;
  }
}

invariant(
  projectSources.size === KB_SOURCE_DOCUMENTS.length,
  'The curated project corpus must include unambiguous records from each of the five sources.',
);

const voiceSources = new Set<string>();
let voiceCitationCount = 0;
for (const rule of FIRM_VOICE_RULES) {
  invariant(rule.directive.trim(), `voice rule ${rule.id}: missing fact-free directive.`);
  invariant(rule.evidence.length > 0, `voice rule ${rule.id}: missing evidence.`);
  for (const citation of rule.evidence) {
    validateProvenance(citation, `voice rule ${rule.id}`);
    voiceSources.add(citation.sourceDoc);
    voiceCitationCount += 1;
  }
}
for (const example of FIRM_STYLE_EXAMPLES) {
  invariant(example.text.trim(), `style example ${example.id}: missing source text.`);
  invariant(example.delexicalized.trim(), `style example ${example.id}: missing safe form.`);
  for (const citation of example.evidence) {
    validateProvenance(citation, `style example ${example.id}`);
    voiceSources.add(citation.sourceDoc);
    voiceCitationCount += 1;
  }
}
invariant(
  voiceSources.size === KB_SOURCE_DOCUMENTS.length,
  'The voice profile must be evidenced by each of the five sources.',
);

const promptFacingVoice = JSON.stringify({
  register: FIRM_VOICE.register,
  exemplars: FIRM_VOICE.exemplars,
});
invariant(
  !/\b(?:MECO|Hannibal|Macon|Monroe|NEMO|Palmyra|Pittsfield|Hunnewell|Boonville)\b/i.test(
    promptFacingVoice,
  ),
  'Prompt-facing voice guidance must be delexicalized and contain no corpus entity names.',
);
invariant(
  !/(?:\$\s*\d|\b\d[\d,.]*\s*(?:MGD|GPM|LF|feet|mile|million)\b)/i.test(promptFacingVoice),
  'Prompt-facing voice guidance must not leak project quantities.',
);

process.stdout.write(
  `validated ${FIRM_PROJECTS.length} projects (${projectCitationCount} citations) and ` +
    `${FIRM_VOICE_RULES.length} voice rules/${FIRM_STYLE_EXAMPLES.length} style examples ` +
    `(${voiceCitationCount} evidence citations) across exactly five PDFs\n`,
);
