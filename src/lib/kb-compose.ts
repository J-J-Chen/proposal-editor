/**
 * Candidate-first KB composition.
 *
 * A browser may choose a candidate id, but it never supplies facts. This module resolves the
 * reviewed record server-side, builds a deterministic factual floor, then (when configured) asks
 * the ordinary guarded edit path to shape that floor into proposal prose. Any error or fidelity
 * miss returns the factual floor instead of retrying or inventing.
 */
import type { KbComposeRequest, KbComposeResponse } from './contracts';
import type { FirmProject } from '@/kb/corpus';
import { isAiConfigured } from './ai';
import { runEdit } from './edit';
import { checkFactEntityGate } from './voice-gate';
import { projectToCandidate, resolveFirmProject } from '@/kb/retrieval';

const COVERAGE_STOP = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'is',
  'lists',
  'of',
  'on',
  'proposal',
  'describes',
  'source',
  'states',
  'the',
  'to',
  'was',
  'were',
  'with',
]);

const COMPOSE_INSTRUCTION =
  'Shape this reviewed factual draft into one concise, proposal-ready representative-project paragraph. Preserve the exact project title, client, location, every proper noun, every number, and every scope fact. Add no fact, superlative, outcome, credential, or implication. Do not mention the source proposal or page.';

const CONTRADICTORY_PREDICATE =
  /\b(?:no|not|never|without|except(?:ing)?|exception|save|cannot|can['’]?t|didn['’]?t|doesn['’]?t|isn['’]?t|wasn['’]?t|exclude(?:s|d|ing)?|omit(?:s|ted|ting)?|lack(?:s|ed|ing)?|remove(?:s|d|ing)?)\b|\b(?:other|rather)\s+than\b|\baside\s+from\b|\b(?:all|everything|anything)\s+but\b/gi;

function contradictoryPredicateCount(value: string): number {
  CONTRADICTORY_PREDICATE.lastIndex = 0;
  return [...value.matchAll(CONTRADICTORY_PREDICATE)].length;
}

function words(value: string): Set<string> {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US');
  const out = new Set(
    normalized
      .split(/[^a-z0-9$]+/)
      .filter((word) => word.length > 2 && !COVERAGE_STOP.has(word)),
  );

  // One-letter technical distinctions are factual even though ordinary stop-word tokenization
  // would discard them: Type A is not Type B, H-piling is not P-piling, and A/E is not M/E.
  for (const match of normalized.matchAll(
    /\b(?:type|class|route|option|alternative|building|schedule|phase|section|area|zone|unit|package|bid|lot|site|plan)\s+[a-z]\b/g,
  )) {
    out.add(match[0].replace(/\s+/, ':'));
  }
  for (const match of normalized.matchAll(/\b[a-z]-[a-z]{2,}\b/g)) out.add(match[0]);
  for (const match of normalized.matchAll(/\b[a-z]\/[a-z]\b/g)) out.add(match[0]);
  return out;
}

/** A safe, deterministic paragraph that contains only reviewed fields and claims. */
export function buildKbTemplate(project: FirmProject): string {
  return [
    `MECO’s relevant experience includes ${project.title} for ${project.client} in ${project.location}.`,
    ...project.facts,
  ].join(' ');
}

/**
 * The edit service's fact gate handles names/numbers. This additional project-coverage check keeps
 * an otherwise entity-perfect rewrite from silently omitting an entire selected scope claim.
 */
export function coversSelectedProject(project: FirmProject, output: string): boolean {
  const outputWords = words(output);
  if (!outputWords.size) return false;

  // These three identity fields are the human's actual selection and must remain verbatim.
  for (const required of [project.title, project.client, project.location]) {
    if (!output.includes(required)) return false;
  }

  // The source-only floor is affirmative project prose. Bag-of-words coverage must never accept a
  // rewrite that preserves nouns while reversing their relation ("included SCADA" → "did not
  // include SCADA" / "excluded SCADA"). Any newly introduced contradictory predicate falls back.
  const sourcePolarityCount = contradictoryPredicateCount(buildKbTemplate(project));
  const outputPolarityCount = contradictoryPredicateCount(output);
  if (outputPolarityCount > sourcePolarityCount) return false;

  // The model may reorder and connect the reviewed language, but every meaningful source token
  // must survive. This is intentionally conservative: a false miss uses the safe template; a
  // loose threshold could silently lose one selected scope item (for example, SCADA).
  return project.facts.every((fact) => {
    const factWords = words(fact);
    return [...factWords].every((word) => outputWords.has(word));
  });
}

function kbContext(project: FirmProject): string[] {
  return [
    `Project title: ${project.title}`,
    `Client: ${project.client}`,
    `Location: ${project.location}`,
    ...project.facts.map((fact) => `Reviewed fact: ${fact}`),
  ];
}

function primaryEvidence(project: FirmProject) {
  return project.provenance.reduce((best, item) =>
    item.quote.length > best.quote.length ? item : best,
  );
}

export async function composeKbExperience(
  request: KbComposeRequest,
  project: FirmProject,
): Promise<KbComposeResponse> {
  const fallback = buildKbTemplate(project);
  let newText = fallback;
  let fallbackUsed = true;

  if (isAiConfigured()) {
    try {
      const result = await runEdit({
        block: {
          id: `kb-compose:${project.id}`,
          type: 'paragraph',
          text: fallback,
        },
        instruction: COMPOSE_INSTRUCTION,
        docContext: {
          ...request.docContext,
          // Resolve style from the open document, never from the MECO facts in the synthetic
          // draft. Known sample docs carry an asserted firm; unknown uploads stay document-local.
          docText:
            request.docContext.docText ??
            request.docContext.voiceSamples?.join('\n') ??
            request.target.text,
        },
        kbContext: kbContext(project),
      });

      const gate = checkFactEntityGate({
        before: fallback,
        after: result.newText,
        authoritativeInstruction: COMPOSE_INSTRUCTION,
        authoritativeFacts: kbContext(project),
        extraNames: [project.title, project.client, project.location],
      });
      if (gate.ok && coversSelectedProject(project, result.newText)) {
        newText = result.newText;
        fallbackUsed = false;
      }
    } catch (error) {
      // No retry: deterministic, reviewed prose is the safer floor and keeps the flow usable when
      // the proxy or a hard fact gate rejects a draft. Never log source text.
      console.warn('[kb-compose-fallback]', {
        candidateId: project.id,
        reason: error instanceof Error ? error.message : 'compose failed',
      });
    }
  }

  const evidence = primaryEvidence(project);
  const candidate = projectToCandidate(project, 0);
  return {
    newText,
    candidate,
    provenance: {
      candidateId: project.id,
      title: project.title,
      sourceDoc: evidence.sourceDoc,
      sourceTitle: evidence.sourceTitle,
      page: evidence.page,
      quote: evidence.quote,
      discipline: project.disciplines[0] ?? 'general',
      fallbackUsed,
    },
    fallbackUsed,
  };
}

/** Resolve inside the server boundary; exported for the route and deterministic tests. */
export function resolveKbComposeCandidate(candidateId: string): FirmProject | undefined {
  return resolveFirmProject(candidateId);
}
