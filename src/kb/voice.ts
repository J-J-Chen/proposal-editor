import {
  KB_SOURCE_DOCUMENTS,
  type KbProvenance,
  type KbSourceFilename,
} from './corpus';

/** A single, evidence-backed editorial convention. */
export interface FirmVoiceRule {
  id: string;
  /** Fact-free instruction safe to place in an editing prompt. */
  directive: string;
  /** Exact examples used by the human reviewer to derive the directive. */
  evidence: readonly KbProvenance[];
}

export type FirmStyleRole =
  | 'qualification-opening'
  | 'measured-confidence'
  | 'client-collaboration'
  | 'technical-description'
  | 'service-scope'
  | 'project-outcome';

export interface FirmStyleExample {
  id: string;
  role: FirmStyleRole;
  /** Exact source text for audit/display only; do not inject as a factual example. */
  text: string;
  /** Fact-free placeholder form safe to use as a style-only prompt example. */
  delexicalized: string;
  evidence: readonly KbProvenance[];
}

export interface FirmVoiceCard {
  id: string;
  version: string;
  firm: string;
  aliases: readonly string[];
  sourceDocumentIds: readonly KbSourceFilename[];
  /** Compact fact-free prompt directives retained for existing consumers. */
  register: readonly string[];
  /** Delexicalized, placeholder-only examples retained for existing consumers. */
  exemplars: readonly string[];
  rules: readonly FirmVoiceRule[];
  styleExamples: readonly FirmStyleExample[];
}

const HANNIBAL_TITLE = KB_SOURCE_DOCUMENTS[0].title;
const MACON_TITLE = KB_SOURCE_DOCUMENTS[1].title;
const MONROE_TITLE = KB_SOURCE_DOCUMENTS[2].title;
const NEMO_TITLE = KB_SOURCE_DOCUMENTS[3].title;
const PALMYRA_TITLE = KB_SOURCE_DOCUMENTS[4].title;

const openingEvidence: KbProvenance = {
  sourceDoc: 'hannibal_demolition_soq.pdf',
  sourceTitle: HANNIBAL_TITLE,
  page: 2,
  quote:
    'MECO Engineering Company, Inc. (MECO) is pleased to present qualifications to the City of Hannibal for professional engineering services to assist the City in drafting specifications to demolish the “Former St. Elizabeth Hospital”.',
};

const measuredConfidenceEvidence: KbProvenance = {
  sourceDoc: 'monroe_city_electrical_soq.pdf',
  sourceTitle: MONROE_TITLE,
  page: 2,
  quote:
    'This, as well as our knowledge of the area and ever-changing regulations, and our extensive experience specifically in engineering reports and MODNR funding, allows us to assure you of our ability to serve the City in a high-quality, cost-effective manner.',
};

const collaborationEvidence: KbProvenance = {
  sourceDoc: 'nemo_rpc_bridge_soq.pdf',
  sourceTitle: NEMO_TITLE,
  page: 3,
  quote:
    'MECO does not believe in an engineer-driven project development process; we see the most value in investing our client input in the process, first and foremost. Our clients will never see MECO force a project or a solution upon them. Our clients will always lead the initiative for developing projects and working with our professional staff to determine the best suited solutions to their needs.',
};

const technicalEvidence: KbProvenance = {
  sourceDoc: 'macon_city_soq.pdf',
  sourceTitle: MACON_TITLE,
  page: 8,
  quote:
    'The new ground water supply is treated by a new 1,000 GPM Ion-Exchange ground water softening plant. A new SCADA system links all systems and facilities to monitor and control the operations. A diesel-powered emergency backup generator provides emergency service to the two new wells and a diesel-powered generator has capacity to operate the new water treatment plant at full capacity.',
};

const serviceScopeEvidence: KbProvenance = {
  sourceDoc: 'hannibal_demolition_soq.pdf',
  sourceTitle: HANNIBAL_TITLE,
  page: 8,
  quote:
    'Services included performing structural observations in the areas of the buildings to be demolished and possible affected by demolition, preparation of a letter-report with demolition recommendations, followed up by contract documents, structural observations and data collection, and construction phase engineering services.',
};

const outcomeEvidence: KbProvenance = {
  sourceDoc: 'palmyra_modot_tap_soq.pdf',
  sourceTitle: PALMYRA_TITLE,
  page: 9,
  quote:
    'The installation of new stormwater piping and the new curb and guttering has reduced the incidence of high water throughout this local area.',
};

const serviceCommitmentEvidence: KbProvenance = {
  sourceDoc: 'palmyra_modot_tap_soq.pdf',
  sourceTitle: PALMYRA_TITLE,
  page: 3,
  quote:
    'You can rely on MECO and our Project Team to provide the attention to detail, prompt response, and a level of commitment to service, experience, knowledge, and expertise that you require and expect of your Engineering Consultant.',
};

export const FIRM_VOICE_RULES = [
  {
    id: 'direct-client-context',
    directive:
      'Write chiefly in first-person plural ("we" and "our") or as the firm, naming the client and requested service directly when the document supplies them.',
    evidence: [openingEvidence, serviceCommitmentEvidence],
  },
  {
    id: 'measured-evidence-led-confidence',
    directive:
      'Use a formal, professional, measured register; support confidence with supplied experience, proximity, requirements, schedule, or cost instead of generic hype.',
    evidence: [measuredConfidenceEvidence],
  },
  {
    id: 'client-led-collaboration',
    directive:
      'Present the work as collaborative and client-led: the consultant listens, coordinates, and helps determine solutions suited to the client’s needs.',
    evidence: [collaborationEvidence],
  },
  {
    id: 'concrete-technical-scope',
    directive:
      'Describe engineering work with concrete, supplied specifics such as capacity, materials, systems, deliverables, regulatory requirements, and construction-phase services.',
    evidence: [technicalEvidence, serviceScopeEvidence],
  },
  {
    id: 'complete-scope-sequences',
    directive:
      'Use complete sentences and parallel service sequences that move from investigation or planning through design, documents, bidding, and construction support when those stages are supported.',
    evidence: [serviceScopeEvidence],
  },
  {
    id: 'outcomes-and-stewardship',
    directive:
      'When the source supplies an outcome, connect the engineering action to its practical result; otherwise do not invent performance, schedule, funding, or cost claims.',
    evidence: [outcomeEvidence],
  },
] as const satisfies readonly FirmVoiceRule[];

export const FIRM_STYLE_EXAMPLES = [
  {
    id: 'qualification-opening',
    role: 'qualification-opening',
    text: openingEvidence.quote,
    delexicalized:
      '[FIRM] is pleased to present its qualifications to [CLIENT] for professional engineering services related to [PROJECT SCOPE].',
    evidence: [openingEvidence],
  },
  {
    id: 'measured-confidence',
    role: 'measured-confidence',
    text: measuredConfidenceEvidence.quote,
    delexicalized:
      'This proximity, together with [RELEVANT EXPERIENCE], positions [FIRM] to serve [CLIENT] in a high-quality, cost-effective manner.',
    evidence: [measuredConfidenceEvidence],
  },
  {
    id: 'client-led-development',
    role: 'client-collaboration',
    text: collaborationEvidence.quote,
    delexicalized:
      'Our clients lead the initiative while our professional staff helps determine solutions suited to their needs.',
    evidence: [collaborationEvidence],
  },
  {
    id: 'technical-system-description',
    role: 'technical-description',
    text: technicalEvidence.quote,
    delexicalized:
      'The [FACILITY] includes [CAPACITY], [PRIMARY PROCESS], [CONTROLS], and [RESILIENCY FEATURE].',
    evidence: [technicalEvidence],
  },
  {
    id: 'full-service-scope',
    role: 'service-scope',
    text: serviceScopeEvidence.quote,
    delexicalized:
      'Services included [FIELD WORK], [DESIGN OR ANALYSIS], [DELIVERABLES], and [CONSTRUCTION-PHASE SUPPORT].',
    evidence: [serviceScopeEvidence],
  },
  {
    id: 'engineering-outcome',
    role: 'project-outcome',
    text: outcomeEvidence.quote,
    delexicalized:
      'The installation of [IMPROVEMENT] reduced [OBSERVED PROBLEM] throughout [AREA].',
    evidence: [outcomeEvidence],
  },
] as const satisfies readonly FirmStyleExample[];

/**
 * Versioned prompt-facing profile. `register` and `exemplars` are deliberately fact-free; exact
 * source wording remains available under the audited rule/example evidence for UI citations.
 */
export const FIRM_VOICE: FirmVoiceCard = {
  id: 'meco-five-proposal-voice',
  version: '1.0.0',
  firm: 'MECO Engineering Company, Inc.',
  aliases: ['MECO Engineering Company, Inc.', 'MECO Engineering Company', 'MECO Engineering', 'MECO'],
  sourceDocumentIds: KB_SOURCE_DOCUMENTS.map((source) => source.filename),
  register: FIRM_VOICE_RULES.map((rule) => rule.directive),
  exemplars: FIRM_STYLE_EXAMPLES.map((example) => example.delexicalized),
  rules: FIRM_VOICE_RULES,
  styleExamples: FIRM_STYLE_EXAMPLES,
};
