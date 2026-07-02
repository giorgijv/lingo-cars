import {
  fsrs,
  createEmptyCard,
  Rating,
  State,
  type Card,
  type Grade,
  type FSRS,
} from "ts-fsrs";
import type { FsrsState, Prisma, PrismaClient, ReviewState, SessionType } from "@prisma/client";
import { FSRS_LATENCY, FSRS_PARAMS_VERSION } from "../config.js";

/**
 * FSRS spaced-repetition engine.
 *
 * `srsDue` (ReviewState.due) is a pure function of a card's review history +
 * the FSRS parameter set. We keep the scheduler stateless & fuzz-disabled so
 * that recomputeFromScratch (Step 6) replaying the immutable Attempt log
 * reproduces byte-identical due dates (Rule 4).
 *
 * Cold start: default FSRS weights (`fsrs()` with no params). Degrades
 * gracefully — no fitting needed until enough history accrues (future phase).
 */
export const scheduler: FSRS = fsrs({ enable_fuzz: false });

/** MCQ outcome -> FSRS grade. Phase 0 has no reliable "Hard" signal from MCQ. */
export function gradeFor(correct: boolean, latencyMs: number): Grade {
  if (!correct) return Rating.Again;
  if (latencyMs <= FSRS_LATENCY.fastMs) return Rating.Easy;
  return Rating.Good;
}

/** Graded (productive) outcome -> FSRS grade. `score` comes from
 *  gradeFillAnswer (src/content/grading.ts): 1/0.85 = strong recall (Easy),
 *  0.6 = recalled with help (Good), 0 = Again. Latency is not used here —
 *  score already captures how close the answer was, which is the stronger
 *  signal for typed recall. */
export function gradeForScore(score: number): Grade {
  if (score >= 0.85) return Rating.Easy;
  if (score >= 0.6) return Rating.Good;
  return Rating.Again;
}

// ── FsrsState (Prisma enum) <-> State (ts-fsrs enum) ──
const TO_FSRS_STATE: Record<FsrsState, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};
const FROM_FSRS_STATE: Record<State, FsrsState> = {
  [State.New]: "new",
  [State.Learning]: "learning",
  [State.Review]: "review",
  [State.Relearning]: "relearning",
};

/** The persisted subset of an FSRS card (what ReviewState stores). */
export interface CardFields {
  stability: number;
  difficulty: number;
  due: Date;
  lastReview: Date | null;
  reps: number;
  lapses: number;
  state: FsrsState;
}

/** Rebuild a ts-fsrs Card from persisted fields. elapsed/scheduled_days are
 *  recomputed by the scheduler from last_review + now, so 0 is safe here. */
function toCard(f: CardFields): Card {
  return {
    due: f.due,
    stability: f.stability,
    difficulty: f.difficulty,
    elapsed_days: 0,
    scheduled_days: 0,
    reps: f.reps,
    lapses: f.lapses,
    state: TO_FSRS_STATE[f.state],
    last_review: f.lastReview ?? undefined,
  };
}

function fromCard(c: Card): CardFields {
  return {
    stability: c.stability,
    difficulty: c.difficulty,
    due: c.due,
    lastReview: c.last_review ?? null,
    reps: c.reps,
    lapses: c.lapses,
    state: FROM_FSRS_STATE[c.state],
  };
}

/**
 * PURE scheduling step. Given the prior card fields (or null for a first-ever
 * review) plus the grade and the review timestamp, return the next card fields.
 * No IO — fully deterministic, the unit under test.
 */
export function nextCardFields(
  prev: CardFields | null,
  grade: Grade,
  at: Date,
): CardFields {
  const card = prev ? toCard(prev) : createEmptyCard(at);
  const { card: next } = scheduler.next(card, at, grade);
  return fromCard(next);
}

/** Current retrievability R(t) in [0,1] for a card at time `now`. Drives mastery. */
export function retrievabilityOf(f: CardFields, now: Date): number {
  return scheduler.get_retrievability(toCard(f), now, false);
}

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Apply one study/review attempt to a card's FSRS state and persist it.
 * `at` MUST be the attempt's createdAt (never Date.now()) so live scheduling
 * matches a later full replay. Placement attempts are NOT scheduled.
 */
export async function applyAttempt(
  db: Db,
  args: {
    userId: string;
    exerciseId: string;
    correct: boolean;
    latencyMs: number;
    sessionType: SessionType;
    at: Date;
    /** Present for graded (productive) exercises; drives FSRS grade quality
     *  instead of the plain correct/latency heuristic. */
    score?: number | null;
  },
): Promise<ReviewState | null> {
  if (args.sessionType === "placement") return null;

  const existing = await db.reviewState.findUnique({
    where: { userId_exerciseId: { userId: args.userId, exerciseId: args.exerciseId } },
  });

  const grade = args.score != null ? gradeForScore(args.score) : gradeFor(args.correct, args.latencyMs);
  const next = nextCardFields(existing, grade, args.at);

  return db.reviewState.upsert({
    where: { userId_exerciseId: { userId: args.userId, exerciseId: args.exerciseId } },
    create: {
      userId: args.userId,
      exerciseId: args.exerciseId,
      ...next,
      fsrsParamsVersion: FSRS_PARAMS_VERSION,
    },
    update: {
      ...next,
      fsrsParamsVersion: FSRS_PARAMS_VERSION,
    },
  });
}
