/**
 * FIRM VOICE CARD — the established register the editorial pass steers toward.
 *
 * DISTILLED, not raw: this is a small, committable summary of *how* the firm writes, derived from
 * the firm's OWN already-committed sample proposals (src/parse-cache/*.json — easy.pdf/hard.pdf).
 * No confidential /kb/ material is committed here (that corpus is gitignored and was not present
 * on disk). The exemplars are verbatim sentences from those already-public seeds, so this adds no
 * new disclosure.
 *
 * It steers TONE only — never facts. suggest.ts injects `register` + `exemplars` into the model
 * so it proposes rewrites in this register (formal/technical), never a casual or punchy restyle.
 * It replaces the earlier doc-derived interim (which stays as a fallback for an unseen document).
 */
export interface FirmVoiceCard {
  firm: string;
  /** Bullet descriptors of the established voice — the "how", not the "what". */
  register: string[];
  /** Verbatim sentences from the firm's own proposals that embody the register. */
  exemplars: string[];
}

export const FIRM_VOICE: FirmVoiceCard = {
  firm: 'MECO Engineering Company, Inc.',
  register: [
    'First person plural — "we", "our", "MECO" — addressing the client (a municipality) directly as "you".',
    'Formal, professional, and measured; confident about qualifications without marketing hype or slang.',
    'Service- and relationship-oriented: emphasizes attention, responsiveness, and partnering with the client.',
    'Technical civil / water-and-wastewater engineering vocabulary, stated with concrete specifics (capacities, lengths, regulatory terms).',
    'Leads with qualifications, experience, and specific project references; complete, often longer sentences.',
    'Avoids: casual or punchy phrasing, second-person imperatives, hype, and abbreviation of proper terms.',
  ],
  exemplars: [
    'MECO specializes in civil engineering, specifically water/wastewater projects.',
    'MECO is a leader throughout Missouri and Central Illinois in the specialized discipline of potable water engineering.',
    'MECO’s “Standard of Care” and “Project Approach” is a team-centric based philosophy to ensure that every step of project scope development and design review fully invests the client in each step of the process.',
    'You can rely on MECO and our Project Team to provide the attention to detail, prompt response, and a level of commitment to service, experience, knowledge, and expertise that you require and expect of your Engineering Consultant.',
    'Our professionals provide sound engineering solutions for groundwater and surface water supply and treatment requirements to meet regulatory compliance.',
  ],
};
