/**
 * GEMINI STRUCTURED OUTPUT SCHEMAS
 * These schemas ensure the model returns data compatible with the frontend types.ts
 * while also preserving canonical character identity, narrative role, and visual-lock data.
 */

const storyBibleSchema = {
  description: "Canonical story bible and global timeline analysis",
  type: "object",

  properties: {
    analysis: {
      type: "object",

      properties: {
        title: {
          type: "string"
        },

        summary: {
          type: "string"
        },

        setting: {
          type: "string"
        },

        timePeriod: {
          type: "string"
        },

        mainConflict: {
          type: "string"
        },

        climax: {
          type: "string"
        },

        ending: {
          type: "string"
        }
      },

      required: [
        "title",
        "summary",
        "setting",
        "timePeriod",
        "mainConflict",
        "climax",
        "ending"
      ]
    },

    // ========================================================
    // CHARACTERS
    // ========================================================

    characters: {
      type: "array",

      items: {
        type: "object",

        properties: {
          // --------------------------------------------------
          // CANONICAL IDENTITY
          // --------------------------------------------------

          id: {
            type: "string",
            description:
              "Canonical character ID such as CHAR_001"
          },

          name: {
            type: "string",
            description:
              "Canonical character name"
          },

          aliases: {
            type: "array",

            items: {
              type: "string"
            },

            description:
              "Direct name aliases, first-name forms, surnames, nicknames, or explicitly established alternate names"
          },

          descriptiveReferences: {
            type: "array",

            items: {
              type: "string"
            },

            description:
              "Descriptive references that refer to this same canonical person, such as the mechanic, the neighbor, the shop owner, or her husband"
          },

          occupation: {
            type: "string",

            description:
              "Canonical occupation or work identity when known; otherwise an empty string"
          },

          relationships: {
            type: "array",

            items: {
              type: "string"
            },

            description:
              "Important relationship facts used to distinguish and resolve character identity"
          },

          identityEvidence: {
            type: "array",

            items: {
              type: "string"
            },

            description:
              "Compact evidence explaining why names, aliases, titles, occupations, and descriptive references belong to this canonical person"
          },

          identityConfidence: {
            type: "string",

            enum: [
              "confirmed",
              "inferred",
              "review_required"
            ],

            description:
              "Confidence that all merged references belong to the same canonical person"
          },

          // --------------------------------------------------
          // NARRATIVE ROLE
          // --------------------------------------------------

          narrativeRole: {
            type: "string",

            enum: [
              "protagonist",
              "mainAntagonist",
              "supporting",
              "minor"
            ],

            description:
              "Narrative classification after canonical identity resolution"
          },

          role: {
            type: "string",

            description:
              "Human-readable story role, function, occupation, or relationship, preserved for frontend compatibility"
          },

          importance: {
            type: "string",

            enum: [
              "primary",
              "secondary",
              "minor"
            ]
          },

          isKarenType: {
            type: "boolean",

            description:
              "True only when story behavior supports a Karen-type hostile, entitled, controlling, or neighborhood/HOA antagonist archetype"
          },

          // --------------------------------------------------
          // VISUAL LOCK
          // --------------------------------------------------

          age: {
            type: "string",

            description:
              "One exact age only. Never use a range or approximate wording"
          },

          gender: {
            type: "string"
          },

          skinTone: {
            type: "string"
          },

          physique: {
            type: "string"
          },

          faceShape: {
            type: "string"
          },

          eyes: {
            type: "string"
          },

          nose: {
            type: "string"
          },

          mouth: {
            type: "string"
          },

          jawline: {
            type: "string"
          },

          hairStyle: {
            type: "string"
          },

          hairColor: {
            type: "string"
          },

          facialHair: {
            type: "string"
          },

          clothing: {
            type: "string",

            description:
              "Specific stable base wardrobe with concrete garment types"
          },

          clothingColors: {
            type: "string",

            description:
              "Specific stable clothing color palette with no alternatives"
          },

          footwear: {
            type: "string"
          },

          accessories: {
            type: "string"
          },

          distinguishingFeatures: {
            type: "string"
          },

          appearance: {
            type: "string"
          },

          masterCharacterLock: {
            type: "string",

            description:
              "Detailed permanent physical identity and stable base wardrobe for consistent image generation"
          },

          flowReferenceName: {
            type: "string"
          },

          visualConfidence: {
            type: "string",

            enum: [
              "confirmed",
              "inferred",
              "unknown"
            ]
          }
        },

        required: [
          "id",
          "name",
          "aliases",
          "descriptiveReferences",
          "occupation",
          "relationships",
          "identityEvidence",
          "identityConfidence",
          "narrativeRole",
          "role",
          "importance",
          "isKarenType",
          "age",
          "gender",
          "skinTone",
          "physique",
          "faceShape",
          "eyes",
          "nose",
          "mouth",
          "jawline",
          "hairStyle",
          "hairColor",
          "facialHair",
          "clothing",
          "clothingColors",
          "footwear",
          "accessories",
          "distinguishingFeatures",
          "appearance",
          "masterCharacterLock",
          "flowReferenceName",
          "visualConfidence"
        ]
      }
    },

    // ========================================================
    // LOCATIONS
    // ========================================================

    locations: {
      type: "array",

      items: {
        type: "object",

        properties: {
          id: {
            type: "string",
            description:
              "LOC_001, etc."
          },

          name: {
            type: "string"
          },

          description: {
            type: "string"
          },

          masterLocationLock: {
            type: "string"
          }
        },

        required: [
          "id",
          "name",
          "description",
          "masterLocationLock"
        ]
      }
    },

    // ========================================================
    // PROPS
    // ========================================================

    props: {
      type: "array",

      items: {
        type: "object",

        properties: {
          id: {
            type: "string",
            description:
              "PROP_001, etc."
          },

          name: {
            type: "string"
          },

          description: {
            type: "string"
          },

          masterPropLock: {
            type: "string"
          }
        },

        required: [
          "id",
          "name",
          "description",
          "masterPropLock"
        ]
      }
    },

    // ========================================================
    // VEHICLES
    // ========================================================

    vehicles: {
      type: "array",

      items: {
        type: "object",

        properties: {
          id: {
            type: "string",
            description:
              "VEH_001, etc."
          },

          name: {
            type: "string"
          },

          description: {
            type: "string"
          },

          masterVehicleLock: {
            type: "string"
          }
        },

        required: [
          "id",
          "name",
          "description",
          "masterVehicleLock"
        ]
      }
    },

    // ========================================================
    // GLOBAL TIMELINE
    // ========================================================

    timeline: {
      type: "array",

      items: {
        type: "object",

        properties: {
          order: {
            type: "number"
          },

          event: {
            type: "string"
          },

          storyPhase: {
            type: "string"
          },

          importance: {
            type: "string"
          },

          characterIds: {
            type: "array",

            items: {
              type: "string"
            }
          },

          locationId: {
            type: "string"
          },

          propIds: {
            type: "array",

            items: {
              type: "string"
            }
          },

          vehicleIds: {
            type: "array",

            items: {
              type: "string"
            }
          },

          continuityState: {
            type: "string"
          }
        },

        required: [
          "order",
          "event",
          "storyPhase",
          "importance",
          "characterIds",
          "locationId",
          "propIds",
          "vehicleIds",
          "continuityState"
        ]
      }
    }
  },

  required: [
    "analysis",
    "characters",
    "locations",
    "props",
    "vehicles",
    "timeline"
  ]
};

// ============================================================
// EXACTLY 20 SCENES
// ============================================================

const scenePlanSchema = {
  description:
    "Exactly 20 storyboard scenes representing the narrative arc",

  type: "object",

  properties: {
    scenes: {
      type: "array",

      minItems: 20,
      maxItems: 20,

      items: {
        type: "object",

        properties: {
          sceneNumber: {
            type: "number"
          },

          title: {
            type: "string"
          },

          storyMoment: {
            type: "string"
          },

          purpose: {
            type: "string"
          },

          characterIds: {
            type: "array",

            items: {
              type: "string"
            }
          },

          locationId: {
            type: "string"
          },

          propIds: {
            type: "array",

            items: {
              type: "string"
            }
          },

          vehicleIds: {
            type: "array",

            items: {
              type: "string"
            }
          },

          timeOfDay: {
            type: "string"
          },

          action: {
            type: "string"
          },

          emotion: {
            type: "string"
          },

          cameraSuggestion: {
            type: "string"
          },

          continuity: {
            type: "string"
          }
        },

        required: [
          "sceneNumber",
          "title",
          "storyMoment",
          "purpose",
          "characterIds",
          "locationId",
          "propIds",
          "vehicleIds",
          "timeOfDay",
          "action",
          "emotion",
          "cameraSuggestion",
          "continuity"
        ]
      }
    }
  },

  required: [
    "scenes"
  ]
};

module.exports = {
  storyBibleSchema,
  scenePlanSchema
};
