import { Router } from "express";
import { z } from "zod";
import type { Exercise, PrismaClient } from "@prisma/client";
import { asyncHandler, parse } from "./http/validate.js";
import { requireAuth } from "./http/auth.js";
import { hashPassword, verifyPassword } from "./auth/password.js";
import { createSession, deleteSessionToken } from "./auth/session.js";
import { fillPayloadSchema, listenPayloadSchema, mcqPayloadSchema, speakPayloadSchema } from "./content/mcq.js";
import { gradeFillAnswer } from "./content/grading.js";
import { applyAttempt } from "./engine/fsrs.js";
import { recomputeProficiency } from "./engine/proficiency.js";
import { applyTierDecision } from "./engine/mastery.js";
import { getCar } from "./engine/car.js";
import { EconomyError, getEconomy, tradeCosmetic } from "./engine/economy.js";
import { getRaces, MAX_SHIFTS, runRace } from "./engine/race.js";
import {
  answerPlacement,
  finalizePlacement,
  startPlacementSession,
} from "./services/placement.js";

/**
 * Exercise as exposed to clients — never leaks correctIndex/answers (grading
 * is server-side). `listen` DOES expose `transcript`: with no server-rendered
 * audio pipeline in this build (M2 note, plans/placement-modalities.md), the
 * client needs the raw text to synthesize speech on-device. That means a
 * technically curious client could read the answer directly out of the
 * response instead of listening — a real, disclosed limitation of the
 * browser-TTS approach; the UI itself never renders it as visible text.
 */
function publicExercise(ex: Exercise) {
  const base = { id: ex.id, type: ex.type, difficulty: ex.difficulty, lessonId: ex.lessonId };
  if (ex.type === "fill") {
    const p = fillPayloadSchema.parse(ex.payloadJson);
    return { ...base, stem: p.stem };
  }
  if (ex.type === "listen") {
    const p = listenPayloadSchema.parse(ex.payloadJson);
    return { ...base, stem: p.stem, options: p.options, transcript: p.transcript };
  }
  if (ex.type === "speak") {
    // `text` is the prompt to read aloud — shown openly, not a hidden answer.
    const p = speakPayloadSchema.parse(ex.payloadJson);
    return { ...base, stem: p.stem, text: p.text };
  }
  const p = mcqPayloadSchema.parse(ex.payloadJson);
  return { ...base, stem: p.stem, options: p.options };
}

// Standalone schemas so grade() throws a proper ZodError (400, via the shared
// error handler) when the required field for an exercise's type is missing —
// rather than hand-rolling issue objects.
const requireSelectedIndex = z.number({ required_error: "selectedIndex is required for mcq exercises" }).int().nonnegative();
const requireResponse = z.string({ required_error: "response is required for fill exercises" });

/**
 * Grade an mcq/listen selection or a fill/speak response against the stored
 * payload (server-authoritative — clients never see the answer key
 * beforehand). Returns a uniform shape regardless of type so callers don't
 * need to branch. `speak` reuses gradeFillAnswer against its single target
 * sentence — grading "how close is this text" is the same problem whether
 * the text was typed or came from client-side speech recognition.
 */
async function grade(db: PrismaClient, exerciseId: string, input: { selectedIndex?: number; response?: string }) {
  const ex = await db.exercise.findUniqueOrThrow({ where: { id: exerciseId } });

  if (ex.type === "fill") {
    const payload = fillPayloadSchema.parse(ex.payloadJson);
    const response = requireResponse.parse(input.response);
    const graded = gradeFillAnswer(response, payload.answers, payload.tolerance);
    return { correct: graded.correct, score: graded.score, correctIndex: null, correctAnswers: payload.answers, exercise: ex };
  }

  if (ex.type === "speak") {
    const payload = speakPayloadSchema.parse(ex.payloadJson);
    const response = requireResponse.parse(input.response);
    const graded = gradeFillAnswer(response, [payload.text], payload.tolerance);
    return { correct: graded.correct, score: graded.score, correctIndex: null, correctAnswers: [payload.text], exercise: ex };
  }

  // listen and mcq share the selectedIndex mechanic exactly.
  const payload = ex.type === "listen" ? listenPayloadSchema.parse(ex.payloadJson) : mcqPayloadSchema.parse(ex.payloadJson);
  const selectedIndex = requireSelectedIndex.parse(input.selectedIndex);
  const correct = selectedIndex === payload.correctIndex;
  return { correct, score: null as number | null, correctIndex: payload.correctIndex, correctAnswers: null as string[] | null, exercise: ex };
}

// ── zod request schemas ──
// selectedIndex (mcq) XOR response (fill) — exactly which one is required is
// determined server-side by the exercise's own type (see grade()).
const placementStateSchema = z.object({
  ability: z.number(),
  askedExerciseIds: z.array(z.string()),
  responses: z.array(
    z.object({
      exerciseId: z.string(),
      difficulty: z.number(),
      correct: z.boolean(),
      latencyMs: z.number().int().nonnegative(),
      score: z.number().nullable().optional(),
      selectedIndex: z.number().int().nonnegative().optional(),
      response: z.string().optional(),
    }),
  ),
});

const createUserSchema = z.object({
  email: z.string().email(),
  uiLanguage: z.enum(["en", "de"]).default("en"),
});
const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "password must be at least 8 characters"),
  uiLanguage: z.enum(["en", "de"]).default("en"),
});
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
// A JSON blob, not a string/array/primitive; size-capped in the handler (JSON.stringify,
// not this schema) since zod has no byte-length check for arbitrary objects.
const demoStateSchema = z.record(z.string(), z.any());
const DEMO_STATE_MAX_BYTES = 256_000;
const createEnrollmentSchema = z.object({ userId: z.string(), pairId: z.string() });
const placementStartSchema = z.object({ pairId: z.string() });
const placementAnswerSchema = z.object({
  pairId: z.string(),
  state: placementStateSchema,
  exerciseId: z.string(),
  selectedIndex: z.number().int().nonnegative().optional(),
  response: z.string().optional(),
  latencyMs: z.number().int().nonnegative(),
});
const placementFinalizeSchema = z.object({ userId: z.string(), pairId: z.string(), state: placementStateSchema });
const submitAttemptSchema = z.object({
  userId: z.string(),
  exerciseId: z.string(),
  selectedIndex: z.number().int().nonnegative().optional(),
  response: z.string().optional(),
  latencyMs: z.number().int().nonnegative(),
});
const userPairQuery = z.object({ userId: z.string(), pairId: z.string() });

export function createRouter(db: PrismaClient): Router {
  const r = Router();

  // ── Catalog ──
  r.get("/languages", asyncHandler(async (_req, res) => {
    res.json(await db.language.findMany({ orderBy: { code: "asc" } }));
  }));

  r.get("/pairs", asyncHandler(async (_req, res) => {
    res.json(await db.languagePair.findMany({ select: { id: true, sourceCode: true, targetCode: true } }));
  }));

  // ── Users & enrollment ──
  r.post("/users", asyncHandler(async (req, res) => {
    const body = parse(createUserSchema, req.body);
    const user = await db.user.create({ data: body });
    res.status(201).json(user);
  }));

  // ── Auth (login/signup/session) ──
  // Independent of /users above (kept for backward compatibility with the
  // existing Phase 0-4 flows, which don't require a password). A signed-up
  // user's progress (enrollments, attempts, proficiency, car, economy, races)
  // is already keyed by userId and stored in Postgres — it was always
  // cross-device in principle; logging in is what lets a *client* prove which
  // userId it's allowed to read/write, and is what the demo UI now uses to
  // resolve "your" userId on any device instead of a per-browser localStorage id.
  r.post("/auth/signup", asyncHandler(async (req, res) => {
    const { email, password, uiLanguage } = parse(signupSchema, req.body);
    const passwordHash = await hashPassword(password);
    const user = await db.user.create({ data: { email, passwordHash, uiLanguage } });
    const { token, expiresAt } = await createSession(db, user.id);
    res.status(201).json({ token, expiresAt, user: { id: user.id, email: user.email, uiLanguage: user.uiLanguage } });
  }));

  r.post("/auth/login", asyncHandler(async (req, res) => {
    const { email, password } = parse(loginSchema, req.body);
    const user = await db.user.findUnique({ where: { email } });
    if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }
    const { token, expiresAt } = await createSession(db, user.id);
    res.json({ token, expiresAt, user: { id: user.id, email: user.email, uiLanguage: user.uiLanguage } });
  }));

  r.post("/auth/logout", requireAuth(db), asyncHandler(async (req, res) => {
    const token = req.header("authorization")!.slice("Bearer ".length).trim();
    await deleteSessionToken(db, token);
    res.status(204).end();
  }));

  r.get("/auth/me", requireAuth(db), asyncHandler(async (req, res) => {
    const { id, email, uiLanguage } = req.user!;
    res.json({ id, email, uiLanguage });
  }));

  // ── Demo progress sync (cross-device) ──
  // The docs/index.html demo keeps its own client-simulated state (car tier,
  // per-item mastery, xp, cosmetics) as a single JSON blob — previously
  // localStorage-only, so it never left the browser it was created in. These
  // two endpoints let a logged-in demo user's blob follow them to any device:
  // GET on login/load, PUT after every local save. Size-capped to keep this
  // an honest progress blob, not a general-purpose object store.
  r.get("/me/demo-state", requireAuth(db), asyncHandler(async (req, res) => {
    const row = await db.demoState.findUnique({ where: { userId: req.user!.id } });
    res.json({ state: row?.stateJson ?? null, updatedAt: row?.updatedAt ?? null });
  }));

  r.put("/me/demo-state", requireAuth(db), asyncHandler(async (req, res) => {
    const state = parse(demoStateSchema, req.body?.state);
    const json = JSON.stringify(state);
    if (Buffer.byteLength(json, "utf8") > DEMO_STATE_MAX_BYTES) {
      res.status(413).json({ error: "demo_state_too_large", maxBytes: DEMO_STATE_MAX_BYTES });
      return;
    }
    const row = await db.demoState.upsert({
      where: { userId: req.user!.id },
      create: { userId: req.user!.id, stateJson: state },
      update: { stateJson: state },
    });
    res.json({ state: row.stateJson, updatedAt: row.updatedAt });
  }));

  r.post("/enrollments", asyncHandler(async (req, res) => {
    const { userId, pairId } = parse(createEnrollmentSchema, req.body);
    const enrollment = await db.enrollment.create({ data: { userId, pairId } });
    res.status(201).json(enrollment);
  }));

  // ── Placement (stateless: client threads `state`) ──
  r.post("/placement/start", asyncHandler(async (req, res) => {
    const { pairId } = parse(placementStartSchema, req.body);
    const { state, item } = await startPlacementSession(db, pairId);
    res.json({ state, item: item ? { id: item.id, difficulty: item.difficulty } : null, exercise: item ? publicExercise(await db.exercise.findUniqueOrThrow({ where: { id: item.id } })) : null });
  }));

  r.post("/placement/answer", asyncHandler(async (req, res) => {
    const { pairId, state, exerciseId, selectedIndex, response, latencyMs } = parse(placementAnswerSchema, req.body);
    const graded = await grade(db, exerciseId, { selectedIndex, response });
    const out = await answerPlacement(db, pairId, state, exerciseId, graded.correct, latencyMs, {
      score: graded.score,
      selectedIndex,
      response,
    });
    res.json({
      state: out.state,
      done: out.done,
      correct: graded.correct,
      exercise: out.item ? publicExercise(await db.exercise.findUniqueOrThrow({ where: { id: out.item.id } })) : null,
    });
  }));

  r.post("/placement/finalize", asyncHandler(async (req, res) => {
    const { userId, pairId, state } = parse(placementFinalizeSchema, req.body);
    const result = await finalizePlacement(db, userId, pairId, state);
    res.json(result);
  }));

  // ── Study loop ──
  r.get("/lessons/:id", asyncHandler(async (req, res) => {
    const lesson = await db.lesson.findUniqueOrThrow({
      where: { id: req.params.id },
      include: { exercises: { orderBy: { id: "asc" } } },
    });
    res.json({ id: lesson.id, skillId: lesson.skillId, orderIdx: lesson.orderIdx, exercises: lesson.exercises.map(publicExercise) });
  }));

  // Due reviews + new items for the learner's current tier.
  r.get("/queue", asyncHandler(async (req, res) => {
    const { userId, pairId } = parse(userPairQuery, req.query);
    const now = new Date();
    const enrollment = await db.enrollment.findUniqueOrThrow({ where: { userId_pairId: { userId, pairId } } });

    const dueStates = await db.reviewState.findMany({
      where: { userId, due: { lte: now }, exercise: { lesson: { skill: { pairId } } } },
      orderBy: { due: "asc" },
      take: 20,
      include: { exercise: true },
    });

    const newExercises = await db.exercise.findMany({
      where: {
        lesson: { skill: { pairId, cefr: enrollment.currentCefr } },
        reviewStates: { none: { userId } },
      },
      orderBy: { id: "asc" },
      take: 10,
    });

    res.json({
      currentCefr: enrollment.currentCefr,
      due: dueStates.map((s) => ({ due: s.due, ...publicExercise(s.exercise) })),
      new: newExercises.map(publicExercise),
    });
  }));

  // Submit an answer: append to the immutable log, then FSRS -> mastery -> tier,
  // all in one transaction. Grading is server-authoritative.
  r.post("/attempts", asyncHandler(async (req, res) => {
    const { userId, exerciseId, selectedIndex, response, latencyMs } = parse(submitAttemptSchema, req.body);
    const { correct, score, correctIndex, correctAnswers, exercise } = await grade(db, exerciseId, { selectedIndex, response });

    const pair = await db.languagePair.findFirstOrThrow({
      where: { skills: { some: { lessons: { some: { id: exercise.lessonId } } } } },
      select: { id: true },
    });

    const responseJson =
      response !== undefined ? { response } : selectedIndex !== undefined ? { selectedIndex } : undefined;

    const out = await db.$transaction(async (tx) => {
      const existing = await tx.reviewState.findUnique({
        where: { userId_exerciseId: { userId, exerciseId } },
      });
      const sessionType = existing ? ("review" as const) : ("study" as const);
      const at = new Date();

      await tx.attempt.create({ data: { userId, exerciseId, correct, latencyMs, sessionType, createdAt: at, score, responseJson } });
      const reviewState = await applyAttempt(tx, { userId, exerciseId, correct, latencyMs, sessionType, at, score });
      await recomputeProficiency(tx, userId, pair.id, at);
      const tier = await applyTierDecision(tx, userId, pair.id, at);
      const proficiency = await tx.proficiencyState.findUnique({ where: { userId_pairId: { userId, pairId: pair.id } } });
      // Phase 1: read-only car projection of the state we just updated (D5).
      const car = await getCar(tx, userId, pair.id);
      return { sessionType, reviewState, tier, proficiency, car };
    });

    res.json({
      correct,
      score,
      correctIndex,
      correctAnswers,
      sessionType: out.sessionType,
      due: out.reviewState?.due ?? null,
      tier: out.tier,
      proficiency: out.proficiency,
      car: out.car,
    });
  }));

  // ── Car projection (Phase 1) — computed on read, never stored (D5) ──
  r.get("/car", asyncHandler(async (req, res) => {
    const { userId, pairId } = parse(userPairQuery, req.query);
    res.json(await getCar(db, userId, pairId));
  }));

  // ── Economy (Phase 3) — balance/ownership are projections of xp + the
  //    immutable Purchase ledger. Buying is gated to unlocked tiers (D3). ──
  r.get("/economy", asyncHandler(async (req, res) => {
    const { userId, pairId } = parse(userPairQuery, req.query);
    res.json(await getEconomy(db, userId, pairId));
  }));

  const tradeSchema = z.object({
    userId: z.string(),
    pairId: z.string(),
    cosmeticId: z.string(),
    action: z.enum(["buy", "sell"]),
  });
  r.post("/purchases", asyncHandler(async (req, res) => {
    const { userId, pairId, cosmeticId, action } = parse(tradeSchema, req.body);
    try {
      // Serialized so concurrent trades can't double-spend a balance check.
      const economy = await db.$transaction(
        (tx) => tradeCosmetic(tx, userId, pairId, cosmeticId, action),
        { isolationLevel: "Serializable" },
      );
      res.status(201).json(economy);
    } catch (err) {
      if (err instanceof EconomyError) {
        const status = err.code === "unknown_cosmetic" ? 404 : err.code === "tier_locked" ? 403 : 409;
        return res.status(status).json({ error: err.code, message: err.message });
      }
      throw err;
    }
  }));

  // ── Race minigame (Phase 4) — proficiency is the ceiling (D5); racing
  //    appends to an immutable log and awards nothing (no points/xp/CEFR). ──
  const raceSchema = z.object({
    userId: z.string(),
    pairId: z.string(),
    shiftAccuracies: z.array(z.number().min(0).max(1)).min(1).max(MAX_SHIFTS),
  });
  r.post("/races", asyncHandler(async (req, res) => {
    const { userId, pairId, shiftAccuracies } = parse(raceSchema, req.body);
    const run = await runRace(db, userId, pairId, shiftAccuracies);
    res.status(201).json({
      finishMs: run.outcome.finishMs,
      ceilingMs: run.outcome.ceilingMs,
      skillScore: run.outcome.skillScore,
      bestMs: run.bestMs,
      isNewBest: run.isNewBest,
      car: { tier: run.car.tier, className: run.car.className, speed: run.car.speed, handling: run.car.handling },
    });
  }));

  r.get("/races", asyncHandler(async (req, res) => {
    const { userId, pairId } = parse(userPairQuery, req.query);
    res.json(await getRaces(db, userId, pairId));
  }));

  // ── Proficiency read ──
  r.get("/proficiency", asyncHandler(async (req, res) => {
    const { userId, pairId } = parse(userPairQuery, req.query);
    const enrollment = await db.enrollment.findUniqueOrThrow({ where: { userId_pairId: { userId, pairId } } });
    const proficiency = await db.proficiencyState.findUnique({ where: { userId_pairId: { userId, pairId } } });
    res.json({ currentCefr: enrollment.currentCefr, proficiency });
  }));

  return r;
}
