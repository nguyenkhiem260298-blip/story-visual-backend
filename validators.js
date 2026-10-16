/**
 * VALIDATION LOGIC
 *
 * Protects:
 * - canonical entity integrity
 * - character identity structure
 * - narrative role structure
 * - timeline references
 * - exactly 20 storyboard scenes
 *
 * IMPORTANT:
 * This validator does NOT attempt semantic AI reasoning.
 *
 * It does NOT try to decide by itself whether:
 * "Daniel Carter"
 * "the mechanic"
 * "the shop owner"
 *
 * are the same person.
 *
 * That identity resolution belongs to Gemini during
 * canonical Story Bible generation.
 */

const VALID_NARRATIVE_ROLES = new Set([
  'protagonist',
  'mainAntagonist',
  'supporting',
  'minor'
]);

const VALID_IDENTITY_CONFIDENCE = new Set([
  'confirmed',
  'inferred',
  'review_required'
]);

const VALID_IMPORTANCE = new Set([
  'primary',
  'secondary',
  'minor'
]);

// ============================================================
// BASIC HELPERS
// ============================================================

function isNonEmptyString(value) {
  return (
    typeof value === 'string' &&
    value.trim().length > 0
  );
}

function assertArray(value, errorCode) {
  if (!Array.isArray(value)) {
    throw new Error(errorCode);
  }
}

function normalizeText(value) {
  if (
    typeof value !== 'string'
  ) {
    return '';
  }

  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

// ============================================================
// CHARACTER VALIDATION
// ============================================================

function validateCharacterStructure(
  character,
  index
) {
  const label =
    `CHARACTER_${index + 1}`;

  if (
    !character ||
    typeof character !== 'object'
  ) {
    throw new Error(
      `${label}_INVALID_OBJECT`
    );
  }

  // ----------------------------------------------------------
  // CANONICAL ID
  // ----------------------------------------------------------

  if (
    !isNonEmptyString(
      character.id
    )
  ) {
    throw new Error(
      `${label}_MISSING_ID`
    );
  }

  if (
    !/^CHAR_\d{3,}$/.test(
      character.id
    )
  ) {
    throw new Error(
      `${label}_INVALID_ID_FORMAT: ${character.id}`
    );
  }

  // ----------------------------------------------------------
  // CANONICAL NAME
  // ----------------------------------------------------------

  if (
    !isNonEmptyString(
      character.name
    )
  ) {
    throw new Error(
      `${label}_MISSING_NAME`
    );
  }

  // ----------------------------------------------------------
  // IDENTITY ARRAYS
  // ----------------------------------------------------------

  assertArray(
    character.aliases,
    `${label}_ALIASES_MUST_BE_ARRAY`
  );

  assertArray(
    character.descriptiveReferences,
    `${label}_DESCRIPTIVE_REFERENCES_MUST_BE_ARRAY`
  );

  assertArray(
    character.relationships,
    `${label}_RELATIONSHIPS_MUST_BE_ARRAY`
  );

  assertArray(
    character.identityEvidence,
    `${label}_IDENTITY_EVIDENCE_MUST_BE_ARRAY`
  );

  // ----------------------------------------------------------
  // IDENTITY CONFIDENCE
  // ----------------------------------------------------------

  if (
    !VALID_IDENTITY_CONFIDENCE.has(
      character.identityConfidence
    )
  ) {
    throw new Error(
      `${label}_INVALID_IDENTITY_CONFIDENCE: ${character.identityConfidence}`
    );
  }

  // ----------------------------------------------------------
  // NARRATIVE ROLE
  // ----------------------------------------------------------

  if (
    !VALID_NARRATIVE_ROLES.has(
      character.narrativeRole
    )
  ) {
    throw new Error(
      `${label}_INVALID_NARRATIVE_ROLE: ${character.narrativeRole}`
    );
  }

  // ----------------------------------------------------------
  // IMPORTANCE
  // ----------------------------------------------------------

  if (
    !VALID_IMPORTANCE.has(
      character.importance
    )
  ) {
    throw new Error(
      `${label}_INVALID_IMPORTANCE: ${character.importance}`
    );
  }

  // ----------------------------------------------------------
  // ROLE / OCCUPATION
  // ----------------------------------------------------------

  if (
    typeof character.role !==
    'string'
  ) {
    throw new Error(
      `${label}_ROLE_MUST_BE_STRING`
    );
  }

  if (
    typeof character.occupation !==
    'string'
  ) {
    throw new Error(
      `${label}_OCCUPATION_MUST_BE_STRING`
    );
  }

  // ----------------------------------------------------------
  // KAREN FLAG
  // ----------------------------------------------------------

  if (
    typeof character.isKarenType !==
    'boolean'
  ) {
    throw new Error(
      `${label}_ISKARENTYPE_MUST_BE_BOOLEAN`
    );
  }

  // ----------------------------------------------------------
  // EXACT AGE
  // ----------------------------------------------------------
  //
  // We keep the existing frontend field "age".
  //
  // It must contain one exact numeric age.
  //
  // Accepted:
  // "42"
  // "51"
  //
  // Rejected:
  // "around 42"
  // "40-45"
  // "mid 40s"
  // "about fifty"
  //

  if (
    !isNonEmptyString(
      character.age
    )
  ) {
    throw new Error(
      `${label}_MISSING_EXACT_AGE`
    );
  }

  const ageText =
    character.age.trim();

  if (
    !/^\d{1,3}$/.test(ageText)
  ) {
    throw new Error(
      `${label}_AGE_NOT_EXACT: ${character.age}`
    );
  }

  const ageNumber =
    Number(ageText);

  if (
    !Number.isInteger(ageNumber) ||
    ageNumber < 1 ||
    ageNumber > 120
  ) {
    throw new Error(
      `${label}_AGE_OUT_OF_RANGE: ${character.age}`
    );
  }

  // ----------------------------------------------------------
  // VISUAL LOCK REQUIRED FIELDS
  // ----------------------------------------------------------

  const requiredVisualFields = [
    'gender',
    'skinTone',
    'physique',
    'faceShape',
    'eyes',
    'nose',
    'mouth',
    'jawline',
    'hairStyle',
    'hairColor',
    'facialHair',
    'clothing',
    'clothingColors',
    'footwear',
    'accessories',
    'distinguishingFeatures',
    'appearance',
    'masterCharacterLock',
    'flowReferenceName',
    'visualConfidence'
  ];

  for (
    const field
    of requiredVisualFields
  ) {
    if (
      typeof character[field] !==
      'string'
    ) {
      throw new Error(
        `${label}_${field.toUpperCase()}_MUST_BE_STRING`
      );
    }
  }

  if (
    !isNonEmptyString(
      character.masterCharacterLock
    )
  ) {
    throw new Error(
      `${label}_EMPTY_MASTER_CHARACTER_LOCK`
    );
  }

  return true;
}

// ============================================================
// CROSS-CHARACTER VALIDATION
// ============================================================

function validateCharacterRegistry(
  characters
) {
  assertArray(
    characters,
    'MISSING_CHARACTERS'
  );

  if (
    characters.length === 0
  ) {
    throw new Error(
      'EMPTY_CHARACTER_REGISTRY'
    );
  }

  characters.forEach(
    validateCharacterStructure
  );

  // ----------------------------------------------------------
  // UNIQUE CHARACTER IDS
  // ----------------------------------------------------------

  const charIdsRaw =
    characters.map(
      character =>
        character.id
    );

  if (
    new Set(charIdsRaw).size !==
    charIdsRaw.length
  ) {
    throw new Error(
      'DUPLICATE_CHARACTER_ID'
    );
  }

  // ----------------------------------------------------------
  // DUPLICATE CANONICAL NAMES
  // ----------------------------------------------------------
  //
  // This catches only an obvious duplicate:
  //
  // CHAR_001 = Daniel Carter
  // CHAR_002 = Daniel Carter
  //
  // It deliberately does NOT attempt to decide that
  // "Daniel Carter" and "the mechanic" are the same person.
  //

  const canonicalNames =
    new Map();

  characters.forEach(
    character => {
      const normalized =
        normalizeText(
          character.name
        );

      if (!normalized) {
        return;
      }

      if (
        canonicalNames.has(
          normalized
        )
      ) {
        throw new Error(
          `DUPLICATE_CANONICAL_CHARACTER_NAME: "${character.name}" appears as both ${canonicalNames.get(normalized)} and ${character.id}`
        );
      }

      canonicalNames.set(
        normalized,
        character.id
      );
    }
  );

  // ----------------------------------------------------------
  // PROTAGONIST
  // ----------------------------------------------------------
  //
  // This application is designed around one main story driver.
  //

  const protagonists =
    characters.filter(
      character =>
        character.narrativeRole ===
        'protagonist'
    );

  if (
    protagonists.length === 0
  ) {
    throw new Error(
      'MISSING_PROTAGONIST'
    );
  }

  if (
    protagonists.length > 1
  ) {
    throw new Error(
      `MULTIPLE_PROTAGONISTS: ${protagonists.map(c => `${c.id}:${c.name}`).join(', ')}`
    );
  }

  // ----------------------------------------------------------
  // MAIN ANTAGONIST
  // ----------------------------------------------------------
  //
  // Zero is allowed because some stories may have:
  // - environmental conflict
  // - institutional conflict
  // - no single human antagonist
  //
  // But if Gemini identifies a MAIN antagonist,
  // there may only be one.
  //

  const mainAntagonists =
    characters.filter(
      character =>
        character.narrativeRole ===
        'mainAntagonist'
    );

  if (
    mainAntagonists.length > 1
  ) {
    throw new Error(
      `MULTIPLE_MAIN_ANTAGONISTS: ${mainAntagonists.map(c => `${c.id}:${c.name}`).join(', ')}`
    );
  }

  // ----------------------------------------------------------
  // PRIMARY IMPORTANCE SANITY
  // ----------------------------------------------------------

  const protagonist =
    protagonists[0];

  if (
    protagonist.importance !==
    'primary'
  ) {
    throw new Error(
      `PROTAGONIST_NOT_PRIMARY: ${protagonist.id}:${protagonist.name}`
    );
  }

  if (
    mainAntagonists.length === 1 &&
    mainAntagonists[0].importance ===
      'minor'
  ) {
    throw new Error(
      `MAIN_ANTAGONIST_MARKED_MINOR: ${mainAntagonists[0].id}:${mainAntagonists[0].name}`
    );
  }

  return {
    charIds:
      new Set(charIdsRaw),

    protagonistId:
      protagonist.id,

    mainAntagonistId:
      mainAntagonists.length === 1
        ? mainAntagonists[0].id
        : null
  };
}

// ============================================================
// STORY BIBLE VALIDATION
// ============================================================

function validateBible(
  bible
) {
  if (
    !bible ||
    typeof bible !== 'object'
  ) {
    throw new Error(
      'STORY_SCHEMA_INVALID'
    );
  }

  if (!bible.analysis) {
    throw new Error(
      'MISSING_ANALYSIS'
    );
  }

  if (
    !Array.isArray(
      bible.characters
    )
  ) {
    throw new Error(
      'MISSING_CHARACTERS'
    );
  }

  if (
    !Array.isArray(
      bible.locations
    )
  ) {
    throw new Error(
      'MISSING_LOCATIONS'
    );
  }

  if (
    !Array.isArray(
      bible.props
    )
  ) {
    throw new Error(
      'MISSING_PROPS'
    );
  }

  if (
    !Array.isArray(
      bible.vehicles
    )
  ) {
    throw new Error(
      'MISSING_VEHICLES'
    );
  }

  if (
    !Array.isArray(
      bible.timeline
    )
  ) {
    throw new Error(
      'MISSING_TIMELINE'
    );
  }

  // ==========================================================
  // CHARACTER REGISTRY
  // ==========================================================

  const characterContext =
    validateCharacterRegistry(
      bible.characters
    );

  const charIds =
    characterContext.charIds;

  // ==========================================================
  // UNIQUE LOCATION IDS
  // ==========================================================

  const locIdsRaw =
    bible.locations.map(
      location =>
        location.id
    );

  if (
    new Set(locIdsRaw).size !==
    locIdsRaw.length
  ) {
    throw new Error(
      'DUPLICATE_LOCATION_ID'
    );
  }

  // ==========================================================
  // UNIQUE PROP IDS
  // ==========================================================

  const propIdsRaw =
    bible.props.map(
      prop =>
        prop.id
    );

  if (
    new Set(propIdsRaw).size !==
    propIdsRaw.length
  ) {
    throw new Error(
      'DUPLICATE_PROP_ID'
    );
  }

  // ==========================================================
  // UNIQUE VEHICLE IDS
  // ==========================================================

  const vehIdsRaw =
    bible.vehicles.map(
      vehicle =>
        vehicle.id
    );

  if (
    new Set(vehIdsRaw).size !==
    vehIdsRaw.length
  ) {
    throw new Error(
      'DUPLICATE_VEHICLE_ID'
    );
  }

  const locIds =
    new Set(locIdsRaw);

  const propIds =
    new Set(propIdsRaw);

  const vehIds =
    new Set(vehIdsRaw);

  // ==========================================================
  // TIMELINE REFERENCES
  // ==========================================================

  bible.timeline.forEach(
    (item, idx) => {

      if (
        !Array.isArray(
          item.characterIds
        )
      ) {
        throw new Error(
          `MALFORMED_TIMELINE_ITEM: characterIds must be an array at index ${idx}`
        );
      }

      if (
        !Array.isArray(
          item.propIds
        )
      ) {
        throw new Error(
          `MALFORMED_TIMELINE_ITEM: propIds must be an array at index ${idx}`
        );
      }

      if (
        !Array.isArray(
          item.vehicleIds
        )
      ) {
        throw new Error(
          `MALFORMED_TIMELINE_ITEM: vehicleIds must be an array at index ${idx}`
        );
      }

      // ------------------------------------------------------
      // CHARACTER REFERENCES
      // ------------------------------------------------------

      item.characterIds.forEach(
        id => {
          if (
            !charIds.has(id)
          ) {
            throw new Error(
              `UNKNOWN_CHARACTER: Unknown character ${id} in timeline item ${idx}`
            );
          }
        }
      );

      // ------------------------------------------------------
      // LOCATION REFERENCE
      // ------------------------------------------------------

      if (
        item.locationId &&
        !locIds.has(
          item.locationId
        )
      ) {
        throw new Error(
          `UNKNOWN_LOCATION: Unknown location ${item.locationId} in timeline item ${idx}`
        );
      }

      // ------------------------------------------------------
      // PROP REFERENCES
      // ------------------------------------------------------

      item.propIds.forEach(
        id => {
          if (
            !propIds.has(id)
          ) {
            throw new Error(
              `UNKNOWN_PROP: Unknown prop ${id} in timeline item ${idx}`
            );
          }
        }
      );

      // ------------------------------------------------------
      // VEHICLE REFERENCES
      // ------------------------------------------------------

      item.vehicleIds.forEach(
        id => {
          if (
            !vehIds.has(id)
          ) {
            throw new Error(
              `UNKNOWN_VEHICLE: Unknown vehicle ${id} in timeline item ${idx}`
            );
          }
        }
      );
    }
  );

  return {
    charIds,
    locIds,
    propIds,
    vehIds,

    protagonistId:
      characterContext.protagonistId,

    mainAntagonistId:
      characterContext.mainAntagonistId
  };
}

// ============================================================
// SCENE VALIDATION
// ============================================================

function validateScenes(
  scenesData,
  bibleContext
) {
  if (
    !scenesData ||
    !Array.isArray(
      scenesData.scenes
    )
  ) {
    throw new Error(
      'SCENE_PLAN_MODEL_FAILED'
    );
  }

  // ==========================================================
  // EXACT COUNT
  // ==========================================================

  if (
    scenesData.scenes.length !==
    20
  ) {
    throw new Error(
      'INVALID_SCENE_COUNT: Must be exactly 20 scenes'
    );
  }

  // ==========================================================
  // EXACT SEQUENCE 1-20
  // ==========================================================

  const numbers =
    scenesData.scenes
      .map(
        scene =>
          scene.sceneNumber
      )
      .sort(
        (a, b) =>
          a - b
      );

  for (
    let i = 0;
    i < 20;
    i++
  ) {
    if (
      numbers[i] !==
      i + 1
    ) {
      throw new Error(
        `INVALID_SCENE_SEQUENCE: Missing or duplicate scene number. Expected ${i + 1}, found ${numbers[i]}`
      );
    }
  }

  const {
    charIds,
    locIds,
    propIds,
    vehIds
  } = bibleContext;

  // ==========================================================
  // SCENE REFERENCES
  // ==========================================================

  scenesData.scenes.forEach(
    scene => {

      if (
        !Array.isArray(
          scene.characterIds
        )
      ) {
        throw new Error(
          `MALFORMED_SCENE: characterIds must be an array in scene ${scene.sceneNumber}`
        );
      }

      if (
        !Array.isArray(
          scene.propIds
        )
      ) {
        throw new Error(
          `MALFORMED_SCENE: propIds must be an array in scene ${scene.sceneNumber}`
        );
      }

      if (
        !Array.isArray(
          scene.vehicleIds
        )
      ) {
        throw new Error(
          `MALFORMED_SCENE: vehicleIds must be an array in scene ${scene.sceneNumber}`
        );
      }

      // ------------------------------------------------------
      // CHARACTER REFERENCES
      // ------------------------------------------------------

      scene.characterIds.forEach(
        id => {
          if (
            !charIds.has(id)
          ) {
            throw new Error(
              `UNKNOWN_CHARACTER: Unknown character ${id} in scene ${scene.sceneNumber}`
            );
          }
        }
      );

      // ------------------------------------------------------
      // LOCATION REFERENCE
      // ------------------------------------------------------

      if (
        scene.locationId &&
        !locIds.has(
          scene.locationId
        )
      ) {
        throw new Error(
          `UNKNOWN_LOCATION: Unknown location ${scene.locationId} in scene ${scene.sceneNumber}`
        );
      }

      // ------------------------------------------------------
      // PROP REFERENCES
      // ------------------------------------------------------

      scene.propIds.forEach(
        id => {
          if (
            !propIds.has(id)
          ) {
            throw new Error(
              `UNKNOWN_PROP: Unknown prop ${id} in scene ${scene.sceneNumber}`
            );
          }
        }
      );

      // ------------------------------------------------------
      // VEHICLE REFERENCES
      // ------------------------------------------------------

      scene.vehicleIds.forEach(
        id => {
          if (
            !vehIds.has(id)
          ) {
            throw new Error(
              `UNKNOWN_VEHICLE: Unknown vehicle ${id} in scene ${scene.sceneNumber}`
            );
          }
        }
      );
    }
  );

  return true;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  validateBible,
  validateScenes
};
