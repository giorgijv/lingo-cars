import { Router } from "express";
import { z } from "zod";
import type { Exercise, PrismaClient } from "@prisma/client";
import { asyncHandler, parse } from "./http/validate.js";
import { mcqPayloadSchema } from "./content/mcq.js";
import { applyAttempt } from "./engine/fsrs.js";
import { recomputeProficiency } from "./engine/proficiency.js";
import { applyTierDecision } from "./engine/mastery.js";
import { getCar } from "./engine/car.js";
import {
  answerPlacement,
  finalizePlacement,
  startPlacementSession,
} from "./services/placement.js";

/** Exercise as exposed to clients — never leaks correctIndex (grading is server-side). */
function publicExercise(ex: Exercise) {
  const p = mcqPayloadSchema.parse(ex.payloadJson);
  return { id: ex.id, type: ex.type, difficulty: ex.difficulty, lessonId: ex.lessonId, stem: p.stem, options: p.options };
}

/** Grade a selected option against the stored payload (server-authoritative). */
async function grade(db: PrismaClient, exerciseId: string, selectedIndex: number) {
  const ex = await db.exercise.findUniqueOrThrow({ where: { id: exerciseId } });
  const payload = mcqPayloadSchema.parse(ex.payloadJson);
  return { correct: selectedIndex === payload.correctIndex, correctIndex: payload.correctIndex, exercise: ex };
}

// ── zod request schemas ──
const placementStateSchema = z.object({
  ability: z.number(),
  askedExerciseIds: z.array(z.string()),
  responses: z.array(
    z.object({
      exerciseId: z.string(),
      difficulty: z.number(),
      correct: z.boolean(),
      latencyMs: z.number().int().nonnegative(),
    }),
  ),
});

const createUserSchema = z.object({
  email: z.string().email(),
  uiLanguage: z.enum(["en", "de"]).default("en"),
});
const createEnrollmentSchema = z.object({ userId: z.string(), pairId: z.string() });
const placementStartSchema = z.object({ pairId: z.string() });
const placementAnswerSchema = z.object({
  pairId: z.string(),
  state: placementStateSchema,
  exerciseId: z.string(),
  selectedIndex: z.number().int().nonnegative(),
  latencyMs: z.number().int().nonnegative(),
});
const placementFinalizeSchema = z.object({ userId: z.string(), pairId: z.string(), state: placementStateSchema });
const submitAttemptSchema = z.object({
  userId: z.string(),
  exerciseId: z.string(),
  selectedIndex: z.number().int().nonnegative(),
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
    const { pairId, state, exerciseId, selectedIndex, latencyMs } = parse(placementAnswerSchema, req.body);
    const { correct } = await grade(db, exerciseId, selectedIndex);
    const out = await answerPlacement(db, pairId, state, exerciseId, correct, latencyMs);
    res.json({
      state: out.state,
      done: out.done,
      correct,
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
    const { userId, exerciseId, selectedIndex, latencyMs } = parse(submitAttemptSchema, req.body);
    const { correct, correctIndex, exercise } = await grade(db, exerciseId, selectedIndex);

    const pair = await db.languagePair.findFirstOrThrow({
      where: { skills: { some: { lessons: { some: { id: exercise.lessonId } } } } },
      select: { id: true },
    });

    const out = await db.$transaction(async (tx) => {
      const existing = await tx.reviewState.findUnique({
        where: { userId_exerciseId: { userId, exerciseId } },
      });
      const sessionType = existing ? ("review" as const) : ("study" as const);
      const at = new Date();

      await tx.attempt.create({ data: { userId, exerciseId, correct, latencyMs, sessionType, createdAt: at } });
      const reviewState = await applyAttempt(tx, { userId, exerciseId, correct, latencyMs, sessionType, at });
      await recomputeProficiency(tx, userId, pair.id, at);
      const tier = await applyTierDecision(tx, userId, pair.id, at);
      const proficiency = await tx.proficiencyState.findUnique({ where: { userId_pairId: { userId, pairId: pair.id } } });
      // Phase 1: read-only car projection of the state we just updated (D5).
      const car = await getCar(tx, userId, pair.id);
      return { sessionType, reviewState, tier, proficiency, car };
    });

    res.json({
      correct,
      correctIndex,
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

  // ── Proficiency read ──
  r.get("/proficiency", asyncHandler(async (req, res) => {
    const { userId, pairId } = parse(userPairQuery, req.query);
    const enrollment = await db.enrollment.findUniqueOrThrow({ where: { userId_pairId: { userId, pairId } } });
    const proficiency = await db.proficiencyState.findUnique({ where: { userId_pairId: { userId, pairId } } });
    res.json({ currentCefr: enrollment.currentCefr, proficiency });
  }));

  return r;
}
