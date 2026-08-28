import {
  FIRM_PROJECTS,
  KB_SOURCE_DOCUMENTS,
  type FirmProject,
  type KbSourceDocument,
} from './corpus';

/** Versioned, closed facts profile. All generative use must be scoped to one selected project. */
export interface FirmFacts {
  id: string;
  version: string;
  legalName: string;
  aliases: readonly string[];
  sourceDocuments: readonly KbSourceDocument[];
  /** Canonical project collection. */
  projects: readonly FirmProject[];
  /** Backward-compatible name used by the original KB plan. */
  representativeProjects: readonly FirmProject[];
  note: string;
}

export const FIRM_FACTS: FirmFacts = {
  id: 'meco-five-proposal-facts',
  version: '1.0.0',
  legalName: 'MECO Engineering Company, Inc.',
  aliases: ['MECO Engineering Company, Inc.', 'MECO Engineering Company', 'MECO Engineering', 'MECO'],
  sourceDocuments: KB_SOURCE_DOCUMENTS,
  projects: FIRM_PROJECTS,
  representativeProjects: FIRM_PROJECTS,
  note:
    'Closed, hand-reviewed facts from exactly five approved MECO proposal examples. Ordinary edits receive no project facts. A grounded composition may use only the selected project’s facts and must retain its provenance.',
};

export { FIRM_PROJECTS } from './corpus';
export type { FirmProject } from './corpus';
