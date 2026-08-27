/**
 * FIRM FACTS — a CLOSED, reference-only set of real facts about the firm and its past work.
 *
 * Every value here is drawn verbatim (or directly) from the firm's OWN already-committed sample
 * proposals (src/parse-cache/*.json). It is a *reference*, not a generator input:
 *
 *  ANTI-FABRICATION (hard rule): this card exists to GROUND, never to invent. Nothing here is wired
 *  into a generation path today — the editorial suggest pass never adds facts (it only rewrites
 *  phrasing groundable in the block's own text), and /api/edit already constrains any kbContext
 *  with "do not invent beyond these". When CP6 "add similar experience" is built, it must (per
 *  plans/checkpoint-6) let the human pick a real project FIRST and run a deterministic entity
 *  fidelity net — this card is the closed universe it may draw from, never a licence to invent.
 *
 * Deliberately NOT recorded as citable "project numbers": the SOQ ids (e.g. 041-560, 001-894) —
 * those are each proposal's OWN document id, not a past-project reference (see docs/architecture.md).
 */
export interface FirmProject {
  title: string;
  /** Concrete, real details as stated in the source proposals. */
  facts: string;
}

export interface FirmFacts {
  legalName: string;
  aliases: string[];
  disciplines: string[];
  region: string[];
  headquarters: string;
  officeCount: number;
  staffCount: number;
  /** As stated in the source proposals (~2025); recorded as given, no founding year inferred. */
  yearsInOperation: number;
  /** Firm engineers named in the proposals (mirrors the personnel in src/lib/entities.ts). */
  personnel: string[];
  /** PE license strings exactly as they appear in the proposals (not mapped to individuals here). */
  licenses: string[];
  /** Public-sector clients named in the sample proposals. */
  clients: string[];
  representativeProjects: FirmProject[];
  note: string;
}

export const FIRM_FACTS: FirmFacts = {
  legalName: 'MECO Engineering Company, Inc.',
  aliases: ['MECO Engineering', 'MECO'],
  disciplines: [
    'Civil engineering',
    'Water and wastewater engineering',
    'Potable water supply and treatment (groundwater and surface water)',
  ],
  region: ['Missouri', 'Central Illinois'],
  headquarters: 'Jefferson City, MO area (~55 miles from the City of Dixon)',
  officeCount: 7,
  staffCount: 60,
  yearsInOperation: 40,
  personnel: [
    'Donald J. Jenkins',
    'Scott E. Vogler',
    'David C. Uhlig',
    'Kevin W. Garnett',
    'Evan Nickels',
    'Max Middendorf',
    'Jim Bensman',
  ],
  licenses: ['MO PE No. 022510', 'MO PE E-027521', 'MO PE No. 2006023228', 'IL PE 062.057955'],
  clients: ['City of Dixon, MO', 'City of Kirksville, MO', 'City of Louisiana, MO'],
  representativeProjects: [
    {
      title: 'City of Kirksville — water supply strategy',
      facts: 'Short- and long-term strategies to meet the city’s water demands, following review of the Kirksville Water Treatment Facility.',
    },
    {
      title: 'City of Louisiana — Water Treatment Plant basement rehabilitation',
      facts: 'Design engineering to correct piping to drains, dripping seals, and leaking fittings, plus a design to seal the basement and reduce humidity.',
    },
    {
      title: 'Water main relocation ahead of MoDOT Highway 58 construction',
      facts: 'Relocation of approximately 5,200 LF of ductile iron water main, new water services, and connection to existing mains.',
    },
    {
      title: 'Ion-Exchange groundwater softening plant',
      facts: 'A new 1,000 GPM ion-exchange groundwater softening plant with a SCADA system and a diesel-powered emergency backup generator.',
    },
    {
      title: 'Large-scale water treatment program (in progress)',
      facts: 'A current $66 million project that includes water treatment work.',
    },
  ],
  note: 'CLOSED reference set of real facts from MECO’s own committed sample proposals. Use to GROUND, never to invent: the suggest/edit paths must not state any project, number, client, or credential not present here or in the document, and must preserve every entity verbatim.',
};
