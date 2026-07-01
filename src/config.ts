/**
 * Phase 0 tuning constants. Centralised so the FSRS engine, mastery function,
 * and placement test all read from one place (and derived rows can be stamped
 * with FSRS_PARAMS_VERSION for reproducible replay).
 */

/** Bumped whenever FSRS weights/rating-mapping change, so recomputeFromScratch is reproducible. */
export const FSRS_PARAMS_VERSION = 1;

/** MCQ correct/latency -> FSRS grade thresholds (milliseconds). */
export const FSRS_LATENCY = {
  /** correct & faster than this -> Easy */
  fastMs: 3000,
  /** correct & slower than this -> Good (between fast..slow also Good in Phase 0) */
  slowMs: 8000,
} as const;

/** Rolling mastery / re-tiering thresholds (see §5 of the proposal). */
export const PROMOTION = {
  /** tierMastery at/above this -> promote one CEFR level */
  promoteAt: 0.85,
  /** tierMastery below this -> silent demotion one level (D6 safety net) */
  demoteBelow: 0.6,
  /** a skill needs at least this many reviews before it counts at full weight */
  minReps: 6,
  /** fraction of tier skills that must have evidence before promotion is allowed */
  minCoverage: 0.8,
} as const;

/** Ordered CEFR ladder; A1..C2. C1->C2 is NOT auto-promoted in Phase 0 (needs checkpoint). */
export const CEFR_ORDER = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export type Cefr = (typeof CEFR_ORDER)[number];

/** Placement test budget. */
export const PLACEMENT = {
  maxItems: 24,
  minItems: 12,
  /** starting difficulty on the A2/B1 boundary */
  startDifficulty: 2.5,
  /** low in-tier progress seeded after placement */
  seedInTierProgress: 0.1,
} as const;
