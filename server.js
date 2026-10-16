require('dotenv').config();

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { jsonrepair } = require('jsonrepair');
const { GoogleGenAI } = require('@google/genai');

const {
  storyBibleSchema,
  scenePlanSchema
} = require('./schemas');

const {
  validateBible,
  validateScenes
} = require('./validators');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ============================================================
// GEMINI CONFIG
// ============================================================

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

const MODEL_NAME =
  process.env.GEMINI_MODEL ||
  'gemini-3.5-flash-lite';

const TARGET_CHUNK_CHARS = 8000;

const REQUEST_TIMEOUT_MS = 180000;

const REQUEST_GAP_MS = 350;

// ============================================================
// SMALL STRUCTURED SCHEMA
// USED ONLY FOR CHUNK FACT EXTRACTION
// ============================================================
//
// IMPORTANT:
//
// We deliberately use responseSchema ONLY for the small
// chunk extraction stage.
//
// We do NOT use responseSchema for:
// - final Story Bible merge
//
// We DO use responseSchema for:
// - chunk extraction
// - final 20 scene generation
//
// This avoids the previous INVALID_ARGUMENT problem caused
// by large / deeply nested structured schemas.
//

const chunkFactsSchema = {
  type: 'object',

  properties: {
    partNumber: {
      type: 'integer'
    },

    events: {
      type: 'array',

      items: {
        type: 'object',

        properties: {
          orderWithinPart: {
            type: 'integer'
          },

          event: {
            type: 'string'
          },

          storyFunction: {
            type: 'string'
          },

          characters: {
            type: 'array',
            items: {
              type: 'string'
            }
          },

          location: {
            type: 'string'
          },

          props: {
            type: 'array',
            items: {
              type: 'string'
            }
          },

          vehicles: {
            type: 'array',
            items: {
              type: 'string'
            }
          },

          continuityFacts: {
            type: 'array',
            items: {
              type: 'string'
            }
          }
        },

        required: [
          'orderWithinPart',
          'event',
          'storyFunction',
          'characters',
          'location',
          'props',
          'vehicles',
          'continuityFacts'
        ]
      }
    },

    characterFacts: {
      type: 'array',

      items: {
        type: 'object',

        properties: {
          nameOrAlias: {
            type: 'string'
          },

          mentionType: {
            type: 'string',
            enum: [
              'proper_name',
              'alias',
              'surname',
              'descriptive_reference',
              'relationship_reference',
              'job_title',
              'unknown'
            ]
          },

          descriptiveReferences: {
            type: 'array',
            items: {
              type: 'string'
            }
          },

          roleFacts: {
            type: 'array',
            items: {
              type: 'string'
            }
          },

          occupationFacts: {
            type: 'array',
            items: {
              type: 'string'
            }
          },

          relationshipFacts: {
            type: 'array',
            items: {
              type: 'string'
            }
          },

          identityClues: {
            type: 'array',
            items: {
              type: 'string'
            }
          },

          confirmedVisualFacts: {
            type: 'array',
            items: {
              type: 'string'
            }
          }
        },

        required: [
          'nameOrAlias',
          'mentionType',
          'descriptiveReferences',
          'roleFacts',
          'occupationFacts',
          'relationshipFacts',
          'identityClues',
          'confirmedVisualFacts'
        ]
      }
    },

    locationFacts: {
      type: 'array',

      items: {
        type: 'object',

        properties: {
          name: {
            type: 'string'
          },

          facts: {
            type: 'array',
            items: {
              type: 'string'
            }
          }
        },

        required: [
          'name',
          'facts'
        ]
      }
    },

    propFacts: {
      type: 'array',

      items: {
        type: 'object',

        properties: {
          name: {
            type: 'string'
          },

          facts: {
            type: 'array',
            items: {
              type: 'string'
            }
          }
        },

        required: [
          'name',
          'facts'
        ]
      }
    },

    vehicleFacts: {
      type: 'array',

      items: {
        type: 'object',

        properties: {
          name: {
            type: 'string'
          },

          facts: {
            type: 'array',
            items: {
              type: 'string'
            }
          }
        },

        required: [
          'name',
          'facts'
        ]
      }
    }
  },

  required: [
    'partNumber',
    'events',
    'characterFacts',
    'locationFacts',
    'propFacts',
    'vehicleFacts'
  ]
};

// ============================================================
// HELPERS
// ============================================================

function sleep(ms) {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  );
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,

    new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error('UPSTREAM_TIMEOUT')
          ),
        ms
      )
    )
  ]);
}

// ============================================================
// PROJECT-SPECIFIC VISUAL DIVERSITY SEED
// ============================================================

function buildProjectVisualSeed(extractedParts) {
  const source =
    JSON.stringify(extractedParts);

  return crypto
    .createHash('sha256')
    .update(source)
    .digest('hex')
    .slice(0, 16);
}

// ============================================================
// JSON CLEANUP
// ============================================================

function cleanJsonText(text) {
  if (
    !text ||
    typeof text !== 'string'
  ) {
    return '';
  }

  let cleaned =
    text.trim();

  if (
    cleaned.startsWith('```')
  ) {
    cleaned = cleaned
      .replace(/^```json/i, '')
      .replace(/^```/i, '')
      .replace(/```$/i, '')
      .trim();
  }

  const firstBrace =
    cleaned.indexOf('{');

  const lastBrace =
    cleaned.lastIndexOf('}');

  if (
    firstBrace !== -1 &&
    lastBrace !== -1 &&
    lastBrace > firstBrace
  ) {
    cleaned =
      cleaned.slice(
        firstBrace,
        lastBrace + 1
      );
  }

  return cleaned.trim();
}

// ============================================================
// JSON PARSER WITH REPAIR FALLBACK
// ============================================================
//
// First:
// normal JSON.parse()
//
// If the model returns slightly malformed JSON:
// jsonrepair() repairs it locally.
//
// IMPORTANT:
// This does NOT call Gemini again.
// It does NOT consume another AI request.
//

function parseJsonOrThrow(
  text,
  stageName
) {
  const cleaned =
    cleanJsonText(text);

  try {
    return JSON.parse(cleaned);
  } catch (primaryErr) {
    console.warn(
      `[${stageName}_JSON_PARSE_PRIMARY_FAILED] ${primaryErr.message}`
    );

    try {
      const repaired =
        jsonrepair(cleaned);

      const parsed =
        JSON.parse(repaired);

      console.log(
        `[${stageName}_JSON_REPAIR_SUCCESS]`
      );

      return parsed;
    } catch (repairErr) {
      throw new Error(
        `${stageName}_JSON_PARSE_FAILED: ${primaryErr.message} | JSON_REPAIR_FAILED: ${repairErr.message}`
      );
    }
  }
}

// ============================================================
// ERROR HELPERS
// ============================================================

function getErrorInfo(err) {
  const rawMessage =
    err?.message ||
    String(err || '');

  const lower =
    rawMessage.toLowerCase();

  const statusMatch =
    rawMessage.match(
      /\b(400|401|403|404|408|429|500|502|503|504)\b/
    );

  const status =
    Number(
      err?.status ||
      statusMatch?.[0] ||
      0
    );

  return {
    rawMessage,
    lower,
    status,

    isTimeout:
      rawMessage ===
        'UPSTREAM_TIMEOUT' ||
      status === 408 ||
      lower.includes('timeout') ||
      lower.includes('timed out'),

    isQuota:
      status === 429 ||
      lower.includes(
        'resource_exhausted'
      ) ||
      lower.includes(
        'quota exceeded'
      ) ||
      lower.includes(
        'rate limit'
      ),

    isUnavailable:
      [
        500,
        502,
        503,
        504
      ].includes(status) ||
      lower.includes(
        'high demand'
      ) ||
      lower.includes(
        'unavailable'
      ) ||
      lower.includes(
        'overloaded'
      ),

    isInvalidKey:
      status === 401 ||
      lower.includes(
        'api_key_invalid'
      ) ||
      lower.includes(
        'api key not valid'
      ),

    isModelNotFound:
      status === 404 ||
      lower.includes(
        'model not found'
      ) ||
      lower.includes(
        'not_found'
      ),

    isBadRequest:
      status === 400 ||
      lower.includes(
        'invalid_argument'
      ) ||
      lower.includes(
        'invalid argument'
      )
  };
}

function sendMappedError(
  res,
  err,
  stageName,
  extra = {}
) {
  const info =
    getErrorInfo(err);

  if (info.isInvalidKey) {
    return res
      .status(401)
      .json({
        error:
          'API_KEY_INVALID',

        stage:
          stageName,

        detail:
          info.rawMessage,

        ...extra
      });
  }

  if (info.isQuota) {
    return res
      .status(429)
      .json({
        error:
          'USAGE_LIMIT_REACHED',

        stage:
          stageName,

        detail:
          info.rawMessage,

        ...extra
      });
  }

  if (info.isTimeout) {
    return res
      .status(504)
      .json({
        error:
          'UPSTREAM_TIMEOUT',

        stage:
          stageName,

        detail:
          info.rawMessage,

        ...extra
      });
  }

  if (
    info.isUnavailable
  ) {
    return res
      .status(503)
      .json({
        error:
          'MODEL_TEMPORARILY_UNAVAILABLE',

        stage:
          stageName,

        detail:
          info.rawMessage,

        ...extra
      });
  }

  if (
    info.isModelNotFound
  ) {
    return res
      .status(404)
      .json({
        error:
          'MODEL_NOT_FOUND',

        stage:
          stageName,

        detail:
          info.rawMessage,

        ...extra
      });
  }

  if (
    info.isBadRequest
  ) {
    return res
      .status(400)
      .json({
        error:
          'MODEL_REQUEST_INVALID',

        stage:
          stageName,

        detail:
          info.rawMessage,

        ...extra
      });
  }

  return res
    .status(500)
    .json({
      error:
        `${stageName}_FAILED`,

      stage:
        stageName,

      detail:
        info.rawMessage,

      ...extra
    });
}

// ============================================================
// GEMINI JSON CALL
// ============================================================
//
// responseSchema is optional.
//
// Chunk extraction:
//   uses small responseSchema.
//
// Bible merge:
//   no responseSchema.
//
// Scene plan:
//   uses JSON mode, then local repair + normalization.
//

async function generateJson(
  prompt,
  stageName,
  responseSchema = null
) {
  console.log(
    `[${stageName}_REQUEST_STARTED] model=${MODEL_NAME} schema=${responseSchema ? 'YES' : 'NO'}`
  );

  const config = {
    responseMimeType:
      'application/json'
  };

  if (responseSchema) {
    config.responseSchema =
      responseSchema;
  }

  const result =
    await withTimeout(
      ai.models.generateContent({
        model:
          MODEL_NAME,

        contents: [
          {
            role:
              'user',

            parts: [
              {
                text:
                  prompt
              }
            ]
          }
        ],

        config
      }),

      REQUEST_TIMEOUT_MS
    );

  if (
    !result ||
    typeof result.text !==
      'string' ||
    !result.text.trim()
  ) {
    throw new Error(
      `${stageName}_EMPTY_RESPONSE`
    );
  }

  const parsed =
    parseJsonOrThrow(
      result.text,
      stageName
    );

  console.log(
    `[${stageName}_REQUEST_SUCCESS]`
  );

  return parsed;
}

// ============================================================
// LONG SCRIPT SPLITTER
// ============================================================

function splitScriptByParagraphs(
  script,
  maxChars =
    TARGET_CHUNK_CHARS
) {
  const normalized =
    script
      .replace(
        /\r\n/g,
        '\n'
      )
      .trim();

  if (!normalized) {
    return [];
  }

  const paragraphs =
    normalized
      .split(/\n\s*\n/)
      .map(text =>
        text.trim()
      )
      .filter(Boolean);

  const chunks = [];

  let currentText = '';

  let searchCursor = 0;

  let currentStart =
    null;

  let currentEnd =
    null;

  function flush() {
    if (
      !currentText.trim()
    ) {
      return;
    }

    chunks.push({
      text:
        currentText.trim(),

      startIndex:
        currentStart,

      endIndex:
        currentEnd
    });

    currentText = '';

    currentStart =
      null;

    currentEnd =
      null;
  }

  for (
    const paragraph
    of paragraphs
  ) {
    let paragraphStart =
      normalized.indexOf(
        paragraph,
        searchCursor
      );

    if (
      paragraphStart < 0
    ) {
      paragraphStart =
        searchCursor;
    }

    const paragraphEnd =
      paragraphStart +
      paragraph.length;

    searchCursor =
      paragraphEnd;

    // --------------------------------------------------------
    // OVERSIZED SINGLE PARAGRAPH
    // --------------------------------------------------------

    if (
      paragraph.length >
      maxChars
    ) {
      flush();

      let localStart = 0;

      while (
        localStart <
        paragraph.length
      ) {
        let localEnd =
          Math.min(
            localStart +
              maxChars,
            paragraph.length
          );

        if (
          localEnd <
          paragraph.length
        ) {
          const candidate =
            paragraph.slice(
              localStart,
              localEnd
            );

          const sentenceBoundary =
            Math.max(
              candidate.lastIndexOf(
                '. '
              ),

              candidate.lastIndexOf(
                '? '
              ),

              candidate.lastIndexOf(
                '! '
              )
            );

          if (
            sentenceBoundary >
            maxChars * 0.6
          ) {
            localEnd =
              localStart +
              sentenceBoundary +
              1;
          }
        }

        chunks.push({
          text:
            paragraph
              .slice(
                localStart,
                localEnd
              )
              .trim(),

          startIndex:
            paragraphStart +
            localStart,

          endIndex:
            paragraphStart +
            localEnd
        });

        localStart =
          localEnd;
      }

      continue;
    }

    // --------------------------------------------------------
    // NORMAL PARAGRAPH PACKING
    // --------------------------------------------------------

    const candidate =
      currentText
        ? `${currentText}\n\n${paragraph}`
        : paragraph;

    if (
      currentText &&
      candidate.length >
        maxChars
    ) {
      flush();
    }

    if (!currentText) {
      currentText =
        paragraph;

      currentStart =
        paragraphStart;

      currentEnd =
        paragraphEnd;
    } else {
      currentText +=
        `\n\n${paragraph}`;

      currentEnd =
        paragraphEnd;
    }
  }

  flush();

  return chunks.map(
    (chunk, index) => ({
      ...chunk,

      partNumber:
        index + 1,

      totalParts:
        chunks.length
    })
  );
}

// ============================================================
// STAGE A
// CHUNK -> COMPACT FACTS
// ============================================================

function buildChunkFactPrompt(
  chunk
) {
  return `
YOU ARE A PRECISE LONG-STORY FACT EXTRACTION ENGINE.

You are reading PART ${chunk.partNumber} OF ${chunk.totalParts}.

This is NOT the final analysis.

Your job is to extract compact factual evidence from THIS part so the whole-story stage can later resolve character identity correctly.

==================================================
CRITICAL: DO NOT CREATE FINAL CHARACTERS HERE
==================================================

Do NOT create storyboard scenes.

Do NOT create image prompts.

Do NOT create final Character Locks.

Do NOT assign permanent CHAR_XXX IDs.

Do NOT decide the final protagonist or antagonist from this part alone.

Do NOT invent missing appearance.

Do NOT infer a final ending from this part.

Do NOT rewrite large paragraphs.

Keep output compact.

==================================================
OUTPUT RULES
==================================================

Return exactly the JSON structure required by the response schema.

For unknown event location, use:

"location": ""

Do NOT use null.

==================================================
EVENTS
==================================================

Extract only narratively meaningful events.

For every event provide:

orderWithinPart
event
storyFunction
characters
location
props
vehicles
continuityFacts

storyFunction may be:

setup
conflict
escalation
discovery
evidence
confrontation
consequence
resolution
other

The "characters" array must preserve the references used in THIS text.

Do not convert them into canonical IDs here.

==================================================
CHARACTER MENTION / IDENTITY FACTS
==================================================

This stage collects EVIDENCE for later identity resolution.

A single real person may be referred to in the script by:

- full name
- first name
- surname
- nickname
- job title
- family role
- relationship
- pronoun context
- descriptive phrase

Do NOT automatically create different people merely because the wording changes.

Also do NOT merge two references unless THIS part gives useful evidence that they are the same person.

For each character-fact entry provide:

nameOrAlias:
- preserve the most explicit reference used in this part

mentionType:
- proper_name
- alias
- surname
- descriptive_reference
- relationship_reference
- job_title
- unknown

descriptiveReferences:
- other labels used for the apparent same person inside this part
- preserve the actual wording from the story

roleFacts:
- compact facts about what this person does in the story

occupationFacts:
- explicit or strongly established work/occupation facts only

relationshipFacts:
- explicit relationships to other named people

identityClues:
- compact evidence that can later help decide whether two references are the same person
- use chronology, location, occupation, relationship, ownership, dialogue attribution, and continuous action
- do NOT write unsupported guesses

confirmedVisualFacts:
- ONLY visual facts explicitly stated or clearly established by THIS text

Do NOT invent:

age
skin tone
face
eyes
hair
clothing
body type

when this part does not provide them.

If no confirmed visual fact exists:

"confirmedVisualFacts": []

==================================================
IMPORTANT DUPLICATE-PREVENTION BEHAVIOR
==================================================

If this part introduces a named person and later refers to that same apparent person by occupation, surname, relationship, or descriptive phrase, preserve the connection in:

- descriptiveReferences
- identityClues

Do NOT create a second fictional identity merely because the wording changed.

If the identity is genuinely ambiguous, preserve the ambiguity in identityClues.

Do not force a merge.

==================================================
CONTINUITY FACTS
==================================================

Capture important state changes involving:

ownership
authority
property
contracts
documents
locks
access
water
power
utilities
equipment
evidence
damage
vehicles
objects
locations
relationships
time progression

==================================================
PART ${chunk.partNumber} OF ${chunk.totalParts}
==================================================

${chunk.text}
`;
}
// ============================================================
// STAGE B
// ALL FACTS -> FINAL STORY BIBLE + CHARACTER LOCK
// ============================================================

function buildFinalBiblePrompt(
  extractedParts
) {
  const projectVisualSeed =
    buildProjectVisualSeed(
      extractedParts
    );

  return `
YOU ARE THE CANONICAL WHOLE-STORY ANALYSIS ENGINE FOR STORY VISUAL STUDIO V4.

You are receiving compact factual extracts from EVERY processed part of ONE complete story.

ALL PARTS HAVE NOW BEEN PROCESSED.

Your job is to reconstruct the whole story and produce ONE canonical Story Bible.

==================================================
NON-NEGOTIABLE PROCESS ORDER
==================================================

You MUST complete character reasoning in this exact order:

STEP 1:
RESOLVE CHARACTER IDENTITY ACROSS THE WHOLE STORY.

STEP 2:
CLASSIFY NARRATIVE ROLE.

STEP 3:
CREATE THE PERMANENT VISUAL LOCK.

Never design appearance before identity resolution is complete.

Never create a separate visual identity for a descriptive reference until you have tested whether it refers to an existing canonical person.

==================================================
WHOLE-STORY RULES
==================================================

Use facts from ALL parts.

Do not over-weight the opening.

Do not truncate the ending.

Preserve the real:

opening
setup
conflict
escalation
discoveries
evidence
setbacks
confrontation
turning point
climax
consequences
resolution
ending

Preserve cause and effect.

Do not invent a different climax.

Do not invent a different resolution.

==================================================
STEP 1 — CHARACTER IDENTITY RESOLUTION
==================================================

First determine WHO IS WHO across the complete story.

ONE REAL PERSON = ONE CANONICAL CHARACTER ID.

Use:

CHAR_001
CHAR_002
CHAR_003

and continue sequentially.

Before creating a new canonical character, test whether the reference belongs to an existing canonical person.

The same person may appear under:

full name
first name
surname
nickname
occupation
job title
family role
relationship label
ownership label
neighborhood label
pronoun-linked descriptive reference
other descriptive phrase

Do NOT create duplicate characters merely because different parts use different labels.

Resolve identity using combined evidence from the WHOLE story, including:

name continuity
surname continuity
occupation
relationship
location
event participation
chronology
continuous action
ownership
authority
dialogue attribution
pronoun context
descriptive references
facts that occur before and after the mention

For every canonical character:

name:
- use the strongest canonical proper name available
- if the story never provides a proper name, use the clearest stable descriptive name

aliases:
- direct alternate names only
- first-name forms
- surname forms
- nicknames
- explicitly established alternate names

descriptiveReferences:
- job titles
- relationship labels
- descriptive labels
- other phrases that clearly refer to this same person

occupation:
- one canonical occupation/work identity when established
- otherwise use an empty string

relationships:
- important relationship facts that help identify the person

identityEvidence:
- compact evidence supporting the identity resolution
- especially explain merges that could otherwise look like separate people

identityConfidence must be exactly one of:

confirmed
inferred
review_required

Use "confirmed" when the identity is directly established.

Use "inferred" when multiple strong contextual facts support the merge.

Use "review_required" when identity cannot be safely resolved.

CRITICAL:

Do NOT merge two different people merely because they:
- share an occupation
- share a surname
- live in the same place
- have similar behavior

Do NOT split one person merely because the story later refers to them by:
- their occupation
- surname
- first name
- relationship
- title
- descriptive phrase

When evidence is insufficient, preserve uncertainty.

Do not invent certainty.

==================================================
STEP 2 — NARRATIVE ROLE CLASSIFICATION
==================================================

Only AFTER identity resolution, classify each canonical character.

narrativeRole must be exactly one of:

protagonist
mainAntagonist
supporting
minor

There must be EXACTLY ONE protagonist.

The protagonist is the main viewpoint, main story driver, or person whose conflict and decisions organize the story.

There may be ZERO or ONE mainAntagonist.

The mainAntagonist is the primary HUMAN opposing force driving the central conflict against the protagonist.

Do not label a person mainAntagonist merely because they are rude, difficult, or appear in one conflict.

If the central opposing force is institutional, environmental, accidental, or otherwise not one specific human, it is valid to have zero mainAntagonist characters.

Supporting characters materially affect the story but are not the principal protagonist or principal human antagonist.

Minor characters are brief or low-impact participants.

importance must remain compatible with narrativeRole:

protagonist -> primary

mainAntagonist -> primary or secondary, never minor

supporting -> primary or secondary when story importance justifies it

minor -> minor

role:
- keep a concise human-readable story role for frontend compatibility

isKarenType:
- true ONLY when the character's behavior in the story supports a hostile, entitled, controlling, HOA/neighborhood-bully, accusatory, boundary-violating Karen-type role
- do not set true merely because the character is female
- do not set true from the person's name

==================================================
STEP 3 — PERMANENT CHARACTER VISUAL LOCK
==================================================

Only after canonical identity and narrative role are settled, create ONE permanent visual identity for each recurring or visually important canonical character.

SCRIPT FACTS ALWAYS OVERRIDE GENERATED DESIGN.

Visual priority:

1. explicit confirmed facts from the story
2. strong whole-story contextual inference
3. production-designed details only when needed for visual continuity

Never contradict confirmed facts.

Once a visual choice is established, keep it stable throughout this project.

==================================================
PROJECT-SPECIFIC VISUAL DIVERSITY
==================================================

PROJECT VISUAL DIVERSITY SEED:
${projectVisualSeed}

Use this seed ONLY as a diversity cue when the story leaves a visual trait unspecified.

The seed is NOT story evidence.

Never convert the seed literally into:

age
race
ethnicity
skin tone
hair
clothing
or any physical trait

For each character, conceptually combine:

PROJECT VISUAL DIVERSITY SEED
+
canonical character name
+
narrative role
+
occupation
+
location
+
climate
+
lifestyle
+
story context

to avoid reusing the same complete visual identity across unrelated projects.

The character name is an IDENTITY ANCHOR and diversity cue.

The name is NOT evidence of:

race
ethnicity
skin tone
hair type
social class
religion
nationality

Do not stereotype appearance from a name.

==================================================
CROSS-PROJECT DIVERSITY RULE
==================================================

Every new script must receive a freshly production-designed cast.

Do NOT reuse the same complete combination of:

exact age
skin tone
physique
face shape
eye appearance
hair length
hair texture
hairstyle
hair color
facial hair
clothing type
clothing colors
footwear
accessories
distinguishing features

from unrelated projects.

Characters may naturally share an occasional common trait.

The COMPLETE identity must still be meaningfully distinct and context-appropriate.

Do not use a universal protagonist template.

Do not use a universal antagonist template.

Do not use a fixed Karen template.

==================================================
EXACT AGE
==================================================

The schema field is named:

age

but its value must contain ONE EXACT NUMERIC AGE.

Valid examples of FORM only:

"42"
"51"

Do NOT use:

age ranges
decades
approximate wording
"around"
"about"
"approximately"
"or"
"khoảng"
"hoặc"

If exact age is explicitly confirmed:
preserve it.

If exact age is not explicitly stated:
choose ONE plausible exact production age from the complete story context.

Do not change a character who is explicitly established as under 18 years old into an adult.

Do not turn an explicitly established adult into a child or teenager.

If the script does not establish a character as under 18, do not invent a child identity merely to add visual variety.

For children or teenagers who are genuinely required by the story:
- preserve their story role
- do not create a detailed visual Character Lock for any human character under 19 years old

==================================================
REQUIRED VISUAL DETAIL
==================================================

For every canonical character, fill every schema-required visual field:

age
gender
skinTone
physique
faceShape
eyes
nose
mouth
jawline
hairStyle
hairColor
facialHair
clothing
clothingColors
footwear
accessories
distinguishingFeatures
appearance
masterCharacterLock
flowReferenceName
visualConfidence

Use ONE specific value for each trait.

Do NOT write alternatives.

Do NOT use:

"or"
"maybe"
"possibly"
"around"
"approximately"
"about"

Use concrete garment types and concrete garment colors.

Do not write vague wardrobe descriptions such as:

casual clothes
dark clothes
work clothes
formal clothes

unless those words are followed by exact garments and colors.

==================================================
EVERYDAY REALISM
==================================================

Unless the script explicitly requires something else:

- design ordinary believable people
- use natural everyday appearance
- use story-appropriate American casual clothing when the setting is American
- match occupation, climate, location, lifestyle, age, and socioeconomic context
- do not make everyone glamorous
- do not make everyone fashion-model attractive
- do not make every antagonist visually theatrical
- do not default to office clothing
- do not default to corporate styling

If a job truly requires a uniform or professional clothing in the depicted story context, preserve that requirement.

==================================================
PROTAGONIST VISUAL RULE
==================================================

The protagonist must feel grounded, relatable, and believable for THIS story.

Do not clone the protagonist design from unrelated projects.

Use the whole-story context to create a distinct combination of:

face
age
skin
hair
build
wardrobe
footwear
accessories

without contradicting confirmed script facts.

==================================================
HOSTILE FEMALE ANTAGONIST VISUAL OVERRIDE
==================================================

This rule has HIGHER PRIORITY than general occupation, authority, status, or social-role styling rules.

A hostile, entitled, accusatory, manipulative, controlling, self-righteous, boundary-violating, or Karen-type female antagonist is a BEHAVIORAL archetype, not a fixed physical archetype.

For every new script, create a fresh and visually distinct woman specifically for that story.

==================================================
WARDROBE DECISION RULE
==================================================

FIRST check whether the SCRIPT explicitly establishes her clothing, professional occupation, uniform, formal event, workplace setting, or other wardrobe requirement.

If the script explicitly establishes such a wardrobe:
preserve the confirmed story fact.

If the script does NOT explicitly establish professional or formal clothing:
her base wardrobe MUST be ordinary everyday clothing appropriate to her age, activity, climate, location, lifestyle, and story setting.

A position of authority, community title, organizational title, wealth, confidence, aggressive behavior, or social status is NOT sufficient evidence for professional clothing.

Do NOT infer professional wardrobe merely because she appears powerful, controlling, educated, wealthy, organized, or authoritative.

When professional/formal clothing is NOT confirmed by the script, DO NOT use:

- business blazer
- tailored blazer
- suit jacket
- business suit
- executive outfit
- office-style blouse-and-trouser combination
- formal businesswear
- corporate styling
- luxury executive styling

==================================================
EVERYDAY APPEARANCE
==================================================

When no wardrobe is confirmed by the story, production-design a believable everyday outfit from scratch.

The outfit must feel natural for what she is physically doing in the story.

Use a fresh combination of ordinary garments, colors, footwear, and accessories appropriate to that individual character.

Do not use one recurring casual outfit template either.

The goal is VARIETY, not replacing one stereotype with another stereotype.

==================================================
FRESH CHARACTER DESIGN
==================================================

For each unrelated script, vary the complete character identity across:

exact age
skin tone
physique
face shape
facial proportions
eyes
nose
mouth
jawline
hair length
hair texture
hairstyle
hair color
clothing category
clothing colors
footwear
accessories
distinguishing features

Do not reuse a complete hostile-female design from another project.

Do not infer ethnicity, race, skin tone, socioeconomic status, or physical traits from her name.

==================================================
BEHAVIOR VS PERMANENT IDENTITY
==================================================

Her hostility should mainly appear through scene-specific:

expression
gaze
posture
gesture
body language
personal-space behavior

Do NOT permanently distort her facial anatomy merely to make her unpleasant.

She must remain a believable real woman rather than a caricature.

==================================================
FINAL HOSTILE-FEMALE WARDROBE CHECK
==================================================

Before finalizing her masterCharacterLock, ask:

"Did the actual script explicitly require professional, formal, corporate, or office clothing?"

If NO:
remove professional, formal, corporate, and office-style wardrobe choices and replace them with a specific everyday outfit appropriate to this story.

If YES:
preserve the confirmed story requirement.

Her masterCharacterLock must still contain one exact permanent visual identity and one specific stable base wardrobe for continuity across all scenes and hook prompts.

==================================================
PERMANENT VS TEMPORARY
==================================================

masterCharacterLock describes:

PERMANENT PHYSICAL IDENTITY
+
STABLE BASE WARDROBE

Do NOT place temporary scene actions inside masterCharacterLock, including:

holding a phone
holding papers
walking
running
pointing
shouting
standing
sitting
smiling
crying
temporary anger
temporary fear

Those belong to individual scenes.

==================================================
MASTER CHARACTER LOCK QUALITY
==================================================

masterCharacterLock must be sufficiently specific for an image generator to reproduce the same person consistently across:

20 storyboard images
and
5 video hook prompts

It must include the stable visual identity needed to preserve:

apparent exact age
gender presentation
skin tone
physique
face shape
eyes
nose
mouth
jawline
hair
hair color
facial hair
base wardrobe
clothing colors
footwear
accessories
distinguishing features

Do not omit identity-defining details merely because appearance is not the central plot point.

==================================================
LOCATIONS
==================================================

ONE physical location =
ONE canonical LOC_XXX ID.

Merge alternate names referring to the same physical place.

Preserve visually important:

architecture
materials
terrain
vegetation
property relationships
interior/exterior distinctions
condition
fixed objects
access state
damage state

==================================================
PROPS
==================================================

Create meaningful recurring or story-critical props.

Use PROP_XXX IDs.

Preserve ownership and state changes when relevant.

==================================================
VEHICLES
==================================================

Vehicles remain separate entities.

Use VEH_XXX IDs.

Preserve:

type
color when known
ownership/association
condition
damage
state changes

==================================================
GLOBAL TIMELINE
==================================================

Build ONE chronological timeline from the true opening through the true ending.

Each timeline event must reference canonical IDs only.

Never create a new character identity inside the timeline.

Preserve:

ownership
authority
location
objects
evidence
vehicles
damage
access
utility state
chronology

==================================================
FINAL SELF-CHECK BEFORE OUTPUT
==================================================

Before returning JSON, internally verify:

1. ONE REAL PERSON appears only once in characters[].

2. Every surname, nickname, occupation label, family role, and descriptive reference that belongs to a known person is represented under that canonical person rather than duplicated as a new character.

3. There is EXACTLY ONE narrativeRole = "protagonist".

4. There are no more than ONE narrativeRole = "mainAntagonist".

5. Every character has identityEvidence.

6. Every character has identityConfidence.

7. Every required age is one exact numeric string.

8. No visual field contains alternatives such as "or".

9. Character appearance does not contradict explicit script facts.

10. The protagonist and main antagonist are visually distinguishable.

11. Unrelated project archetypes have not been reused as a fixed template.

12. Timeline characterIds reference canonical character IDs only.

==================================================
FINAL OUTPUT
==================================================

Return ONLY valid JSON compatible with this Story Bible schema:

${JSON.stringify(
  storyBibleSchema,
  null,
  2
)}

Do NOT create scenes yet.

==================================================
ALL EXTRACTED STORY FACTS
==================================================

${JSON.stringify(
  extractedParts
)}
`;
}

// ============================================================
// OUTPUT NORMALIZATION
// ============================================================
//
// IMPORTANT:
//
// Normalization repairs DATA SHAPE only.
//
// It does NOT:
// - decide who is who
// - merge characters semantically
// - invent story facts
// - redesign Character Locks
// - change story logic
//
// Semantic reasoning remains Gemini's job.
//

function normalizeString(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return '';
  }

  if (
    typeof value === 'string'
  ) {
    return value.trim();
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }

  return '';
}

function normalizeStringArray(value) {
  if (
    !Array.isArray(value)
  ) {
    return [];
  }

  return value
    .map(item =>
      normalizeString(item)
    )
    .filter(Boolean);
}

function normalizeBoolean(value) {
  if (
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (
    typeof value === 'string'
  ) {
    const normalized =
      value
        .trim()
        .toLowerCase();

    if (
      normalized === 'true'
    ) {
      return true;
    }

    if (
      normalized === 'false'
    ) {
      return false;
    }
  }

  if (
    typeof value === 'number'
  ) {
    return value !== 0;
  }

  return false;
}

function normalizeNarrativeRole(value) {
  const raw =
    normalizeString(value);

  const compact =
    raw
      .toLowerCase()
      .replace(
        /[\s_-]+/g,
        ''
      );

  if (
    compact === 'protagonist'
  ) {
    return 'protagonist';
  }

  if (
    compact ===
      'mainantagonist'
  ) {
    return 'mainAntagonist';
  }

  if (
    compact === 'supporting' ||
    compact ===
      'supportingcharacter'
  ) {
    return 'supporting';
  }

  if (
    compact === 'minor' ||
    compact ===
      'minorcharacter'
  ) {
    return 'minor';
  }

  return raw;
}

function normalizeIdentityConfidence(
  value
) {
  const raw =
    normalizeString(value)
      .toLowerCase()
      .replace(
        /[\s-]+/g,
        '_'
      );

  if (
    raw === 'confirmed' ||
    raw === 'inferred' ||
    raw === 'review_required'
  ) {
    return raw;
  }

  return raw;
}

function normalizeImportance(value) {
  const raw =
    normalizeString(value)
      .toLowerCase();

  if (
    raw === 'primary' ||
    raw === 'secondary' ||
    raw === 'minor'
  ) {
    return raw;
  }

  return raw;
}

function normalizeVisualConfidence(
  value
) {
  const raw =
    normalizeString(value)
      .toLowerCase();

  if (
    raw === 'confirmed' ||
    raw === 'inferred' ||
    raw === 'unknown'
  ) {
    return raw;
  }

  return raw;
}

function normalizeExactAge(value) {
  if (
    typeof value === 'number' &&
    Number.isFinite(value)
  ) {
    return String(
      Math.trunc(value)
    );
  }

  return normalizeString(value);
}

function normalizeBible(rawBible) {
  const source =
    rawBible &&
    typeof rawBible === 'object'
      ? rawBible
      : {};

  const analysisSource =
    source.analysis &&
    typeof source.analysis === 'object'
      ? source.analysis
      : {};

  const charactersSource =
    Array.isArray(source.characters)
      ? source.characters
      : [];

  const locationsSource =
    Array.isArray(source.locations)
      ? source.locations
      : [];

  const propsSource =
    Array.isArray(source.props)
      ? source.props
      : [];

  const vehiclesSource =
    Array.isArray(source.vehicles)
      ? source.vehicles
      : [];

  const timelineSource =
    Array.isArray(source.timeline)
      ? source.timeline
      : [];

  return {
    analysis: {
      title:
        normalizeString(
          analysisSource.title
        ),

      summary:
        normalizeString(
          analysisSource.summary
        ),

      setting:
        normalizeString(
          analysisSource.setting
        ),

      timePeriod:
        normalizeString(
          analysisSource.timePeriod
        ),

      mainConflict:
        normalizeString(
          analysisSource.mainConflict
        ),

      climax:
        normalizeString(
          analysisSource.climax
        ),

      ending:
        normalizeString(
          analysisSource.ending
        )
    },

    characters:
      charactersSource.map(
        character => {
          const c =
            character &&
            typeof character === 'object'
              ? character
              : {};

          return {
            id:
              normalizeString(c.id),

            name:
              normalizeString(c.name),

            aliases:
              normalizeStringArray(
                c.aliases
              ),

            descriptiveReferences:
              normalizeStringArray(
                c.descriptiveReferences
              ),

            occupation:
              normalizeString(
                c.occupation
              ),

            relationships:
              normalizeStringArray(
                c.relationships
              ),

            identityEvidence:
              normalizeStringArray(
                c.identityEvidence
              ),

            identityConfidence:
              normalizeIdentityConfidence(
                c.identityConfidence
              ),

            narrativeRole:
              normalizeNarrativeRole(
                c.narrativeRole
              ),

            role:
              normalizeString(c.role),

            importance:
              normalizeImportance(
                c.importance
              ),

            isKarenType:
              normalizeBoolean(
                c.isKarenType
              ),

            age:
              normalizeExactAge(c.age),

            gender:
              normalizeString(c.gender),

            skinTone:
              normalizeString(c.skinTone),

            physique:
              normalizeString(c.physique),

            faceShape:
              normalizeString(c.faceShape),

            eyes:
              normalizeString(c.eyes),

            nose:
              normalizeString(c.nose),

            mouth:
              normalizeString(c.mouth),

            jawline:
              normalizeString(c.jawline),

            hairStyle:
              normalizeString(c.hairStyle),

            hairColor:
              normalizeString(c.hairColor),

            facialHair:
              normalizeString(c.facialHair),

            clothing:
              normalizeString(c.clothing),

            clothingColors:
              normalizeString(
                c.clothingColors
              ),

            footwear:
              normalizeString(c.footwear),

            accessories:
              normalizeString(c.accessories),

            distinguishingFeatures:
              normalizeString(
                c.distinguishingFeatures
              ),

            appearance:
              normalizeString(c.appearance),

            masterCharacterLock:
              normalizeString(
                c.masterCharacterLock
              ),

            flowReferenceName:
              normalizeString(
                c.flowReferenceName
              ),

            visualConfidence:
              normalizeVisualConfidence(
                c.visualConfidence
              )
          };
        }
      ),

    locations:
      locationsSource.map(
        location => {
          const item =
            location &&
            typeof location === 'object'
              ? location
              : {};

          return {
            id:
              normalizeString(item.id),

            name:
              normalizeString(item.name),

            description:
              normalizeString(
                item.description
              ),

            masterLocationLock:
              normalizeString(
                item.masterLocationLock
              )
          };
        }
      ),

    props:
      propsSource.map(
        prop => {
          const item =
            prop &&
            typeof prop === 'object'
              ? prop
              : {};

          return {
            id:
              normalizeString(item.id),

            name:
              normalizeString(item.name),

            description:
              normalizeString(
                item.description
              ),

            masterPropLock:
              normalizeString(
                item.masterPropLock
              )
          };
        }
      ),

    vehicles:
      vehiclesSource.map(
        vehicle => {
          const item =
            vehicle &&
            typeof vehicle === 'object'
              ? vehicle
              : {};

          return {
            id:
              normalizeString(item.id),

            name:
              normalizeString(item.name),

            description:
              normalizeString(
                item.description
              ),

            masterVehicleLock:
              normalizeString(
                item.masterVehicleLock
              )
          };
        }
      ),

    timeline:
      timelineSource.map(
        (entry, index) => {
          const item =
            entry &&
            typeof entry === 'object'
              ? entry
              : {};

          const parsedOrder =
            Number(item.order);

          return {
            order:
              Number.isFinite(parsedOrder)
                ? parsedOrder
                : index + 1,

            event:
              normalizeString(item.event),

            storyPhase:
              normalizeString(
                item.storyPhase
              ),

            importance:
              normalizeString(
                item.importance
              ),

            characterIds:
              normalizeStringArray(
                item.characterIds
              ),

            locationId:
              normalizeString(
                item.locationId
              ),

            propIds:
              normalizeStringArray(
                item.propIds
              ),

            vehicleIds:
              normalizeStringArray(
                item.vehicleIds
              ),

            continuityState:
              normalizeString(
                item.continuityState
              )
          };
        }
      )
  };
}

function normalizeScenePlan(
  rawScenePlan
) {
  const source =
    rawScenePlan &&
    typeof rawScenePlan === 'object'
      ? rawScenePlan
      : {};

  const scenesSource =
    Array.isArray(source.scenes)
      ? source.scenes
      : [];

  const scenes =
    scenesSource.map(
      (scene, index) => {
        const item =
          scene &&
          typeof scene === 'object'
            ? scene
            : {};

        const parsedSceneNumber =
          Number(
            item.sceneNumber
          );

        return {
          sceneNumber:
            Number.isFinite(
              parsedSceneNumber
            )
              ? parsedSceneNumber
              : index + 1,

          title:
            normalizeString(
              item.title
            ),

          storyMoment:
            normalizeString(
              item.storyMoment
            ),

          purpose:
            normalizeString(
              item.purpose
            ),

          characterIds:
            normalizeStringArray(
              item.characterIds
            ),

          locationId:
            normalizeString(
              item.locationId
            ),

          propIds:
            normalizeStringArray(
              item.propIds
            ),

          vehicleIds:
            normalizeStringArray(
              item.vehicleIds
            ),

          timeOfDay:
            normalizeString(
              item.timeOfDay
            ),

          action:
            normalizeString(
              item.action
            ),

          emotion:
            normalizeString(
              item.emotion
            ),

          cameraSuggestion:
            normalizeString(
              item.cameraSuggestion
            ),

          continuity:
            normalizeString(
              item.continuity
            )
        };
      }
    );

  // Only renumber when Gemini already returned exactly
  // twenty scene objects.
  //
  // This repairs numbering format without inventing
  // or deleting story content.

  if (
    scenes.length === 20
  ) {
    scenes.forEach(
      (scene, index) => {
        scene.sceneNumber =
          index + 1;
      }
    );
  }

  return {
    scenes
  };
}
// ============================================================
// STAGE C
// FINAL BIBLE -> EXACTLY 20 SCENES
// ============================================================

function buildScenePlanPrompt(
  bible
) {
  return `
YOU ARE THE CINEMATIC STORYBOARD PLANNER FOR STORY VISUAL STUDIO V4.

You now have the FINAL canonical Story Bible and Global Timeline for the COMPLETE story.

Select EXACTLY 20 storyboard scenes.

Do not visually depict any human character under 19 years old in storyboard images.

Characters under 19 may remain in the Story Bible for narrative continuity, but:
- do not include them in scene.characterIds
- do not describe their appearance
- do not create image prompts featuring them
- if an important event involves them, choose a nearby scene focused on adult characters age 19 or older

==================================================
WHOLE STORY COVERAGE
==================================================

The twenty scenes must collectively represent the complete story.

Include meaningful coverage of:

opening
setup
central conflict
escalation
discovery
evidence
setback
confrontation
turning point
climax
consequences
resolution
ending

Do NOT select twenty scenes only from the beginning.

Do NOT mechanically split the story into twenty equal text sections.

Choose the strongest narratively important and visually distinct moments.

==================================================
CHARACTER CONTINUITY
==================================================

Whenever a canonical character appears,
preserve their Character Lock.

Do NOT change:

age
face
skin tone
physique
hair
hair color
facial hair
base clothing
footwear
accessories
distinguishing features

unless the actual timeline explicitly requires a state change.

==================================================
SCENE-SPECIFIC STATE
==================================================

Scenes may specify temporary:

action
pose
expression
camera
lighting
weather
held objects
damage
evidence state
vehicle state
location state
time of day

Do not modify permanent identity.

==================================================
CANONICAL REFERENCES
==================================================

Use ONLY IDs already present in the Story Bible.

Character identity is already resolved and LOCKED.

Never create a new character because a scene description uses:

a surname
a first name
an occupation
a relationship label
a title
a descriptive phrase

Map every appearing person back to the existing canonical CHAR_XXX ID.

Do NOT invent:

new CHAR IDs
new LOC IDs
new PROP IDs
new VEHICLE IDs

==================================================
NUMBERING
==================================================

Exactly 20 scenes.

sceneNumber must be:

1 through 20.

No duplicate numbers.

No missing numbers.

No scene 21.

==================================================
OUTPUT
==================================================

Return ONLY valid JSON compatible with:

${JSON.stringify(
  scenePlanSchema,
  null,
  2
)}

==================================================
FINAL STORY BIBLE
==================================================

${JSON.stringify(
  bible
)}
`;
}

// ============================================================
// HEALTH
// ============================================================

app.get(
  '/health',
  (req, res) => {
    res.json({
      ok: true,

      service:
        'story-visual-backend',

      mode:
        'LONG_SCRIPT_SAFE_V6_NORMALIZED_OUTPUT',

      model:
        MODEL_NAME,

      chunkChars:
        TARGET_CHUNK_CHARS,

      chunkSchema:
        true
    });
  }
);

// ============================================================
// ANALYZE SCRIPT
// ============================================================

app.post(
  '/analyze-script',
  async (req, res) => {

    const script =
      typeof req.body?.script ===
      'string'
        ? req.body.script.trim()
        : '';

    if (!script) {
      return res
        .status(400)
        .json({
          error:
            'SCRIPT_REQUIRED'
        });
    }

    console.log(
      `[ANALYZE_START] chars=${script.length} model=${MODEL_NAME}`
    );

    // ========================================================
    // SPLIT
    // ========================================================

    const chunks =
      splitScriptByParagraphs(
        script
      );

    if (!chunks.length) {
      return res
        .status(500)
        .json({
          error:
            'SCRIPT_SPLIT_FAILED'
        });
    }

    console.log(
      `[SCRIPT_SPLIT] parts=${chunks.length}`
    );

    const extractedParts =
      [];

    // ========================================================
    // STAGE A
    // PROCESS EVERY CHUNK
    // ========================================================

    for (
      let i = 0;
      i < chunks.length;
      i++
    ) {
      const chunk =
        chunks[i];

      const stageName =
        `PART_${chunk.partNumber}`;

      console.log(
        `[PART_STARTED] ${chunk.partNumber}/${chunk.totalParts} chars=${chunk.text.length} start=${chunk.startIndex} end=${chunk.endIndex}`
      );

      try {
        const extracted =
          await generateJson(
            buildChunkFactPrompt(
              chunk
            ),

            stageName,

            chunkFactsSchema
          );

        // Trust splitter metadata instead of model metadata.
        extracted.partNumber =
          chunk.partNumber;

        extracted.startIndex =
          chunk.startIndex;

        extracted.endIndex =
          chunk.endIndex;

        extractedParts.push(
          extracted
        );

        console.log(
          `[PART_SUCCESS] ${chunk.partNumber}/${chunk.totalParts}`
        );

      } catch (err) {
        console.error(
          `[PART_FAILED] ${chunk.partNumber}/${chunk.totalParts}`,
          err
        );

        return sendMappedError(
          res,
          err,
          'PART_EXTRACTION',
          {
            partNumber:
              chunk.partNumber,

            totalParts:
              chunk.totalParts,

            startIndex:
              chunk.startIndex,

            endIndex:
              chunk.endIndex
          }
        );
      }

      if (
        i <
        chunks.length - 1
      ) {
        await sleep(
          REQUEST_GAP_MS
        );
      }
    }

    // ========================================================
    // VERIFY PART COUNT
    // ========================================================

    if (
      extractedParts.length !==
      chunks.length
    ) {
      return res
        .status(500)
        .json({
          error:
            'PART_COUNT_MISMATCH',

          expectedParts:
            chunks.length,

          processedParts:
            extractedParts.length
        });
    }

    const processedNumbers =
      extractedParts
        .map(
          part =>
            part.partNumber
        )
        .sort(
          (a, b) =>
            a - b
        );

    for (
      let expected = 1;
      expected <=
      chunks.length;
      expected++
    ) {
      if (
        processedNumbers[
          expected - 1
        ] !== expected
      ) {
        return res
          .status(500)
          .json({
            error:
              'MISSING_SCRIPT_PART',

            missingPart:
              expected
          });
      }
    }

    console.log(
      `[ALL_PARTS_PROCESSED] ${extractedParts.length}/${chunks.length}`
    );

    // ========================================================
    // STAGE B
    // FINAL STORY BIBLE
    // ========================================================

    let bible;

    try {
      console.log(
        '[BIBLE_MERGE_STARTED]'
      );

      bible =
        await generateJson(
          buildFinalBiblePrompt(
            extractedParts
          ),

          'BIBLE_MERGE'
        );

      bible =
        normalizeBible(
          bible
        );

      console.log(
        '[BIBLE_MERGE_SUCCESS]'
      );

    } catch (err) {
      console.error(
        '[BIBLE_MERGE_FAILED]',
        err
      );

      return sendMappedError(
        res,
        err,
        'BIBLE_MERGE'
      );
    }

    // ========================================================
    // VALIDATE STORY BIBLE
    // ========================================================

    let bibleContext;

    try {
      bibleContext =
        validateBible(
          bible
        );

      console.log(
        `[BIBLE_VALIDATION_SUCCESS] characters=${bible.characters?.length || 0} locations=${bible.locations?.length || 0} timeline=${bible.timeline?.length || 0}`
      );

    } catch (err) {
      console.error(
        '[STORY_SCHEMA_INVALID]',
        err.message
      );

      return res
        .status(500)
        .json({
          error:
            'STORY_SCHEMA_INVALID',

          detail:
            err.message
        });
    }

    // ========================================================
    // STAGE C
    // EXACTLY 20 SCENES
    // ========================================================

    let scenePlan;

    try {
      console.log(
        '[SCENE_PLAN_STARTED]'
      );

      scenePlan =
        await generateJson(
          buildScenePlanPrompt(
            bible
          ),

          'SCENE_PLAN'
        );

      scenePlan =
        normalizeScenePlan(
          scenePlan
        );

      console.log(
        '[SCENE_PLAN_SUCCESS]'
      );

    } catch (err) {
      console.error(
        '[SCENE_PLAN_FAILED]',
        err
      );

      return sendMappedError(
        res,
        err,
        'SCENE_PLAN'
      );
    }

    // ========================================================
    // EXACT 20 SCENE CHECK
    // ========================================================

    if (
      !scenePlan ||
      !Array.isArray(
        scenePlan.scenes
      )
    ) {
      return res
        .status(500)
        .json({
          error:
            'SCENES_MISSING'
        });
    }

    if (
      scenePlan.scenes.length !==
      20
    ) {
      return res
        .status(500)
        .json({
          error:
            'SCENE_COUNT_INVALID',

          detail:
            `Expected exactly 20 scenes, received ${scenePlan.scenes.length}.`
        });
    }

    // ========================================================
    // VALIDATE SCENE REFERENCES
    // ========================================================

    try {
      validateScenes(
        scenePlan,
        bibleContext
      );

      console.log(
        '[SCENE_VALIDATION_SUCCESS]'
      );

    } catch (err) {
      console.error(
        '[REFERENCE_VALIDATION_FAILED]',
        err.message
      );

      return res
        .status(500)
        .json({
          error:
            'REFERENCE_VALIDATION_FAILED',

          detail:
            err.message
        });
    }

    // ========================================================
    // SUCCESS
    // ========================================================

    console.log(
      `[ANALYZE_SUCCESS] parts=${chunks.length} characters=${bible.characters?.length || 0} locations=${bible.locations?.length || 0} scenes=${scenePlan.scenes.length}`
    );

    return res.json({
      ...bible,

      scenes:
        scenePlan.scenes
    });
  }
);

// ============================================================
// START SERVER
// ============================================================

app.listen(
  PORT,
  () => {
    console.log(
      `Backend service listening on port ${PORT}`
    );

    console.log(
      `Model: ${MODEL_NAME}`
    );

    console.log(
      'Mode: LONG_SCRIPT_SAFE_V6_NORMALIZED_OUTPUT'
    );

    console.log(
      `Chunk target: ${TARGET_CHUNK_CHARS} chars`
    );

    console.log(
      'Chunk structured schema: ENABLED'
    );
  }
);
