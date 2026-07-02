import type { Cefr } from "@prisma/client";
import { CEFR_ORDER, PLACEMENT } from "../config.js";

/**
 * Adaptive placement — a ~10 min staircase over the exercise pool.
 *
 * PURE and stateless: the caller threads PlacementState between requests (no
 * placement_session table in Phase 0). Ability is estimated with a logistic
 * (Elo-style) update whose step shrinks as items accrue, so it converges. The
 * result is a STARTING BET (D6): a CEFR estimate + confidence + a low initial
 * in-tier progress — deliberately not a verdict; re-tiering corrects it.
 *
 * Difficulty is on the CEFR numeric scale (A1=1 .. C2=6, see CEFR_DIFFICULTY).
 * NOTE: in Phase 0 the pool holds only A1/A2 items, so the measurable ceiling
 * is ~A2; higher placements self-correct via the mastery loop.
 */

export interface PlacementItem {
  id: string;
  difficulty: number;
  type: "mcq" | "fill" | "listen";
}

export interface PlacementResponse {
  exerciseId: string;
  difficulty: number;
  correct: boolean;
  latencyMs: number;
  /** Present for graded (fill) items; drives FSRS-quality grading downstream
   *  and is persisted to the immutable Attempt log at finalize. */
  score?: number | null;
  selectedIndex?: number;
  response?: string;
}

export interface PlacementState {
  ability: number;
  askedExerciseIds: string[];
  responses: PlacementResponse[];
}

export interface PlacementResult {
  ability: number;
  cefr: Cefr;
  confidence: number; // 0..1
  inTierProgress: number; // low seed
  itemsUsed: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** P(correct) under a 1-parameter logistic on the difficulty scale. */
function pCorrect(ability: number, difficulty: number): number {
  return 1 / (1 + Math.exp(-(ability - difficulty)));
}

export function startPlacement(): PlacementState {
  return { ability: PLACEMENT.startDifficulty, askedExerciseIds: [], responses: [] };
}

/**
 * Select the unasked item whose difficulty is closest to the current ability
 * (maximum information), and mark it asked. Deterministic tie-break by
 * difficulty then id. Returns null when the pool is exhausted.
 *
 * Soft staging (plans/placement-modalities.md M1/M2): once `mcqStageItems`
 * responses are in — a fast receptive ability read — non-mcq candidates
 * (`fill`, `listen`) get a selection bonus (effectively treated as closer to
 * `ability` than they are) so the productive/listening checks run, without a
 * hard stage boundary that could strand the test if the pool lacks one at
 * the right difficulty.
 */
export function serveNext(
  state: PlacementState,
  pool: PlacementItem[],
  cfg: typeof PLACEMENT = PLACEMENT,
): { state: PlacementState; item: PlacementItem | null } {
  const asked = new Set(state.askedExerciseIds);
  const candidates = pool.filter((p) => !asked.has(p.id));
  if (candidates.length === 0) return { state, item: null };

  const pastStage = state.responses.length >= cfg.mcqStageItems;
  const effectiveDistance = (p: PlacementItem) => {
    const raw = Math.abs(p.difficulty - state.ability);
    return pastStage && p.type !== "mcq" ? Math.max(0, raw - cfg.fillPreferenceBonus) : raw;
  };

  candidates.sort((a, b) => {
    const da = effectiveDistance(a);
    const db = effectiveDistance(b);
    return da - db || a.difficulty - b.difficulty || a.id.localeCompare(b.id);
  });

  const item = candidates[0]!;
  return {
    state: { ...state, askedExerciseIds: [...state.askedExerciseIds, item.id] },
    item,
  };
}

/** Record an answer and update the ability estimate (shrinking step). */
export function applyAnswer(
  state: PlacementState,
  item: PlacementItem,
  correct: boolean,
  latencyMs: number,
  extra?: { score?: number | null; selectedIndex?: number; response?: string },
): PlacementState {
  const n = state.responses.length + 1;
  const k = Math.max(0.4, 1.5 / Math.sqrt(n));
  const expected = pCorrect(state.ability, item.difficulty);
  const ability = clamp(state.ability + k * ((correct ? 1 : 0) - expected), 0.5, 6.5);

  return {
    ability,
    askedExerciseIds: state.askedExerciseIds.includes(item.id)
      ? state.askedExerciseIds
      : [...state.askedExerciseIds, item.id],
    responses: [
      ...state.responses,
      { exerciseId: item.id, difficulty: item.difficulty, correct, latencyMs, ...extra },
    ],
  };
}

/** Fisher-information standard error of the ability estimate at its current value. */
function standardError(state: PlacementState): number {
  let info = 0;
  for (const r of state.responses) {
    const p = pCorrect(state.ability, r.difficulty);
    info += p * (1 - p);
  }
  return 1 / Math.sqrt(Math.max(info, 1e-6));
}

/** Done at the item budget, or once past the minimum with a tight estimate. */
export function isComplete(state: PlacementState): boolean {
  const n = state.responses.length;
  if (n >= PLACEMENT.maxItems) return true;
  if (n < PLACEMENT.minItems) return false;
  return standardError(state) < 0.7;
}

export function result(state: PlacementState): PlacementResult {
  const se = standardError(state);
  const idx = clamp(Math.round(state.ability) - 1, 0, CEFR_ORDER.length - 1);
  return {
    ability: state.ability,
    cefr: CEFR_ORDER[idx]!,
    confidence: clamp(1 - se / 2, 0, 1),
    inTierProgress: PLACEMENT.seedInTierProgress,
    itemsUsed: state.responses.length,
  };
}
