/**
 * Deterministic retrieval over the fixed, reviewed five-proposal corpus.
 *
 * The corpus is deliberately small enough that an in-memory weighted keyword pass is easier to
 * inspect and safer to ship than embeddings or a database. Search only ranks approved project
 * records; it never reads uploaded documents or the raw source PDFs at runtime.
 */
import type { KbCandidate } from '@/lib/contracts';
import { FIRM_PROJECTS, type FirmProject } from './corpus';

const DEFAULT_K = 3;
const MAX_K = 5;

const STOP_WORDS = new Set([
  'a',
  'about',
  'an',
  'and',
  'any',
  'did',
  'do',
  'done',
  'experience',
  'for',
  'from',
  'have',
  'in',
  'like',
  'of',
  'on',
  'our',
  'past',
  'project',
  'projects',
  'similar',
  'some',
  'that',
  'the',
  'this',
  'to',
  'we',
  'with',
]);

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, '')
    .toLocaleLowerCase('en-US');
}

function stem(token: string): string {
  if (token.length > 6 && token.endsWith('ments')) return token.slice(0, -1);
  if (token.length > 5 && token.endsWith('ing')) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 4 && /(?:sses|shes|ches|xes|zes)$/.test(token)) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith('s')) return token.slice(0, -1);
  return token;
}

function tokens(value: string): string[] {
  return normalizeText(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
    .map(stem);
}

function tokenSet(value: string | readonly string[]): Set<string> {
  return new Set(tokens(Array.isArray(value) ? value.join(' ') : (value as string)));
}

function overlapScore(query: readonly string[], field: Set<string>, weight: number): number {
  let score = 0;
  for (const term of query) if (field.has(term)) score += weight;
  return score;
}

function scoreProject(project: FirmProject, query: string): number {
  const terms = [...new Set(tokens(query))];
  if (!terms.length) return 0;

  let score = 0;
  score += overlapScore(terms, tokenSet(project.title), 9);
  score += overlapScore(terms, tokenSet(project.disciplines), 7);
  score += overlapScore(terms, tokenSet(project.searchTerms), 6);
  score += overlapScore(terms, tokenSet([project.client, project.location]), 4);
  score += overlapScore(terms, tokenSet(project.summary), 3);
  score += overlapScore(terms, tokenSet(project.facts), 1);

  const phrase = normalizeText(query).trim();
  if (phrase.length > 3) {
    const title = normalizeText(project.title);
    const searchable = normalizeText(
      [project.title, ...project.disciplines, ...project.searchTerms].join(' '),
    );
    if (title.includes(phrase)) score += 20;
    else if (searchable.includes(phrase)) score += 10;
  }

  return score;
}

function matchesDiscipline(project: FirmProject, discipline?: string): boolean {
  if (!discipline?.trim()) return true;
  const wanted = tokenSet(discipline);
  if (!wanted.size) return true;
  const actual = tokenSet(project.disciplines);
  return [...wanted].every((term) => actual.has(term));
}

export function projectToCandidate(project: FirmProject, score: number): KbCandidate {
  const provenance = project.provenance[0];
  return {
    // This value is deliberately treated as an opaque handle by the browser. Compose resolves it
    // against FIRM_PROJECTS again; no browser-supplied fact text is trusted.
    candidateId: project.id,
    snippetId: project.id,
    title: project.title,
    text: project.summary,
    quote: provenance.quote,
    sourceDoc: provenance.sourceDoc,
    sourceTitle: provenance.sourceTitle,
    page: provenance.page,
    score,
    discipline: project.disciplines[0] ?? 'general',
  };
}

export interface SearchFirmProjectsOptions {
  discipline?: string;
  excludeSourceDoc?: string;
  k?: number;
}

/** Return only positive-overlap matches, with stable tie-breaking for repeatable demos/tests. */
export function searchFirmProjects(
  query: string,
  options: SearchFirmProjectsOptions = {},
): KbCandidate[] {
  const k = Math.max(1, Math.min(MAX_K, Math.floor(options.k ?? DEFAULT_K)));

  return FIRM_PROJECTS.filter(
    (project) =>
      matchesDiscipline(project, options.discipline) &&
      !project.provenance.some((p) => p.sourceDoc === options.excludeSourceDoc),
  )
    .map((project) => ({ project, score: scoreProject(project, query) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.project.title.localeCompare(b.project.title))
    .slice(0, k)
    .map(({ project, score }) => projectToCandidate(project, score));
}

/** Server-side resolution for compose. Callers never accept client-provided candidate facts. */
export function resolveFirmProject(candidateId: string): FirmProject | undefined {
  return FIRM_PROJECTS.find((project) => project.id === candidateId);
}

export const KB_SEARCH_LIMITS = {
  defaultK: DEFAULT_K,
  maxK: MAX_K,
  maxQueryChars: 240,
} as const;
