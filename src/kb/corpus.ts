/**
 * Hand-reviewed, fixed corpus distilled from the five product-KB proposals.
 *
 * The PDFs themselves stay outside the repository. Every retained fact points back to an exact,
 * page-bound quote so a reviewer can verify it with `scripts/build-kb.ts`. Source descriptors are
 * intentionally limited to a filename and human-readable title: no machine-local paths or hashes.
 *
 * Do not add proposal-cover `001-…` identifiers here. They identify the SOQ document, not a past
 * project, and one source even prints two conflicting values for the same proposal.
 */

export interface KbSourceDocument {
  filename: string;
  title: string;
}

export const KB_SOURCE_DOCUMENTS = [
  {
    filename: 'hannibal_demolition_soq.pdf',
    title: 'City of Hannibal — St. Elizabeth Hospital Demolition',
  },
  {
    filename: 'macon_city_soq.pdf',
    title: 'City of Macon — Water Treatment Plant RFQ',
  },
  {
    filename: 'monroe_city_electrical_soq.pdf',
    title: 'City of Monroe City — Electric Distribution and Infrastructure Engineering Report',
  },
  {
    filename: 'nemo_rpc_bridge_soq.pdf',
    title: 'NEMO RPC — Potential Bridge Projects',
  },
  {
    filename: 'palmyra_modot_tap_soq.pdf',
    title: 'City of Palmyra — MoDOT TAP Grant #9900-273',
  },
] as const satisfies readonly KbSourceDocument[];

export type KbSourceFilename = (typeof KB_SOURCE_DOCUMENTS)[number]['filename'];

export interface KbProvenance {
  /** Repository-safe basename of one of the five approved source PDFs. */
  sourceDoc: KbSourceFilename;
  /** Human-readable proposal title, repeated to keep citations self-contained. */
  sourceTitle: string;
  /** One-based PDF page number. */
  page: number;
  /** Exact reviewed source wording; PDF line wraps are normalized to spaces. */
  quote: string;
}

export interface FirmProject {
  id: string;
  title: string;
  client: string;
  location: string;
  /** Hand-curated, source-bounded synopsis for candidate cards. */
  summary: string;
  disciplines: readonly string[];
  /** Non-factual retrieval vocabulary. */
  searchTerms: readonly string[];
  /** Closed set of claims that a grounded composition may use. */
  facts: readonly string[];
  /** Exact source evidence for all claims above. */
  provenance: readonly KbProvenance[];
}

const HANNIBAL_TITLE = KB_SOURCE_DOCUMENTS[0].title;
const MACON_TITLE = KB_SOURCE_DOCUMENTS[1].title;
const MONROE_TITLE = KB_SOURCE_DOCUMENTS[2].title;
const NEMO_TITLE = KB_SOURCE_DOCUMENTS[3].title;
const PALMYRA_TITLE = KB_SOURCE_DOCUMENTS[4].title;

/**
 * Curated project records, intentionally narrower than every project name found in the PDFs.
 * Resume-only lists and records whose title/body association was ambiguous were left out.
 */
export const FIRM_PROJECTS = [
  {
    id: 'barry-demolition-structural-investigation',
    title: 'Demolition Structural Investigation of Buildings',
    client: 'City of Barry',
    location: '744 Mortimer Street, Barry, IL',
    summary:
      'Demolition-focused structural investigation, recommendations, contract documents, and construction-phase support for two buildings.',
    disciplines: ['structural engineering', 'building demolition'],
    searchTerms: [
      'demolition',
      'structural investigation',
      'building assessment',
      'observations',
      'recommendations',
      'contract documents',
      'construction phase',
    ],
    facts: [
      'MECO investigated two buildings at 744 Mortimer Street in Barry, Illinois, in connection with demolition.',
      'Services included structural observations, a letter-report with demolition recommendations, contract documents, data collection, and construction-phase engineering.',
    ],
    provenance: [
      {
        sourceDoc: 'hannibal_demolition_soq.pdf',
        sourceTitle: HANNIBAL_TITLE,
        page: 8,
        quote:
          'Demolition Structural Investigation of Buildings 744 Mortimer Street Barry, IL MECO provided structural engineering services to complete a demolition-related structural investigation of two buildings located at 744 Mortimer Street, Barry, Il.',
      },
      {
        sourceDoc: 'hannibal_demolition_soq.pdf',
        sourceTitle: HANNIBAL_TITLE,
        page: 8,
        quote:
          'Services included performing structural observations in the areas of the buildings to be demolished and possible affected by demolition, preparation of a letter-report with demolition recommendations, followed up by contract documents, structural observations and data collection, and construction phase engineering services.',
      },
    ],
  },
  {
    id: 'harbison-walker-building-bracing',
    title: 'Building Analysis and Bracing Design',
    client: 'Harbison-Walker Refractories Company',
    location: 'Fulton, MO',
    summary:
      'Structural analysis, bracing, and enclosure design for plant buildings remaining after removal of part of a 1947 industrial complex.',
    disciplines: ['structural engineering', 'industrial facilities'],
    searchTerms: [
      'industrial',
      'building modification',
      'bracing',
      'steel frame',
      'structural analysis',
      'wall panels',
      'roof panels',
      'plant',
    ],
    facts: [
      'MECO analyzed and designed bracing for two steel-framed, metal-sheeted buildings that would remain after part of a 1947 plant building was removed.',
      'Additional services included onsite data collection, observation of existing conditions, and design of a new wall system plus wall and roof panels for the separated buildings.',
    ],
    provenance: [
      {
        sourceDoc: 'hannibal_demolition_soq.pdf',
        sourceTitle: HANNIBAL_TITLE,
        page: 9,
        quote:
          'Provided engineering services for modifications to existing buildings at Harbison-Walker Refractories Company plant at 1301 Westminster Ave, Fulton, MO. Services provided included structural analyses and design of bracing for two (2) steel-framed and metal sheeted buildings that remain after removal of part of the 1947 plant building lcoated in the center part of the building complex.',
      },
      {
        sourceDoc: 'hannibal_demolition_soq.pdf',
        sourceTitle: HANNIBAL_TITLE,
        page: 9,
        quote:
          'Basic Services provided included onsite data collection and observation of existing conditions, structural analyses and design of new wall system along south end of proposed north building "cut" at Column Line 42. Also performed design of new wall and roof panels to be installed on the separated south and north buildings, that were to remain after proposed removal of the middle part of the 1947 Tunnel Kiln plant building.',
      },
      {
        sourceDoc: 'hannibal_demolition_soq.pdf',
        sourceTitle: HANNIBAL_TITLE,
        page: 9,
        quote: 'ANH Refractories/Harbison-Walker Refractories Company Fulton, MO',
      },
      {
        sourceDoc: 'hannibal_demolition_soq.pdf',
        sourceTitle: HANNIBAL_TITLE,
        page: 9,
        quote: 'Building Analysis + Bracing Design',
      },
    ],
  },
  {
    id: 'illinois-alluvial-regional-water-system',
    title: 'Illinois Alluvial Regional Water System',
    client: 'Illinois Alluvial Regional Water Company',
    location: 'Jersey County, IL',
    summary:
      'Regional water system planned around an 8 MGD wellfield and treatment plant, major raw and finished-water transmission, storage, and seven members.',
    disciplines: ['water supply', 'water treatment', 'transmission mains', 'water storage'],
    searchTerms: [
      'regional water',
      'wellfield',
      'water treatment plant',
      'transmission main',
      'clearwell',
      'elevated tower',
      'funding',
      '8 MGD',
    ],
    facts: [
      'The $210 million regional system serves seven members.',
      'The system includes an 8 MGD wellfield, three miles of 30-inch raw-water transmission main, a new 8 MGD water treatment plant, two 1 MG clearwells, a 2 MG composite elevated water tower, and 50 miles of finished-water transmission main.',
      '$66 million in government funding was applied for and granted for the project.',
    ],
    provenance: [
      {
        sourceDoc: 'macon_city_soq.pdf',
        sourceTitle: MACON_TITLE,
        page: 7,
        quote:
          'Illinois Alluvial Regional Water Company $66 million in government funding was applied for and granted for this project Jersey County Jersey County, IL',
      },
      {
        sourceDoc: 'macon_city_soq.pdf',
        sourceTitle: MACON_TITLE,
        page: 7,
        quote:
          'This is a $210M project serving 7 members with an 8MGD wellfield, 3 miles of 30" raw water transmission main, a new 8 MGD water treatment plant, 2 1 MG clearwells, 2 MG composite elevated water tower and 50 miles of finished water transmission main.',
      },
    ],
  },
  {
    id: 'pittsfield-water-supply-treatment',
    title: 'New Water Supply, Treatment Plant, and Transmission',
    client: 'City of Pittsfield',
    location: 'Pittsfield, IL',
    summary:
      'Groundwater-supply replacement and a 1,000 GPM ion-exchange softening plant with SCADA and emergency generation.',
    disciplines: ['water supply', 'water treatment', 'SCADA', 'electrical resilience'],
    searchTerms: [
      'groundwater',
      'alluvial wells',
      'ion exchange',
      'softening plant',
      'SCADA',
      'generator',
      'drinking water',
      '1,000 GPM',
    ],
    facts: [
      'The City replaced its surface-water supply with a groundwater supply from two approximately 95-foot, 1,000 GPM alluvial wells.',
      'A new 1,000 GPM ion-exchange groundwater softening plant treats the supply.',
      'SCADA links the systems for monitoring and control, and diesel generators provide emergency service for the wells and full-capacity plant operation.',
    ],
    provenance: [
      {
        sourceDoc: 'macon_city_soq.pdf',
        sourceTitle: MACON_TITLE,
        page: 8,
        quote:
          'New Supply/Treatment Plant/Transmission City of Pittsfield Pittsfield, IL The City of Pittsfield, IL undertook a major water system improvements project in 2009 to provide a safe and reliable drinking water supply to their community.',
      },
      {
        sourceDoc: 'macon_city_soq.pdf',
        sourceTitle: MACON_TITLE,
        page: 8,
        quote:
          'In order to meet state and federal standards for drinking water, the city realized the need to replace their existing surface water supply (lake), with a ground water supply provided through a new alluvial well field, including two 1,000 GPM wells (approximately 95-ft), submersible pumps, elevated platforms, piping and electrical.',
      },
      {
        sourceDoc: 'macon_city_soq.pdf',
        sourceTitle: MACON_TITLE,
        page: 8,
        quote:
          'The new ground water supply is treated by a new 1,000 GPM Ion-Exchange ground water softening plant. A new SCADA system links all systems and facilities to monitor and control the operations. A diesel-powered emergency backup generator provides emergency service to the two new wells and a diesel-powered generator has capacity to operate the new water treatment plant at full capacity.',
      },
    ],
  },
  {
    id: 'curran-gardner-water-system-expansion',
    title: 'Water System Improvements and Expansion',
    client: 'Curran-Gardner Township Public Water District',
    location: 'Curran Gardner Township, IL',
    summary:
      'Multi-phase water-system expansion covering wells, mains, storage, a treatment-plant expansion, chemical feed, controls, and SCADA.',
    disciplines: ['water supply', 'water distribution', 'water treatment', 'SCADA'],
    searchTerms: [
      'water expansion',
      'elevated tower',
      'well',
      'water main',
      'treatment plant',
      'filters',
      'clarifier',
      'chemical feed',
      'SCADA',
    ],
    facts: [
      'A $5.6 million expansion included two 750,000-gallon elevated towers, a new 300 GPM well, pumping stations, mains, backup generation, and a 6,600-square-foot office and maintenance building.',
      'A 2019 treatment-plant expansion added three dual-stage filters, a 1,000 GPM clarifier, chemical-feed systems, a motor control center, and SCADA controls.',
    ],
    provenance: [
      {
        sourceDoc: 'macon_city_soq.pdf',
        sourceTitle: MACON_TITLE,
        page: 9,
        quote:
          'Water System Improvements/Expansion Curran-Gardner Township Public Water District Curran Gardner Township, IL Water System Improvements: $5.6M water system expansion (two 750,000 gallon elevated towers/ one new 300 GPM well/pumping 2 stations/59,700 LF mains); project coordination, planning, consulting. Project also consisted of: 57,000 LF new waterline (owner-constructed), new gen-set backup generator for water treatment plant, new 6,600 SF office and maintenance building.',
      },
      {
        sourceDoc: 'macon_city_soq.pdf',
        sourceTitle: MACON_TITLE,
        page: 9,
        quote:
          'In 2019 MECO was also hired for a Water Treatment Plant expansion project to add 3 new dual stage filters and 1,000 gpm clarifier, and new chemical feed systems, a new motor control center and SCADA controls.',
      },
    ],
  },
  {
    id: 'louisiana-water-treatment-plant-improvements',
    title: 'Water Treatment Plant Improvements',
    client: 'City of Louisiana',
    location: 'Louisiana, MO',
    summary:
      'Basement rehabilitation design addressing drains, seals, fittings, humidity, corrosion, and pump-house access, followed by construction engineering and inspection.',
    disciplines: ['water treatment', 'mechanical engineering', 'construction engineering'],
    searchTerms: [
      'water treatment plant',
      'basement',
      'piping',
      'humidity',
      'HVAC',
      'corrosion',
      'construction administration',
      'inspection',
    ],
    facts: [
      'Design work addressed corrective drain piping, dripping seals, leaking fittings, basement humidity, corroded fasteners and bolts, pipe coatings, and a new pump-house door and frame.',
      'Construction engineering included meetings, contract administration, bonds and insurance, pay applications, change orders, closeout paperwork, and part-time inspection with reports and photographs.',
    ],
    provenance: [
      {
        sourceDoc: 'macon_city_soq.pdf',
        sourceTitle: MACON_TITLE,
        page: 10,
        quote:
          'The scope of services was for the design engineering of the basement area for Louisiana’s Water Treatment Plant to address corrective piping to drains, dripping seals and leaking fittings. To reduce the humidity from the basement, a design to seal off this area will be incorporated with the installation of a HVAC/Remote air handler.',
      },
      {
        sourceDoc: 'macon_city_soq.pdf',
        sourceTitle: MACON_TITLE,
        page: 10,
        quote:
          'Once the moisture has been reduced, then the basement can continue to be addressed with the identified replacement of corroded fasteners and bolts as well as prepping and painting of existing piping. The plans will also include a separate sheet to address the installation of a new door and frame at the pump house as identified / requested by the City of Louisiana.',
      },
      {
        sourceDoc: 'macon_city_soq.pdf',
        sourceTitle: MACON_TITLE,
        page: 10,
        quote:
          'Construction engineering covered the pre-construction meeting as well as progress meetings, the administration paperwork associated with contract documentation and required bonds/insurance as well as any pay application, change orders, and final paperwork. Construction engineering also covered the part-time inspection portion to cover the critical time an inspector needs to be present or follow up on ensuring the work has been completed with inspection reports and photographs.',
      },
      {
        sourceDoc: 'macon_city_soq.pdf',
        sourceTitle: MACON_TITLE,
        page: 10,
        quote: 'City of Louisiana Louisiana, MO',
      },
      {
        sourceDoc: 'macon_city_soq.pdf',
        sourceTitle: MACON_TITLE,
        page: 10,
        quote: 'Water Treatment Plant Improvements',
      },
    ],
  },
  {
    id: 'crossing-mep-design',
    title: 'The Crossing MEP Design Services',
    client: 'The Crossing',
    location: 'Quincy, IL',
    summary:
      'Integrated MEP design for a new building, coordinated with the owner and City for local-code compliance.',
    disciplines: ['mechanical engineering', 'electrical engineering', 'plumbing engineering'],
    searchTerms: [
      'MEP',
      'new construction',
      'lighting',
      'HVAC',
      'plumbing',
      'code compliance',
      'building',
    ],
    facts: [
      'MECO and MECO A/E provided comprehensive MEP design services for new construction of The Crossing in Quincy, Illinois.',
      'The design covered interior and exterior lighting, HVAC systems, and bathroom plumbing, with coordination for local-ordinance compliance.',
    ],
    provenance: [
      {
        sourceDoc: 'monroe_city_electrical_soq.pdf',
        sourceTitle: MONROE_TITLE,
        page: 9,
        quote:
          'MEP Design Services The Crossing Quincy, IL MECO Engineering, together with its Architectural Branch (MECO A/E), provided comprehensive MEP design services for the new construction of The Crossing in Quincy, Illinois.',
      },
      {
        sourceDoc: 'monroe_city_electrical_soq.pdf',
        sourceTitle: MONROE_TITLE,
        page: 9,
        quote:
          'Working closely with the owner of the project and the City of Quincy, MECO ensured full compliance with all local ordinances while delivering a functional facility that met the organization’s needs. the team designed all the MEP components of the new building, including all interior and exterior lighting, HVAC systems, and complete bathroom plumbing.',
      },
    ],
  },
  {
    id: 'hunnewell-electric-distribution-upgrade',
    title: 'Electrical Distribution System Upgrade',
    client: 'City of Hunnewell',
    location: 'Hunnewell, MO',
    summary:
      'Funded medium-voltage distribution upgrade with new poles, ACSR conductors, underground residential feeds, transformers, and reliability improvements.',
    disciplines: ['electrical engineering', 'utility distribution', 'funding assistance'],
    searchTerms: [
      'electric distribution',
      'medium voltage',
      'utility poles',
      'ACSR conductor',
      'underground service',
      'transformers',
      'load calculations',
      'funding',
    ],
    facts: [
      'MECO helped the City secure funding and apply it to medium-voltage distribution improvements.',
      'Improvements included 50 new poles, 5,000 feet of ACSR conductors, underground residential service feeds, 11 pole transformers supported by load calculations, and additional reliability work.',
    ],
    provenance: [
      {
        sourceDoc: 'monroe_city_electrical_soq.pdf',
        sourceTitle: MONROE_TITLE,
        page: 10,
        quote:
          'MECO worked closely with the City of Hunnewell, MO to provide comprehensive services to upgrade the city’s electric distribution system, a project driven by the city’s need for system improvements. MECO assisted the city in securing the necessary funding and then utilizing these funds to deliver critical upgrades to the medium-voltage distribution system.',
      },
      {
        sourceDoc: 'monroe_city_electrical_soq.pdf',
        sourceTitle: MONROE_TITLE,
        page: 10,
        quote:
          'Improvements included the installation of 50 new poles equipped with modern technology, 5,000 feet of durable ACSR conductors, underground service feeds to residences, 11 new pole transformers guided by detailed load calculations, and additional enhancements to strengthen overall system reliability.',
      },
      {
        sourceDoc: 'monroe_city_electrical_soq.pdf',
        sourceTitle: MONROE_TITLE,
        page: 10,
        quote: 'City of Hunnewell Hunnewell, MO',
      },
      {
        sourceDoc: 'monroe_city_electrical_soq.pdf',
        sourceTitle: MONROE_TITLE,
        page: 10,
        quote: 'Electrical distribution System Upgrade',
      },
    ],
  },
  {
    id: 'lincoln-county-mbr-treatment-plant',
    title: '1.5 MGD MBR Wastewater Treatment Plant',
    client: 'PWSD #1 of Lincoln County',
    location: 'Winfield, MO',
    summary:
      'MEP specifications and electrical design for a membrane bioreactor wastewater treatment plant.',
    disciplines: ['wastewater treatment', 'mechanical engineering', 'electrical engineering', 'SCADA'],
    searchTerms: [
      'MBR',
      'membrane bioreactor',
      'wastewater treatment',
      'MEP',
      'motor control center',
      'SCADA',
      'lighting',
      '1.5 MGD',
    ],
    facts: [
      'MECO produced MEP specifications for a new 1.5 MGD MBR plant.',
      'Electrical work included wiring and lighting plans, a motor control center, and SCADA.',
    ],
    provenance: [
      {
        sourceDoc: 'monroe_city_electrical_soq.pdf',
        sourceTitle: MONROE_TITLE,
        page: 10,
        quote:
          'MEP engineering and design production of MEP specifications for the new MBR plant. Electrical design components included wiring and lighting plan, motor control center (MCC) and SCADA system.',
      },
      {
        sourceDoc: 'monroe_city_electrical_soq.pdf',
        sourceTitle: MONROE_TITLE,
        page: 10,
        quote: 'PWSD #1 of Lincoln County Winfield, MO',
      },
      {
        sourceDoc: 'monroe_city_electrical_soq.pdf',
        sourceTitle: MONROE_TITLE,
        page: 10,
        quote: '1.5 MGD MBR Wastewater Treatment Plant',
      },
    ],
  },
  {
    id: 'marion-county-taylor-bridge',
    title: 'Taylor Bridge',
    client: 'Marion County Commission',
    location: 'Palmyra, MO',
    summary:
      'Completed 271-foot, three-span prestressed-concrete girder bridge with integral and webwall bents, protection, approaches, grading, and guardrail.',
    disciplines: ['bridge engineering', 'structural engineering', 'roadway design'],
    searchTerms: [
      'bridge',
      'prestressed concrete',
      'girder',
      'deck',
      'H-piling',
      'spread footings',
      'rip rap',
      'roadway',
      'guardrail',
    ],
    facts: [
      'The completed project is a three-span, 271-foot prestressed-concrete girder bridge with a precast and cast-in-place deck.',
      'Work included integral end bents on H-piling, intermediate webwall bents on rock-founded spread footings, barrier curb, rip rap protection, asphalt approaches, grading, and guardrail.',
      'The engineer’s estimate was $1,075,770.35, and James D. Bensman, PE, SE, was project manager.',
    ],
    provenance: [
      {
        sourceDoc: 'nemo_rpc_bridge_soq.pdf',
        sourceTitle: NEMO_TITLE,
        page: 8,
        quote:
          'Status: Complete Engineers Estimate: $1,075,770.35 Project Manager: James D. Bensman, PE, SE Taylor Bridge',
      },
      {
        sourceDoc: 'nemo_rpc_bridge_soq.pdf',
        sourceTitle: NEMO_TITLE,
        page: 8,
        quote:
          'Construction of composite a 3-span 271-foot pre-stressed concrete girder bridge with a precast and cast-in-place concrete deck, concrete integral end bents on H-piling, non-integral intermediate webwall bents on spread footings founded in rock, concrete barrier curb, rip rap embankment and stream slope protection, full depth pavement with asphalt bridge approach roadways, site grading, guardrail, and incidental work.',
      },
      {
        sourceDoc: 'nemo_rpc_bridge_soq.pdf',
        sourceTitle: NEMO_TITLE,
        page: 8,
        quote: 'Marion County Commission Palmyra, MO',
      },
    ],
  },
  {
    id: 'ralls-county-camp-creek-lane-bridge',
    title: 'Camp Creek Lane Bridge',
    client: 'Ralls County Commission',
    location: 'New London, MO',
    summary:
      'Off-System Bridge Replacement and Rehabilitation Program replacement coordinated through MoDOT.',
    disciplines: ['bridge engineering', 'transportation funding'],
    searchTerms: [
      'bridge replacement',
      'FHWA',
      'MoDOT',
      'off-system bridge',
      'rehabilitation',
      'Ralls County',
      'Camp Creek',
    ],
    facts: [
      'The existing Camp Creek bridge in Ralls County was replaced using Federal Highway Administration funds coordinated through MoDOT’s Off-System Bridge Replacement and Rehabilitation Program.',
      'The work was MoDOT Project BRO-B087(18), Ralls County Bridge 0760061.',
    ],
    provenance: [
      {
        sourceDoc: 'nemo_rpc_bridge_soq.pdf',
        sourceTitle: NEMO_TITLE,
        page: 9,
        quote:
          'Camp Creek Lane Bridge MoDOT Project BRO-B087(18) Ralls County Bridge 0760061.',
      },
      {
        sourceDoc: 'nemo_rpc_bridge_soq.pdf',
        sourceTitle: NEMO_TITLE,
        page: 9,
        quote:
          'Funds were made available through the Federal Highway Administration through its Off-System Bridge Replacement and Rehabilitation Program, coordinated through MoDOT, the existing bridge on Camp Creek in Ralls County, MO was replaced.',
      },
      {
        sourceDoc: 'nemo_rpc_bridge_soq.pdf',
        sourceTitle: NEMO_TITLE,
        page: 9,
        quote: 'Ralls County Commission New London, MO',
      },
    ],
  },
  {
    id: 'jefferson-city-sidewalk-trail-system',
    title: 'Sidewalk, Pedestrian, and Bike Trail System',
    client: 'Jefferson City Parks, Recreation, and Forestry Department',
    location: 'Jefferson City, MO',
    summary:
      'A 22,000-linear-foot sidewalk and trail network connecting schools, parks, residences, businesses, a medical center, and an existing trail.',
    disciplines: ['pedestrian transportation', 'trail design', 'site planning'],
    searchTerms: [
      'sidewalk',
      'pedestrian',
      'bike trail',
      'schools',
      'parks',
      'medical center',
      'site plan',
      'right of way',
      '22,000 LF',
    ],
    facts: [
      'MECO planned and designed a 22,000 LF sidewalk and trail system connecting schools, parks, residential areas, business districts, and a medical center.',
      'The Satinwood Trail connects to the Wear’s Creek Trail and provides access to the Jefferson City Medical Group facility.',
      'JCMG contributed financial assistance and right of way.',
    ],
    provenance: [
      {
        sourceDoc: 'palmyra_modot_tap_soq.pdf',
        sourceTitle: PALMYRA_TITLE,
        page: 8,
        quote:
          'MECO planned and designed 22,000 LF sidewalk and trail system for the Jefferson City Parks, Recreation and Forestry Department. This system connects schools, parks, residential areas, local business districts, and an important medical center, providing safer walking and biking environments throughout many areas of the community for students, residents, and employees of the medical center.',
      },
      {
        sourceDoc: 'palmyra_modot_tap_soq.pdf',
        sourceTitle: PALMYRA_TITLE,
        page: 8,
        quote:
          'The new Satinwood Trail connects the Wear’s Creek Trail, providing trail access to the Jefferson City Medical Group (JCMG) facility. The JCMG provided financial assistance and ROW for the trail to ensure the completion of this important project for their employees.',
      },
      {
        sourceDoc: 'palmyra_modot_tap_soq.pdf',
        sourceTitle: PALMYRA_TITLE,
        page: 8,
        quote: 'Jefferson City Parks, Recreation, and Forestry Department Jefferson City, MO',
      },
    ],
  },
  {
    id: 'boonville-ada-sidewalk-extension',
    title: 'ADA-Compliant Sidewalk Extension',
    client: 'City of Boonville',
    location: 'Boonville, MO',
    summary:
      'USDA-RD-funded sidewalk extension providing safer access between a residential district and local shopping.',
    disciplines: ['pedestrian transportation', 'ADA compliance', 'surveying', 'funding assistance'],
    searchTerms: [
      'sidewalk',
      'ADA',
      'USDA-RD',
      'pedestrian safety',
      'route survey',
      'bidding',
      'construction phase',
      'PCC',
    ],
    facts: [
      'MECO assisted with a USDA-RD funding application for a sidewalk extension south of Poplar Street.',
      'Services included route survey; design of five-foot-wide, ADA-compliant, four-inch PCC sidewalks; plans and specifications; bidding support; and complete construction-phase services.',
    ],
    provenance: [
      {
        sourceDoc: 'palmyra_modot_tap_soq.pdf',
        sourceTitle: PALMYRA_TITLE,
        page: 9,
        quote:
          'Assistance to city to apply for USDA-RD funding for this project to extend sidewalks south of Poplar Street, improving pedestrian safety along the busy thoroughfare and providing improved access from the residential district to local shopping area.',
      },
      {
        sourceDoc: 'palmyra_modot_tap_soq.pdf',
        sourceTitle: PALMYRA_TITLE,
        page: 9,
        quote:
          'Project activities included route survey, design of the new 5-foot wide, ADA compliant, 4” PCC sidewalks, sidewalk and street repair as needed along project route; production of plans and specifications, contract and bidding documents in accordance with USDA-RD guidelines, assistance with bidding (attendance at bid opening/bid tabulation), and complete construction phase services.',
      },
      {
        sourceDoc: 'palmyra_modot_tap_soq.pdf',
        sourceTitle: PALMYRA_TITLE,
        page: 9,
        quote: 'City of Boonville Boonville, MO',
      },
    ],
  },
  {
    id: 'state-fair-community-college-site',
    title: 'State Fair Community College Site Improvements',
    client: 'State Fair Community College',
    location: 'Boonville, MO',
    summary:
      'Parking, entrance, ADA sidewalk, paving, and lighting design for new community-college facilities.',
    disciplines: ['site civil engineering', 'ADA compliance', 'lighting design'],
    searchTerms: [
      'parking lot',
      'entrance',
      'curb and gutter',
      'sidewalk',
      'ADA',
      'paving',
      'lighting',
      'construction observation',
    ],
    facts: [
      'The project included an asphalt parking lot, PCC entrance with Type A curb and gutter, four-inch ADA-compliant PCC sidewalks, paving design, and lighting.',
      'MECO produced plans, specifications, an engineer’s estimate, and bidding documents, then provided construction observation.',
    ],
    provenance: [
      {
        sourceDoc: 'palmyra_modot_tap_soq.pdf',
        sourceTitle: PALMYRA_TITLE,
        page: 9,
        quote:
          'Project activities included design of new asphalt surface parking lot, PCC drive/entrance (with Type “A” curb and guttering), 4” PCC sidewalks (ADA compliant), paving design and lighting to serve new community college facilities.',
      },
      {
        sourceDoc: 'palmyra_modot_tap_soq.pdf',
        sourceTitle: PALMYRA_TITLE,
        page: 9,
        quote:
          'Work included the production of plans, specifications, engineer’s estimate and contract and bidding documents for the City-bid project. MECO provided construction observation services for the project which was completed prior to the start of the new school year. State Fair Community College Boonville, MO',
      },
    ],
  },
  {
    id: 'east-high-street-reconstruction',
    title: 'East High Street Reconstruction',
    client: 'City of Jefferson City',
    location: 'Jefferson City, MO',
    summary:
      'Street, sidewalk, and stormwater reconstruction that reduced recurring high water near downtown Jefferson City.',
    disciplines: ['street design', 'stormwater engineering', 'ADA compliance'],
    searchTerms: [
      'street reconstruction',
      'stormwater',
      'flooding',
      'sidewalk',
      'ADA',
      'curb and gutter',
      'construction management',
    ],
    facts: [
      'MECO prepared the engineering report, survey, stormwater calculations, design, plans, specifications, contract documents, and estimate, then provided construction management and observation.',
      'Construction added an asphalt driving surface, concrete curb and gutter, ADA-compliant replacement sidewalks, and stormwater piping.',
      'The new stormwater piping and curb and gutter reduced high-water incidence in the area.',
    ],
    provenance: [
      {
        sourceDoc: 'palmyra_modot_tap_soq.pdf',
        sourceTitle: PALMYRA_TITLE,
        page: 9,
        quote:
          'Preparation of Preliminary Engineering Report, survey, stormwater calculations, design, production of plans, specifications, contract documents, and engineer’s estimate. MECO provided complete construction management and observation services for the East High Street reconstruction, stormwater improvements, and sidewalk project.',
      },
      {
        sourceDoc: 'palmyra_modot_tap_soq.pdf',
        sourceTitle: PALMYRA_TITLE,
        page: 9,
        quote:
          'Project activities included the construction of a new asphalt driving surface with concrete curb and gutter, and replacement of sidewalks to meet ADA compliance. The installation of new stormwater piping and the new curb and guttering has reduced the incidence of high water throughout this local area. East High Street Reconstruction Jefferson City, MO',
      },
    ],
  },
  {
    id: 'stover-cdbg-street-improvements',
    title: 'CDBG Street Improvements',
    client: 'City of Stover',
    location: 'Stover, MO',
    summary:
      'CDBG preliminary engineering, design, stormwater work, asphalt overlay, and construction completed near the engineering estimate.',
    disciplines: ['street design', 'stormwater engineering', 'funding assistance'],
    searchTerms: [
      'CDBG',
      'street improvements',
      'PER',
      'asphalt overlay',
      'stormwater',
      'cost estimate',
      'construction cost',
    ],
    facts: [
      'MECO prepared a CDBG preliminary engineering report, followed by design and construction completion for a two-inch BP1 asphalt overlay with repairs and stormwater work.',
      'The preliminary-engineering estimate was $507,021.90 and construction cost was $506,604.49, with 99.9% cost accuracy.',
    ],
    provenance: [
      {
        sourceDoc: 'palmyra_modot_tap_soq.pdf',
        sourceTitle: PALMYRA_TITLE,
        page: 14,
        quote:
          'Preparation of CDBG PER, followed by design, and construction completion. Project included 2” BP1 asphalt overlay with additional repairs and stormwater. This project was completed in a span of 2 years: 1 year to be selected, receive funds, and design, then 1 year for construction.',
      },
      {
        sourceDoc: 'palmyra_modot_tap_soq.pdf',
        sourceTitle: PALMYRA_TITLE,
        page: 14,
        quote: 'PER Estimate: $507,021.90 Construction Cost: $506,604.49 99.9% accuracy on cost',
      },
      {
        sourceDoc: 'palmyra_modot_tap_soq.pdf',
        sourceTitle: PALMYRA_TITLE,
        page: 14,
        quote: 'CDBG Street Improvements',
      },
      {
        sourceDoc: 'palmyra_modot_tap_soq.pdf',
        sourceTitle: PALMYRA_TITLE,
        page: 14,
        quote: 'City of Stover Stover, MO',
      },
    ],
  },
  {
    id: 'pilot-grove-cdbg-street-improvements',
    title: 'CDBG Street Improvements',
    client: 'City of Pilot Grove',
    location: 'Pilot Grove, MO',
    summary:
      'CDBG-funded street improvements covering preliminary engineering, funding, design, construction, asphalt overlay, and chip seal.',
    disciplines: ['street design', 'funding assistance', 'construction engineering'],
    searchTerms: [
      'CDBG',
      'street improvements',
      'PER',
      'asphalt overlay',
      'chip and seal',
      'construction',
      '8,781 LF',
    ],
    facts: [
      'The project proceeded from CDBG preliminary engineering through funding, design, and construction.',
      'Work included 8,781 LF of two-inch BP1 asphalt overlay and chip and seal, completed within two years.',
    ],
    provenance: [
      {
        sourceDoc: 'palmyra_modot_tap_soq.pdf',
        sourceTitle: PALMYRA_TITLE,
        page: 15,
        quote:
          'Preparation of CDBG PER, followed by funding, design, and construction. Project included 8,781 LF of 2” BP1 asphalt overlay and Chip and Seal. Project was completed within 2 years.',
      },
      {
        sourceDoc: 'palmyra_modot_tap_soq.pdf',
        sourceTitle: PALMYRA_TITLE,
        page: 15,
        quote: 'CDBG Street Improvements',
      },
      {
        sourceDoc: 'palmyra_modot_tap_soq.pdf',
        sourceTitle: PALMYRA_TITLE,
        page: 15,
        quote: 'City of Pilot Grove Pilot Grove, MO',
      },
    ],
  },
] as const satisfies readonly FirmProject[];
