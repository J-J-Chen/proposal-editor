import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FIRM_PROJECTS, KB_SOURCE_DOCUMENTS } from '@/kb/corpus';
import { FIRM_VOICE } from '@/kb';
import { resolveVoiceGuidance } from '@/kb/voice-guidance';
import { searchFirmProjects } from '@/kb/retrieval';
import { buildKbTemplate, coversSelectedProject } from '@/lib/kb-compose';
import { checkFactEntityGate } from '@/lib/voice-gate';
import {
  REQUEST_INPUT_LIMITS,
  validChatHistory,
  validDocumentBlocks,
  validDocumentContext,
  validEditBlock,
  validSuggestionDoc,
} from '@/lib/request-validation';
import { scanForRefinements } from '@/refine/scan';
import type { Block, Doc, KbProvenance } from '@/lib/types';
import { editorReducer, initialEditorState, type Pending } from '@/state/editor';

const expectedSources = [
  'hannibal_demolition_soq.pdf',
  'macon_city_soq.pdf',
  'monroe_city_electrical_soq.pdf',
  'nemo_rpc_bridge_soq.pdf',
  'palmyra_modot_tap_soq.pdf',
];

function testCorpusBoundary() {
  const actual = KB_SOURCE_DOCUMENTS.map((source) => source.filename);
  assert.deepEqual(actual, expectedSources, 'the product KB must be exactly the five examples');
  assert.equal(new Set(actual).size, 5, 'source filenames must be unique');

  const serialized = JSON.stringify({ sources: KB_SOURCE_DOCUMENTS, projects: FIRM_PROJECTS });
  assert.doesNotMatch(serialized, /(?:easy|hard)\.pdf/i, 'easy/hard are fixtures, not KB sources');
  assert.doesNotMatch(serialized, /(?:^|\D)001-\d{3,4}(?:\D|$)/, 'cover ids are not projects');

  const allow = new Set(expectedSources);
  assert.ok(FIRM_PROJECTS.length >= 10, 'the five documents should yield a useful project set');
  for (const project of FIRM_PROJECTS) {
    assert.ok(project.id && project.title && project.client && project.location);
    assert.ok(project.facts.length > 0 && project.provenance.length > 0);
    for (const fact of project.facts) {
      assert.doesNotMatch(
        fact,
        /\b(?:the source|the proposal)\b/i,
        `${project.id} fallback facts must read as proposal prose, not audit commentary`,
      );
    }
    for (const provenance of project.provenance) {
      assert.ok(allow.has(provenance.sourceDoc), `${project.id} has an unapproved source`);
      assert.ok(provenance.page > 0 && provenance.quote.length > 20);
    }
  }
}

function topId(query: string): string | undefined {
  return searchFirmProjects(query, { k: 3 })[0]?.candidateId;
}

function testRetrieval() {
  assert.equal(topId('a prestressed concrete bridge we have done'), 'marion-county-taylor-bridge');
  assert.ok(
    searchFirmProjects('bridges').some(
      (candidate) => candidate.candidateId === 'marion-county-taylor-bridge',
    ),
    'natural plural queries must match singular corpus terms',
  );
  assert.equal(topId('electrical distribution upgrades'), 'hunnewell-electric-distribution-upgrade');
  assert.equal(topId('demolition structural investigation'), 'barry-demolition-structural-investigation');
  assert.equal(topId('pedestrian bike trail'), 'jefferson-city-sidewalk-trail-system');
  assert.equal(topId('ion exchange water softening plant'), 'pittsfield-water-supply-treatment');
  assert.deepEqual(searchFirmProjects('quasar orchard cryptography'), []);

  const excluded = searchFirmProjects('bridge', {
    k: 5,
    excludeSourceDoc: 'nemo_rpc_bridge_soq.pdf',
  });
  assert.ok(excluded.every((candidate) => candidate.sourceDoc !== 'nemo_rpc_bridge_soq.pdf'));
}

function testVoiceIsolation() {
  const known = resolveVoiceGuidance({ firm: FIRM_VOICE.firm });
  assert.equal(known.source, 'firm-kb');
  assert.match(known.profileId, /\S/);
  assert.match(known.profileVersion, /\S/);
  assert.equal(
    resolveVoiceGuidance({ firm: 'MECO' }).source,
    'firm-kb',
    'an explicitly asserted acronym remains a positive firm identity',
  );

  const localSample =
    'Our studio approaches each civic project with a restrained narrative and carefully coordinated material palette.';
  const unknown = resolveVoiceGuidance({
    firm: 'Northstar Design Studio',
    documentText:
      'Northstar Design Studio prepared this proposal. MECO Engineering Company is one subcontractor.',
    voiceSamples: [localSample],
  });
  assert.equal(unknown.source, 'document-local', 'an unknown firm must not inherit MECO voice');
  assert.deepEqual(unknown.samples, [localSample]);

  const unlabelledReference = resolveVoiceGuidance({
    documentText:
      'Northstar Design Studio leads this proposal. MECO Engineering Company is one subcontractor.',
    voiceSamples: [localSample],
  });
  assert.equal(
    unlabelledReference.source,
    'document-local',
    'one MECO reference in an uploaded proposal is not firm identification',
  );

  const uploadedMeco = resolveVoiceGuidance({
    documentText:
      'MECO Engineering Company prepared these qualifications. MECO Engineering Company will coordinate the work.',
    voiceSamples: [localSample],
  });
  assert.equal(uploadedMeco.source, 'firm-kb', 'a repeated firm identity selects the KB profile');

  for (const documentText of [
    'Northstar Design Studio submits these qualifications. MECO Engineering Company will serve as the electrical subconsultant. Northstar will coordinate with MECO Engineering Company during design.',
    'Northstar is the prime consultant for these qualifications. MECO Engineering Company is our electrical subconsultant, and the team includes MECO Engineering Company.',
    'Northstar Design Studio submits these qualifications. MECO Engineering Company prepared the electrical design. Our team selected MECO Engineering Company for specialty services.',
    'Northstar Design Studio is pleased to submit this proposal. MECO Engineering Company provides electrical design. Northstar will coordinate with MECO Engineering Company.',
    'Northstar submits this proposal. Past experience by MECO Engineering Company prepared the team, and resume references MECO Engineering Company.',
    'MECO Engineering Company prepared the electrical design for this proposal. Our team selected MECO Engineering Company as a subconsultant.',
    'MECO Engineering Company prepared electrical drawings included in this proposal. Northstar selected MECO Engineering Company for specialty services.',
    'MECO Engineering Company prepared portions of these qualifications. Northstar retained MECO Engineering Company as its electrical consultant.',
    'Northstar Design Studio is the prime consultant and author of this proposal. MECO Engineering Company prepared the electrical design for this proposal. Northstar selected MECO Engineering Company as its electrical engineer.',
  ]) {
    assert.equal(
      resolveVoiceGuidance({ documentText, voiceSamples: [localSample] }).source,
      'document-local',
      'repeated legal-name references to a subconsultant must not select its firm voice',
    );
  }
  for (const documentText of [
    'MECO Engineering Company prepared and submits these qualifications. MECO Engineering Company will coordinate with ABC Design, its electrical subconsultant.',
    'MECO Engineering Company prepared this proposal. MECO Engineering Company provides civil design and will engage Northstar as electrical subconsultant.',
    'MECO Engineering Company, Inc. (MECO) is pleased to present qualifications. MECO Engineering Company, Inc. will coordinate the work.',
  ]) {
    assert.equal(
      resolveVoiceGuidance({ documentText, voiceSamples: [localSample] }).source,
      'firm-kb',
      'another firm serving as the proposer’s subconsultant must not disqualify the proposer voice',
    );
  }

  const repeatedSubconsultant = resolveVoiceGuidance({
    documentText:
      'Northstar Design Studio submits these qualifications. MECO will serve as electrical subconsultant. Our team will coordinate with MECO during design.',
    voiceSamples: [localSample],
  });
  assert.equal(
    repeatedSubconsultant.source,
    'document-local',
    'repeated acronym-only subcontractor mentions must not identify the proposing firm',
  );

  for (const unrelatedFirm of ['SomeCompany', 'AcmeCo']) {
    const embeddedAlias = resolveVoiceGuidance({
      documentText: `${unrelatedFirm} designed it. ${unrelatedFirm} delivered it.`,
    });
    assert.equal(
      embeddedAlias.source,
      'conservative',
      `MECO inside ${unrelatedFirm} must not select the firm profile`,
    );
  }

  const promptable = JSON.stringify(known);
  assert.doesNotMatch(promptable, /\$\d|001-\d{3}/, 'voice context must stay fact-free');
}

function testCompositionFloor() {
  const project = FIRM_PROJECTS.find((item) => item.id === 'marion-county-taylor-bridge');
  assert.ok(project);
  const template = buildKbTemplate(project);
  assert.ok(coversSelectedProject(project, template));
  assert.match(template, /\$1,075,770\.35/);
  assert.match(template, /Marion County Commission/);
  assert.ok(!coversSelectedProject(project, 'MECO has completed many successful bridge projects.'));

  const mbr = FIRM_PROJECTS.find((item) => item.id === 'lincoln-county-mbr-treatment-plant');
  assert.ok(mbr);
  const withoutScada = buildKbTemplate(mbr).replace(', and SCADA', '');
  assert.equal(
    coversSelectedProject(mbr, withoutScada),
    false,
    'dropping one selected scope anchor must force the source-only fallback',
  );
  const mbrTemplate = buildKbTemplate(mbr);
  for (const contradiction of [
    mbrTemplate.replace('Electrical work included', 'Electrical work did not include'),
    mbrTemplate.replace('Electrical work included', 'Electrical work excluded'),
    mbrTemplate.replace('Electrical work included', 'Electrical work omitted'),
    mbrTemplate.replace('Electrical work included', 'Electrical work lacked'),
    mbrTemplate.replace('Electrical work included', 'Electrical work included everything except'),
    mbrTemplate.replace('Electrical work included', 'Electrical work included everything aside from'),
    mbrTemplate.replace('Electrical work included', 'Electrical work included everything save'),
  ]) {
    assert.equal(
      coversSelectedProject(mbr, contradiction),
      false,
      'scope coverage must reject a polarity reversal and use the factual fallback',
    );
  }

  for (const [projectId, beforeToken, afterToken] of [
    ['state-fair-community-college-site', 'Type A curb and gutter', 'Type B curb and gutter'],
    ['marion-county-taylor-bridge', 'H-piling', 'P-piling'],
    ['crossing-mep-design', 'MECO A/E', 'MECO M/E'],
  ] as const) {
    const selected = FIRM_PROJECTS.find((item) => item.id === projectId);
    assert.ok(selected);
    assert.equal(
      coversSelectedProject(
        selected,
        buildKbTemplate(selected).replace(beforeToken, afterToken),
      ),
      false,
      `${projectId} must preserve its one-letter technical distinction`,
    );
  }
}

function testHardFactGate() {
  const before =
    'We designed the work for Northstar County Authority with a budget of $2,400,000 in 2024.';
  assert.ok(
    checkFactEntityGate({
      before,
      after: before,
      authoritativeInstruction: 'Tighten this sentence.',
    }).ok,
  );

  const introduced = checkFactEntityGate({
    before,
    // `24` must not be authorized merely because the source contains `2024`.
    after: `${before} The work also included 24 new pump stations.`,
    authoritativeInstruction: 'Tighten this sentence.',
  });
  assert.equal(introduced.ok, false);
  assert.ok(introduced.violations.some((violation) => violation.kind === 'introduced-number'));

  const droppedName = checkFactEntityGate({
    before,
    after: 'We designed the work with a budget of $2,400,000 in 2024.',
    authoritativeInstruction: 'Tighten this sentence.',
  });
  assert.equal(droppedName.ok, false, 'an unseen proper name must not disappear silently');

  const explicitlyUpdated = checkFactEntityGate({
    before,
    after:
      'We designed the work for Northstar County Authority with a budget of $2,500,000 in 2024.',
    authoritativeInstruction: 'Change $2,400,000 to $2,500,000.',
  });
  assert.ok(explicitlyUpdated.ok, 'the user may explicitly authorize a factual change');

  for (const authoritativeInstruction of [
    'Do not change $2,400,000.',
    "Don't change any numbers.",
    'Change the tone and keep all numbers.',
  ]) {
    const negatedDrop = checkFactEntityGate({
      before: 'The estimate is $2,400,000.',
      after: 'The estimate is not listed.',
      authoritativeInstruction,
    });
    assert.equal(negatedDrop.ok, false, 'negated instructions cannot authorize a fact drop');
  }

  assert.equal(
    checkFactEntityGate({
      before: 'The stated completion year is 2024.',
      after: 'The completion year is unstated.',
      authoritativeInstruction: 'Fix the date.',
    }).ok,
    false,
    'a vague fix-category instruction must not authorize erasing a fact',
  );
  assert.ok(
    checkFactEntityGate({
      before: 'The stated completion year is 2024.',
      after: 'The completion year is unstated.',
      authoritativeInstruction: 'Remove the date.',
    }).ok,
    'an explicit category deletion may remove that category',
  );

  const negatedAddition = checkFactEntityGate({
    before: 'The work is complete.',
    after: 'The work is complete and includes 24 pump stations.',
    authoritativeInstruction: 'Do not add 24 pump stations.',
  });
  assert.equal(negatedAddition.ok, false, 'mentioning a forbidden fact cannot authorize it');

  const unrelatedIntent = checkFactEntityGate({
    before: 'The work is complete.',
    after: 'The work is complete and includes 24 pump stations.',
    authoritativeInstruction: 'Keep 24 unchanged and add clarity to the sentence.',
  });
  assert.equal(unrelatedIntent.ok, false, 'an unrelated edit verb cannot authorize a quoted fact');

  const explicitAddition = checkFactEntityGate({
    before: 'The work is complete.',
    after: 'The work is complete and includes 24 pump stations.',
    authoritativeInstruction: 'Add that the work includes 24 pump stations.',
  });
  assert.ok(explicitAddition.ok, 'a positive, explicit user instruction can authorize a fact');

  for (const [authoritativeInstruction, beforeText, afterText] of [
    ['Change the tone while preserving 2024.', 'The work was completed in 2024.', 'The work was completed.'],
    ['Add 24 pump stations, not 25.', 'The work is complete.', 'The work is complete with 25 pump stations.'],
    ['Add 24 pump stations rather than 25.', 'The work is complete.', 'The work is complete with 25 pump stations.'],
    ['Change 2024, not 2025.', 'The work spans 2024 and 2025.', 'The work spans 2024.'],
  ] as const) {
    assert.equal(
      checkFactEntityGate({
        before: beforeText,
        after: afterText,
        authoritativeInstruction,
      }).ok,
      false,
      `negative or retaining language must not authorize a fact mutation: ${authoritativeInstruction}`,
    );
  }

  for (const [authoritativeInstruction, beforeText, afterText] of [
    ['Update the tone with no change to 2024.', 'The work was completed in 2024.', 'The work was completed.'],
    ['Add 24 pump stations with no 25-year warranty.', 'The work is complete.', 'The work includes a 25-year warranty.'],
    ['Add 24 and omit 25.', 'The work is complete.', 'The work includes 25 items.'],
    ['Add 24, other than 25.', 'The work is complete.', 'The work includes 25 items.'],
    ['25 should be excluded.', 'The work is complete.', 'The work includes 25 items.'],
    ['25 should be omitted.', 'The work is complete.', 'The work includes 25 items.'],
    ['25 must be removed.', 'The work is complete.', 'The work includes 25 items.'],
  ] as const) {
    assert.equal(
      checkFactEntityGate({
        before: beforeText,
        after: afterText,
        authoritativeInstruction,
      }).ok,
      false,
      `exclusion language must not authorize a mutation: ${authoritativeInstruction}`,
    );
  }

  assert.ok(
    checkFactEntityGate({
      before: 'The work is complete.',
      after: 'The work is complete. The new value is 25.',
      authoritativeInstruction: '25 should be the new value.',
    }).ok,
    'an affirmative passive assignment may authorize its exact value',
  );

  for (const [authoritativeInstruction, beforeText, afterText] of [
    ['Remove every date except 2024.', 'The project was completed in 2024.', 'The project was completed.'],
    ['Delete all years other than 2024.', 'The project was completed in 2024.', 'The project was completed.'],
    ['Remove every client except City of Dixon.', 'The client is City of Dixon.', 'The client is unstated.'],
    ['Change every year besides 2024.', 'Completed in 2024.', 'Completed.'],
    ['Change every year apart from 2024.', 'Completed in 2024.', 'Completed.'],
    ['Change all names with the exception of City of Dixon.', 'The client is City of Dixon.', 'The client is unstated.'],
  ] as const) {
    assert.equal(
      checkFactEntityGate({ before: beforeText, after: afterText, authoritativeInstruction }).ok,
      false,
      `an explicit exception must override a generic deletion: ${authoritativeInstruction}`,
    );
  }

  for (const [beforeText, afterText] of [
    ['The design value is -5 feet.', 'The design value is 5 feet.'],
    ['The design value is +25 percent.', 'The design value is 25 percent.'],
    ['The construction amount is -$2,400.', 'The construction amount is $2,400.'],
    ['The treatment capacity is .5 MGD.', 'The treatment capacity is 5 MGD.'],
    ['The project uses 30-inch pipe.', 'The project uses 30-foot pipe.'],
    ['The service is 12 kV.', 'The service is 12 V.'],
    ['The tank stores 5 gallons.', 'The tank stores 5 barrels.'],
  ] as const) {
    assert.equal(
      checkFactEntityGate({
        before: beforeText,
        after: afterText,
        authoritativeInstruction: 'Tighten this sentence.',
      }).ok,
      false,
      `sign, decimal, or engineering-unit corruption must be blocked: ${beforeText} → ${afterText}`,
    );
  }

  for (const [beforeText, afterText, authoritativeInstruction] of [
    [
      'The project includes 24 pump stations.',
      'The project includes 25 pump stations.',
      'Change 24 to 25.',
    ],
    ['The service is 12 kV.', 'The service is 13 kV.', 'Change 12 to 13.'],
    [
      'The budget is $2.4 million.',
      'The budget is $2.5 million.',
      'Change $2.4 to $2.5.',
    ],
  ] as const) {
    assert.ok(
      checkFactEntityGate({ before: beforeText, after: afterText, authoritativeInstruction }).ok,
      `an explicit numeric change may retain its unchanged adjacent unit: ${authoritativeInstruction}`,
    );
  }

  for (const [beforeText, afterText, authoritativeInstruction] of [
    ['The main is 30".', "The main is 30'.", 'Change 30 inches to 30 feet.'],
    [
      'The main is 30".',
      "The main is 30'.",
      'Replace the 30-inch dimension with 30 feet.',
    ],
    ['The work uses Type “A” curb.', 'The work uses Type “B” curb.', 'Change Type A to Type B.'],
  ] as const) {
    assert.ok(
      checkFactEntityGate({ before: beforeText, after: afterText, authoritativeInstruction }).ok,
      `natural-language aliases may authorize compact PDF notation: ${authoritativeInstruction}`,
    );
  }

  for (const [reference, after, authoritativeInstruction] of [
    [
      'We will perform work for City of Dixon.',
      'We will perform work for City of Dixon.',
      'Put the client name back.',
    ],
    [
      'We will perform work for Northstar County Authority.',
      'We will perform work for Northstar County Authority.',
      'Restore the client name.',
    ],
  ] as const) {
    assert.ok(
      checkFactEntityGate({
        before: 'We will perform work.',
        after,
        authoritativeInstruction,
        authoritativeReference: reference,
      }).ok,
      `an explicit restore may recover a fact from original document wording: ${authoritativeInstruction}`,
    );
  }
  assert.equal(
    checkFactEntityGate({
      before: 'We will perform work.',
      after: 'We will perform work for City of Dixon.',
      authoritativeInstruction: 'Make it warmer.',
      authoritativeReference: 'We will perform work for City of Dixon.',
    }).ok,
    false,
    'reference wording is not factual authority without an explicit restore ask',
  );
  for (const [authoritativeInstruction, after, reference] of [
    [
      'Rather than restore the client name, make it warmer.',
      'We will perform work for City of Dixon.',
      'We will perform work for City of Dixon.',
    ],
    [
      'Restore all names except the client name.',
      'We will perform work for City of Dixon.',
      'We will perform work for City of Dixon.',
    ],
    ['Restore all facts except the date.', 'Completed in 2024.', 'Completed in 2024.'],
    ['Put all numbers back other than the pump count.', 'Includes 24 pumps.', 'Includes 24 pumps.'],
    [
      'Restore the client name, not City of Dixon.',
      'We will perform work for City of Dixon.',
      'We will perform work for City of Dixon.',
    ],
    [
      'Restore a client other than City of Dixon.',
      'We will perform work for City of Dixon.',
      'We will perform work for City of Dixon.',
    ],
    [
      'Restore all names except City of Dixon.',
      'We will perform work for City of Dixon.',
      'We will perform work for City of Dixon.',
    ],
    ['Restore all dates besides 2024.', 'Completed in 2024.', 'Completed in 2024.'],
    ['Restore all dates apart from 2024.', 'Completed in 2024.', 'Completed in 2024.'],
    [
      'Restore all names with the exception of City of Dixon.',
      'We will perform work for City of Dixon.',
      'We will perform work for City of Dixon.',
    ],
  ] as const) {
    assert.equal(
      checkFactEntityGate({
        before: 'We will perform work.',
        after,
        authoritativeInstruction,
        authoritativeReference: reference,
      }).ok,
      false,
      `a contrasted or excepted restore must not grant authority: ${authoritativeInstruction}`,
    );
  }
  for (const [before, after, authoritativeInstruction, authoritativeReference] of [
    ['Completed in 2024.', 'Completed.', 'I asked you not to change 2024.', undefined],
    ['Completed in 2024.', 'Completed.', 'You are not allowed to change 2024.', undefined],
    ['Complete.', 'Complete with 25 pumps.', 'I asked you not to add 25 pumps.', undefined],
    ['Complete.', 'Complete with 25 pumps.', 'Do anything but add 25 pumps.', undefined],
    [
      'We will perform work.',
      'We will perform work for City of Dixon.',
      'I asked you not to restore the client name.',
      'We will perform work for City of Dixon.',
    ],
  ] as const) {
    assert.equal(
      checkFactEntityGate({ before, after, authoritativeInstruction, authoritativeReference }).ok,
      false,
      `indirect negation must not become factual authority: ${authoritativeInstruction}`,
    );
  }
  for (const authoritativeInstruction of [
    'Cannot change 2024.',
    "Can't change 2024.",
    "Shouldn't change 2024.",
    "Mustn't change 2024.",
    'You are not supposed to change 2024.',
    'It is forbidden to change 2024.',
  ]) {
    assert.equal(
      checkFactEntityGate({
        before: 'Completed in 2024.',
        after: 'Completed.',
        authoritativeInstruction,
      }).ok,
      false,
      `negative modal language must not authorize a drop: ${authoritativeInstruction}`,
    );
  }
  for (const authoritativeInstruction of ["Don't change 2024.", "don't remove 2024."]) {
    assert.equal(
      checkFactEntityGate({
        before: 'Completed in 2024.',
        after: 'Completed.',
        authoritativeInstruction,
      }).ok,
      false,
      `a standard apostrophe contraction must remain negated: ${authoritativeInstruction}`,
    );
  }
  assert.equal(
    checkFactEntityGate({
      before: 'The work is complete.',
      after: 'The work includes 25 pumps.',
      authoritativeInstruction: "Don't add 25 pumps.",
    }).ok,
    false,
    "don't must not authorize an addition",
  );

  for (const authoritativeInstruction of [
    'Change the sentence "The work finished in 2024" to be shorter.',
    'Change the tone of "The work finished in 2024".',
    'Update the sentence "The work finished in 2024" for clarity.',
    'Fix grammar in "The work finished in 2024".',
    'Correct the sentence "The work finished in 2024".',
    'Change the sentence about 2024 to be more concise.',
    'Fix the grammar around 2024.',
  ]) {
    assert.equal(
      checkFactEntityGate({
        before: 'The work finished in 2024.',
        after: 'The work finished.',
        authoritativeInstruction,
      }).ok,
      false,
      `a fact embedded in a quoted reference sentence is not a mutation target: ${authoritativeInstruction}`,
    );
  }
  assert.equal(
    checkFactEntityGate({
      before: 'The 30" main serves the site.',
      after: 'The main serves the site.',
      authoritativeInstruction: 'Change the wording around the 30-inch main to be clearer.',
    }).ok,
    false,
    'a fact used to identify surrounding wording is not itself a mutation target',
  );
  for (const authoritativeInstruction of [
    'Update the sentence about City of Dixon.',
    'Fix the wording around City of Dixon.',
    'Change our description of City of Dixon.',
  ]) {
    assert.equal(
      checkFactEntityGate({
        before: 'The client is City of Dixon.',
        after: 'The client is unstated.',
        authoritativeInstruction,
      }).ok,
      false,
      `a name used to identify surrounding wording is not a mutation target: ${authoritativeInstruction}`,
    );
  }
  assert.ok(
    checkFactEntityGate({
      before: 'The work finished in 2024.',
      after: 'The work finished in 2025.',
      authoritativeInstruction: 'Change "2024" to "2025".',
    }).ok,
    'a quote containing exactly the old/new value may authorize that explicit change',
  );

  for (const authoritativeInstruction of [
    'Do not, under any circumstances whatsoever, remove "2024".',
    'Never, even if the rest of the wording changes substantially, remove "2024".',
    'Keep all facts exactly as they are and do not under any circumstances at all remove the quoted value "2024".',
    'Remove all but "2024".',
    'Remove everything but "2024".',
    'Remove anything but "2024".',
  ]) {
    assert.equal(
      checkFactEntityGate({
        before: 'The work finished in 2024.',
        after: 'The work finished.',
        authoritativeInstruction,
      }).ok,
      false,
      `a negated or excepted quoted removal must stay blocked: ${authoritativeInstruction}`,
    );
  }

  for (const authoritativeInstruction of [
    'Change the tone and 2024 should remain unchanged.',
    'Update the tone, and 2024 must stay the same.',
    'Fix the grammar and 2024 is to remain unchanged.',
  ]) {
    assert.equal(
      checkFactEntityGate({
        before: 'Completed in 2024.',
        after: 'Completed.',
        authoritativeInstruction,
      }).ok,
      false,
      `retention language after the subject must be binding: ${authoritativeInstruction}`,
    );
  }
  for (const [beforeText, afterText, authoritativeInstruction] of [
    ['Completed in 2024.', 'Completed.', 'Rather than change 2024, make the tone warmer.'],
    ['Complete.', 'Complete in 2024.', 'Rather than add 2024, make the tone warmer.'],
    ['Completed in 2023.', 'Completed in 2024.', 'Rather than change the year to 2024, make it warmer.'],
    ['Completed in 2024.', 'Completed in 2025.', 'Rather than change 2024 to 2025, make it warmer.'],
  ] as const) {
    assert.equal(
      checkFactEntityGate({ before: beforeText, after: afterText, authoritativeInstruction }).ok,
      false,
      `a prefix contrast must not authorize a fact mutation: ${authoritativeInstruction}`,
    );
  }

  for (const authoritativeInstruction of [
    'There is no need to change 2024.',
    'There is no reason to change 2024.',
    'I did not ask you to change 2024.',
    "I didn’t ask you to remove 2024.",
    'I would not change 2024.',
    "I wouldn’t change 2024.",
    'Change nothing about 2024.',
    'Change neither 2024 nor 2025.',
    'I decline to change 2024.',
  ]) {
    assert.equal(
      checkFactEntityGate({
        before: 'Completed in 2024.',
        after: 'Completed.',
        authoritativeInstruction,
      }).ok,
      false,
      `negative construction must not authorize a fact drop: ${authoritativeInstruction}`,
    );
  }
  for (const authoritativeInstruction of [
    'I wasn’t asking you to change 2024, just shorten the sentence.',
    'I was not asking you to change 2024.',
    'I haven’t asked you to change 2024.',
    'That doesn’t mean change 2024.',
    'It isn’t necessary to change 2024.',
    'Change the dates, with 2024 left unchanged.',
    'Change the dates, with 2024 unchanged.',
    'Update dates—2024 excluded.',
  ]) {
    assert.equal(
      checkFactEntityGate({
        before: 'Completed in 2024.',
        after: 'Completed.',
        authoritativeInstruction,
      }).ok,
      false,
      `corrective or exception language must not authorize a fact drop: ${authoritativeInstruction}`,
    );
  }
  for (const authoritativeInstruction of [
    'Say nothing about 2024.',
    'State neither 2024 nor 2025.',
    'Write zero references to 2024.',
    'I did not ask you to add 2024.',
    "I didn’t ask you to add 2024.",
    'There is no need to add 2024.',
    'I decline to add 2024.',
  ]) {
    assert.equal(
      checkFactEntityGate({
        before: 'The work is complete.',
        after: 'The work is complete in 2024.',
        authoritativeInstruction,
      }).ok,
      false,
      `negative construction must not authorize a fact addition: ${authoritativeInstruction}`,
    );
  }
  for (const authoritativeInstruction of [
    'I wasn’t asking you to add 2024.',
    'I haven’t asked you to add 2024.',
    'That doesn’t mean add 2024.',
    'It isn’t necessary to add 2024.',
    'Add all dates, with 2024 excluded.',
    'Add all dates besides 2024.',
    'Add all dates apart from 2024.',
  ]) {
    assert.equal(
      checkFactEntityGate({
        before: 'The work is complete.',
        after: 'The work is complete in 2024.',
        authoritativeInstruction,
      }).ok,
      false,
      `corrective or exception language must not authorize a fact addition: ${authoritativeInstruction}`,
    );
  }

  for (const [beforeText, afterText, authoritativeInstruction] of [
    ['Completed in 2023.', 'Completed in 2024.', 'Change the year to 2024.'],
    [
      'The client is Northstar County Authority.',
      'The client is City of Dixon.',
      'Change the client name to City of Dixon.',
    ],
    ['The project includes 24 pumps.', 'The project includes 25 pumps.', 'Set the number to 25.'],
    [
      'The budget is $2.4 million.',
      'The budget is $2.5 million.',
      'Update the budget to $2.5 million.',
    ],
  ] as const) {
    assert.ok(
      checkFactEntityGate({ before: beforeText, after: afterText, authoritativeInstruction }).ok,
      `one unambiguous category value may be replaced: ${authoritativeInstruction}`,
    );
  }
  assert.equal(
    checkFactEntityGate({
      before: 'The work began in 2022 and finished in 2023.',
      after: 'The work began in 2022 and finished in 2024.',
      authoritativeInstruction: 'Change the year to 2024.',
    }).ok,
    false,
    'a category shorthand cannot choose among multiple old values',
  );

  for (const [beforeText, afterText] of [
    ['The pavement uses BP1 asphalt.', 'The pavement uses BP2 asphalt.'],
    ['The work is BRO-B087(18).', 'The work is BRO-B088(18).'],
    ['Testing follows ASTM C94.', 'Testing follows ASTM C95.'],
    ['The corridor follows US54.', 'The corridor follows US55.'],
    ['The design uses Type A curb.', 'The design uses Type B curb.'],
    ['The foundation uses H-piling.', 'The foundation uses P-piling.'],
    ['MECO A/E provided design.', 'MECO M/E provided design.'],
    ['The pressure is 50 psi.', 'The pressure is 50 psf.'],
    ['The route follows Route H.', 'The route follows Route P.'],
    ['The team selected Option A.', 'The team selected Option B.'],
    ['The work includes Building A.', 'The work includes Building B.'],
    ['The milestone is Schedule A.', 'The milestone is Schedule B.'],
    ['The amount is 2.4 million dollars.', 'The amount is 2.4 billion dollars.'],
    ['The design speed is 50 mph.', 'The design speed is 50 kph.'],
    ['The temperature is 25 °C.', 'The temperature is 25 °F.'],
    ['The equipment runs at 1,800 rpm.', 'The equipment runs at 1,800 rph.'],
    ['The frequency is 60 Hz.', 'The frequency is 60 kHz.'],
    ['MECO investigated two buildings in Barry.', 'MECO investigated three buildings in Barry.'],
    ['The design includes five-foot-wide sidewalks.', 'The design includes six-foot-wide sidewalks.'],
    ['The work uses Type “A” curb and gutter.', 'The work uses Type “B” curb and gutter.'],
    ['The project includes a 30" raw-water main.', "The project includes a 30' raw-water main."],
    ['The design includes 4” PCC sidewalks.', 'The design includes 4’ PCC sidewalks.'],
    ['The client is Harbison-Walker Refractories Company.', 'The client is Harrison-Walker Refractories Company.'],
    ['The trail connects to Wear’s Creek Trail.', 'The trail connects to Bear’s Creek Trail.'],
    ['Boonville received project funding.', 'Palmyra received project funding.'],
  ] as const) {
    assert.equal(
      checkFactEntityGate({
        before: beforeText,
        after: afterText,
        authoritativeInstruction: 'Tighten this sentence.',
      }).ok,
      false,
      `technical token corruption must be blocked: ${beforeText} → ${afterText}`,
    );
  }
  for (const [beforeText, afterText] of [
    ['The project is in Boonville.', 'The project is in Palmyra.'],
    ['The client is Ameren.', 'The client is Evergy.'],
    ['MECO provided services for Hannibal.', 'MECO provided services for Macon.'],
    ['The system serves Quincy, Illinois.', 'The system serves Fulton, Illinois.'],
    ['The work is located in St. Louis.', 'The work is located in St. Charles.'],
    ['Boonville is the project location.', 'Palmyra is the project location.'],
    ['Boonville will receive the sidewalk improvements.', 'Palmyra will receive the sidewalk improvements.'],
    ['Boonville has a completed trail system.', 'Palmyra has a completed trail system.'],
  ] as const) {
    assert.equal(
      checkFactEntityGate({
        before: beforeText,
        after: afterText,
        authoritativeInstruction: 'Tighten this sentence.',
      }).ok,
      false,
      `a contextual single-word client/place mutation must be blocked: ${beforeText} → ${afterText}`,
    );
  }
  for (const [beforeText, afterText] of [
    ['Boonville is the project location.', 'The project is located in Boonville.'],
    ['The project is located in Boonville.', 'Boonville is the project location.'],
    ['Ameren is the client for this work.', 'The client is Ameren.'],
    ['The client is Ameren.', 'Ameren is the client for this work.'],
  ] as const) {
    assert.ok(
      checkFactEntityGate({
        before: beforeText,
        after: afterText,
        authoritativeInstruction: 'Make this more concise.',
      }).ok,
      `moving an unchanged name into or out of labeled context must remain allowed: ${beforeText} → ${afterText}`,
    );
  }
  for (const authoritativeInstruction of [
    "Keep the original reference 'change 2024'; tighten it.",
    'Keep the original reference ‘change 2024’; tighten it.',
    'Keep the original reference `change 2024`; tighten it.',
  ]) {
    assert.equal(
      checkFactEntityGate({
        before: 'Completed in 2024.',
        after: 'Completed.',
        authoritativeInstruction,
      }).ok,
      false,
      `control verbs in quoted reference data must not become authority: ${authoritativeInstruction}`,
    );
  }
}

function testDeterministicRefineGateCompatibility() {
  const casingText = 'Our project manager is scott vogler, pe for this assignment.';
  const casingDoc: Doc = {
    id: 'casing',
    filename: 'fixture.pdf',
    blocks: [{ id: 'casing-block', type: 'paragraph', page: 1, text: casingText }],
  };
  const casing = scanForRefinements(casingDoc)[0];
  assert.ok(casing && casing.category === 'casing');
  assert.ok(
    checkFactEntityGate({
      before: casingText,
      after: 'Our project manager is Scott Vogler, PE for this assignment.',
      authoritativeInstruction: casing.instruction,
    }).ok,
    'the built-in casing fix must allow case-only restyling',
  );
  assert.equal(
    checkFactEntityGate({
      before: casingText,
      after: 'Our project manager is Scott Wagner, PE for this assignment.',
      authoritativeInstruction: casing.instruction,
    }).ok,
    false,
    'a casing instruction must not authorize a different person',
  );
  assert.equal(
    checkFactEntityGate({
      before: casingText,
      after: 'Our project manager leads this assignment.',
      authoritativeInstruction: casing.instruction,
    }).ok,
    false,
    'a casing instruction must not authorize deleting the person',
  );
  assert.equal(
    checkFactEntityGate({
      before: casingText,
      after:
        'Our project manager is scott vogler, pe for this assignment. Scott Vogler, PE will also serve.',
      authoritativeInstruction: casing.instruction,
    }).ok,
    false,
    'a surviving lowercase value must not authorize an extra capitalized copy',
  );

  const placeholder =
    '[This is a lengthy unfinished proposal field requiring INSERT project details including schedule milestone 2024]';
  const placeholderText = `Project schedule: ${placeholder}`;
  const placeholderDoc: Doc = {
    id: 'placeholder',
    filename: 'fixture.pdf',
    blocks: [{ id: 'placeholder-block', type: 'paragraph', page: 1, text: placeholderText }],
  };
  const cleanup = scanForRefinements(placeholderDoc)[0];
  assert.ok(cleanup && cleanup.category === 'placeholder');
  assert.equal(cleanup.evidence, placeholder, 'deterministic evidence remains a verbatim span');
  assert.match(cleanup.instruction, /2024/, 'the executable instruction keeps the full span');
  assert.ok(
    checkFactEntityGate({
      before: placeholderText,
      after: 'Project schedule:',
      authoritativeInstruction: cleanup.instruction,
    }).ok,
    'removing a fully quoted placeholder may remove facts contained in that placeholder',
  );
  for (const placeholderValue of ['2024', '2500000']) {
    const compactPlaceholder = `[INSERT ${placeholderValue}]`;
    const before = `Placeholder: ${compactPlaceholder}`;
    const [suggestion] = scanForRefinements({
      id: `placeholder-${placeholderValue}`,
      filename: 'fixture.pdf',
      blocks: [{ id: 'placeholder-block', type: 'paragraph', page: 1, text: before }],
    });
    assert.ok(suggestion);
    assert.equal(
      checkFactEntityGate({
        before,
        after: `${before} The project value is ${placeholderValue}.`,
        authoritativeInstruction: suggestion.instruction,
      }).ok,
      false,
      'an intent word inside quoted placeholder data must not authorize duplicating its fact',
    );
  }

  const compositeFollowUp =
    'This is a follow-up refinement. Apply this to the current draft: Make it shorter. ' +
    'For reference, the original text was:\n"""Project update 2024 included pump improvements."""';
  assert.equal(
    checkFactEntityGate({
      before: 'Project update 2024 included pump improvements.',
      after: 'Project update included pump improvements.',
      authoritativeInstruction: compositeFollowUp,
    }).ok,
    false,
    'mutation-looking words inside quoted original text must remain reference data',
  );
  assert.equal(
    checkFactEntityGate({
      before: 'Project update 2024 included pump improvements.',
      after: 'Project update included pump improvements.',
      authoritativeInstruction: 'Make it shorter',
    }).ok,
    false,
    'a raw follow-up that does not name a fact must not authorize dropping it',
  );

  for (const authoritativeInstruction of [
    'Remove fluff and preserve "2024".',
    'Remove repetition while keeping "2024" unchanged.',
  ]) {
    assert.equal(
      checkFactEntityGate({
        before: 'The work was completed in 2024.',
        after: 'The work was completed.',
        authoritativeInstruction,
      }).ok,
      false,
      `a retained quoted value must not be treated as a removal target: ${authoritativeInstruction}`,
    );
  }
}

function testInsertHistory() {
  const original: Block = {
    id: 'target',
    type: 'paragraph',
    page: 2,
    text: 'Our relevant experience is summarized below.',
  };
  const doc: Doc = { id: 'doc', filename: 'easy.pdf', blocks: [original] };
  const project = FIRM_PROJECTS.find((item) => item.id === 'marion-county-taylor-bridge');
  assert.ok(project);
  const text = buildKbTemplate(project);
  const evidence = project.provenance[0];
  const provenance: KbProvenance = {
    candidateId: project.id,
    title: project.title,
    sourceDoc: evidence.sourceDoc,
    sourceTitle: evidence.sourceTitle,
    page: evidence.page,
    quote: evidence.quote,
    discipline: project.disciplines[0],
    fallbackUsed: true,
  };
  const inserted: Block = {
    id: 'kb-insert',
    type: 'paragraph',
    page: 2,
    text,
    provenance,
  };
  const pending: Pending = {
    blockId: original.id,
    before: '',
    after: text,
    instruction: `Add similar experience: ${project.title}`,
    changeSummary: `Added similar experience: ${project.title}`,
    grounding: { reason: 'Human-selected project.', evidence: evidence.quote, provenance },
    source: 'kb',
    insert: { afterId: original.id, block: inserted, provenance },
    protectedKept: [],
    baseCursor: 0,
    docId: doc.id,
  };

  let state = editorReducer(initialEditorState, { type: 'LOAD_DOC', doc });
  state = editorReducer(state, { type: 'SET_PENDING', pending });
  state = editorReducer(state, { type: 'KEEP_PENDING' });
  assert.equal(state.doc?.blocks.length, 2);
  assert.equal(state.history[0]?.source, 'kb');
  assert.equal(state.doc?.blocks[1]?.provenance?.candidateId, project.id);

  state = editorReducer(state, { type: 'UNDO' });
  assert.deepEqual(state.doc?.blocks.map((block) => block.id), ['target']);
  state = editorReducer(state, { type: 'REDO' });
  assert.deepEqual(state.doc?.blocks.map((block) => block.id), ['target', 'kb-insert']);
  assert.equal(state.doc?.blocks[1]?.provenance?.candidateId, project.id);

  const rewrite: Pending = {
    blockId: inserted.id,
    before: text,
    after: `${text} Additional reviewed wording.`,
    instruction: 'Add the requested wording.',
    source: 'user',
    protectedKept: [],
    baseCursor: state.cursor,
    docId: doc.id,
  };
  state = editorReducer(state, { type: 'SET_PENDING', pending: rewrite });
  state = editorReducer(state, { type: 'KEEP_PENDING' });
  assert.equal(
    state.doc?.blocks[1]?.provenance,
    undefined,
    'a later rewrite must clear a citation that no longer proves the live wording',
  );
  state = editorReducer(state, { type: 'UNDO' });
  assert.equal(
    state.doc?.blocks[1]?.provenance?.candidateId,
    project.id,
    'undoing the later rewrite restores the insertion citation',
  );
  state = editorReducer(state, { type: 'REDO' });
  assert.equal(state.doc?.blocks[1]?.provenance, undefined, 'redo clears the stale citation again');

  let discarded = editorReducer(initialEditorState, { type: 'LOAD_DOC', doc });
  discarded = editorReducer(discarded, { type: 'SET_PENDING', pending });
  discarded = editorReducer(discarded, { type: 'DISCARD_PENDING' });
  assert.equal(discarded.doc?.blocks.length, 1);
  assert.equal(discarded.history.length, 0);
}

function testPublicInputBounds() {
  const block: Block = { id: 'block-1', type: 'paragraph', page: 1, text: 'Bounded text.' };
  assert.ok(validEditBlock(block));
  assert.ok(validDocumentBlocks([block]));
  assert.ok(validSuggestionDoc({ id: 'doc-1', filename: 'proposal.pdf', blocks: [block] }));
  assert.ok(
    validDocumentContext({
      headings: ['Approach'],
      firm: 'Northstar Engineering',
      docId: 'doc-1',
      voiceSamples: ['A'.repeat(120)],
      docText: 'Document context.',
    }),
  );

  assert.equal(
    validEditBlock({ ...block, text: 'x'.repeat(REQUEST_INPUT_LIMITS.maxBlockTextChars + 1) }),
    false,
    'edit prompts reject oversized blocks before a model call',
  );
  assert.equal(
    validDocumentContext({
      headings: [
        'x'.repeat(REQUEST_INPUT_LIMITS.maxHeadingChars),
        'y'.repeat(REQUEST_INPUT_LIMITS.maxHeadingCharsTotal),
      ],
    }),
    false,
    'heading context has an aggregate cap, not only a per-heading cap',
  );
  assert.equal(
    validDocumentContext({
      headings: [],
      docText: 'x'.repeat(REQUEST_INPUT_LIMITS.maxDocTextChars + 1),
    }),
    false,
    'resolver-only whole-document context is bounded too',
  );
  assert.equal(
    validDocumentBlocks([
      { ...block, id: 'a', text: 'x'.repeat(REQUEST_INPUT_LIMITS.maxBlockTextChars) },
      { ...block, id: 'a' },
    ]),
    false,
    'duplicate block ids are rejected at public document boundaries',
  );
  assert.equal(
    validChatHistory([
      {
        role: 'user',
        content: 'x'.repeat(REQUEST_INPUT_LIMITS.maxHistoryTurnChars + 1),
      },
    ]),
    false,
    'submitted chat history is shape- and size-bounded',
  );
}

function testGenerationPathParity() {
  const ai = readFileSync('src/lib/ai.ts', 'utf8');
  const edit = readFileSync('src/lib/edit.ts', 'utf8');
  const agent = readFileSync('src/lib/agent/index.ts', 'utf8');
  const compose = readFileSync('src/lib/kb-compose.ts', 'utf8');
  const suggest = readFileSync('src/lib/suggest.ts', 'utf8');
  const editRoute = readFileSync('src/app/api/edit/route.ts', 'utf8');
  assert.match(edit, /resolveEditVoice|resolveVoiceGuidance/);
  assert.match(agent, /runEdit/);
  assert.match(compose, /runEdit/);
  assert.match(suggest, /resolveVoiceGuidance/);
  assert.match(suggest, /firm:\s*docContext\?\.firm/);
  assert.doesNotMatch(suggest, /rawInstruction/, 'Refine models must not author factual authority');
  assert.match(suggest, /server—not you—derives the executable rewrite instruction/);
  assert.match(editRoute, /kbContext is server-managed/);
  assert.match(ai, /maxRetries:\s*0/);
  assert.match(ai, /timeout:\s*PROXY_TIMEOUT_MS/);
}

testCorpusBoundary();
testRetrieval();
testVoiceIsolation();
testCompositionFloor();
testHardFactGate();
testDeterministicRefineGateCompatibility();
testInsertHistory();
testPublicInputBounds();
testGenerationPathParity();

console.log(`KB checks passed: ${KB_SOURCE_DOCUMENTS.length} sources, ${FIRM_PROJECTS.length} projects.`);
