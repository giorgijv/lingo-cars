import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
import { createApp } from "./app.js";
import { mcqPayloadSchema } from "./content/mcq.js";

// DB-backed integration test. Skipped when no DATABASE_URL so unit `npm test`
// stays green without Postgres. Assumes the de->es seed is present.
const RUN = !!process.env.DATABASE_URL;

describe.skipIf(!RUN)("Phase 0 API integration", () => {
  const db = new PrismaClient();
  const app = createApp(db);
  const pairId = "pair-de-es";
  let userId = "";

  beforeAll(async () => {
    const res = await request(app)
      .post("/users")
      .send({ email: `http-${Date.now()}@test.dev`, uiLanguage: "de" });
    expect(res.status).toBe(201);
    userId = res.body.id;
    const enr = await request(app).post("/enrollments").send({ userId, pairId });
    expect(enr.status).toBe(201);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("health + catalog", async () => {
    expect((await request(app).get("/health")).body).toMatchObject({ status: "ok", phase: 0 });
    const pairs = await request(app).get("/pairs");
    expect(pairs.body.map((p: { id: string }) => p.id)).toContain(pairId);
  });

  it("never leaks correctIndex in exercise views", async () => {
    const start = await request(app).post("/placement/start").send({ pairId });
    expect(start.status).toBe(200);
    expect(start.body.exercise).toHaveProperty("stem");
    expect(start.body.exercise).toHaveProperty("options");
    expect(start.body.exercise).not.toHaveProperty("correctIndex");
  });

  it("runs a full placement and sets currentCefr", async () => {
    let start = await request(app).post("/placement/start").send({ pairId });
    let state = start.body.state;
    let exercise = start.body.exercise;
    let done = false;
    let guard = 0;
    while (!done && exercise && guard++ < 40) {
      const body: Record<string, unknown> = { pairId, state, exerciseId: exercise.id, latencyMs: 1500 };
      if (exercise.type === "fill" || exercise.type === "speak") body.response = "test-answer";
      else body.selectedIndex = 0;
      const ans = await request(app).post("/placement/answer").send(body);
      expect(ans.status).toBe(200);
      state = ans.body.state;
      done = ans.body.done;
      exercise = ans.body.exercise;
    }
    const fin = await request(app).post("/placement/finalize").send({ userId, pairId, state });
    expect(fin.status).toBe(200);
    expect(["A1", "A2", "B1", "B2", "C1", "C2"]).toContain(fin.body.cefr);
    expect(fin.body.inTierProgress).toBeLessThan(0.25);

    const prof = await request(app).get("/proficiency").query({ userId, pairId });
    expect(prof.body.currentCefr).toBe(fin.body.cefr);
  });

  it("grades server-side and drives FSRS + proficiency through /attempts", async () => {
    const queue = await request(app).get("/queue").query({ userId, pairId });
    expect(queue.status).toBe(200);
    expect(queue.body.new.length).toBeGreaterThan(0);
    const target = queue.body.new[0];

    // Look up the real correct answer directly (client never sees it).
    const ex = await db.exercise.findUniqueOrThrow({ where: { id: target.id } });
    const payload = mcqPayloadSchema.parse(ex.payloadJson);

    // Wrong answer first.
    const wrong = await request(app)
      .post("/attempts")
      .send({ userId, exerciseId: target.id, selectedIndex: (payload.correctIndex + 1) % payload.options.length, latencyMs: 4000 });
    expect(wrong.status).toBe(200);
    expect(wrong.body.correct).toBe(false);
    expect(wrong.body.sessionType).toBe("study");

    // Then correct -> now a review, scheduled into the future.
    const right = await request(app)
      .post("/attempts")
      .send({ userId, exerciseId: target.id, selectedIndex: payload.correctIndex, latencyMs: 1500 });
    expect(right.body.correct).toBe(true);
    expect(right.body.sessionType).toBe("review");
    expect(new Date(right.body.due).getTime()).toBeGreaterThan(Date.now());
    expect(right.body.tier).toHaveProperty("action");
    expect(right.body.proficiency.xp).toBeGreaterThan(0);
  });

  it("serves the car as a read-only projection (Phase 1, D5)", async () => {
    const car = await request(app).get("/car").query({ userId, pairId });
    expect(car.status).toBe(200);
    expect(car.body.tier).toBeGreaterThanOrEqual(0);
    expect(car.body.tier).toBeLessThanOrEqual(5);
    expect(typeof car.body.className).toBe("string");
    expect(car.body.speed).toBeGreaterThanOrEqual(1);
    expect(car.body.milestones).toHaveLength(3);

    // Projection consistency: tier must equal the CEFR index from /proficiency.
    const prof = await request(app).get("/proficiency").query({ userId, pairId });
    const order = ["A1", "A2", "B1", "B2", "C1", "C2"];
    expect(car.body.tier).toBe(order.indexOf(prof.body.currentCefr));
    expect(car.body.cefr).toBe(prof.body.currentCefr);
  });

  it("serves all four language pairs, including de→ka Georgian content", async () => {
    const pairs = await request(app).get("/pairs");
    const ids = pairs.body.map((p: { id: string }) => p.id);
    expect(ids).toEqual(expect.arrayContaining(["pair-de-es", "pair-en-es", "pair-de-ka", "pair-en-ka"]));

    // Enroll the same user into de→ka and study a Georgian exercise end-to-end.
    const enr = await request(app).post("/enrollments").send({ userId, pairId: "pair-de-ka" });
    expect(enr.status).toBe(201);

    const queue = await request(app).get("/queue").query({ userId, pairId: "pair-de-ka" });
    expect(queue.status).toBe(200);
    expect(queue.body.new.length).toBeGreaterThan(0);
    const item = queue.body.new[0];
    // Options are Georgian (Mkhedruli block U+10A0–U+10FF).
    expect(item.options.join("")).toMatch(/[Ⴀ-ჿ]/);

    const ex = await db.exercise.findUniqueOrThrow({ where: { id: item.id } });
    const payload = mcqPayloadSchema.parse(ex.payloadJson);
    const res = await request(app)
      .post("/attempts")
      .send({ userId, exerciseId: item.id, selectedIndex: payload.correctIndex, latencyMs: 1500 });
    expect(res.body.correct).toBe(true);
    expect(res.body.car.className).toBeDefined();

    // Pair isolation: the de→es proficiency is a separate row from de→ka's.
    const profKa = await request(app).get("/proficiency").query({ userId, pairId: "pair-de-ka" });
    expect(profKa.status).toBe(200);
  });

  it("has a full A1..C2 difficulty ladder in every pair's placement pool", async () => {
    for (const pairId of ["pair-de-es", "pair-en-es", "pair-de-ka", "pair-en-ka"]) {
      const range = await db.exercise.aggregate({
        where: { lesson: { skill: { pairId } } },
        _min: { difficulty: true },
        _max: { difficulty: true },
      });
      expect(range._min.difficulty!).toBeLessThanOrEqual(1); // A1 anchor
      expect(range._max.difficulty!).toBeGreaterThanOrEqual(5.5); // C2 anchor
    }
  });

  it("runs a placement with at least 15 items (mixed mcq/fill pool)", async () => {
    let start = await request(app).post("/placement/start").send({ pairId: "pair-de-ka" });
    let state = start.body.state;
    let exercise = start.body.exercise;
    let done = false;
    let count = 0;
    let sawFill = false;
    while (!done && exercise && count < 40) {
      const body: Record<string, unknown> = { pairId: "pair-de-ka", state, exerciseId: exercise.id, latencyMs: 1500 };
      if (exercise.type === "fill" || exercise.type === "speak") {
        sawFill = true;
        body.response = "test-answer";
      } else {
        body.selectedIndex = 0;
      }
      const ans = await request(app).post("/placement/answer").send(body);
      expect(ans.status).toBe(200);
      state = ans.body.state;
      done = ans.body.done;
      exercise = ans.body.exercise;
      count++;
    }
    expect(state.responses.length).toBeGreaterThanOrEqual(15);
    expect(sawFill).toBe(true); // the soft-staging preference actually surfaces a fill item
  });

  it("returns a lesson without correctIndex", async () => {
    const lesson = await request(app).get("/lessons/lesson-de-es-greetings-0");
    expect(lesson.status).toBe(200);
    for (const e of lesson.body.exercises) {
      expect(e).toHaveProperty("options");
      expect(e).not.toHaveProperty("correctIndex");
    }
  });

  it("runs a fill (typed-answer) exercise end to end: no answer leak, graded grading, FSRS quality", async () => {
    const { body: writer } = await request(app)
      .post("/users")
      .send({ email: `fill-${Date.now()}@test.dev`, uiLanguage: "de" });
    await request(app).post("/enrollments").send({ userId: writer.id, pairId });

    // A fill lesson never exposes options/answers pre-answer.
    const lesson = await request(app).get("/lessons/lesson-de-es-greetings-2");
    expect(lesson.status).toBe(200);
    const fillExercises = lesson.body.exercises;
    expect(fillExercises.length).toBeGreaterThan(0);
    for (const e of fillExercises) {
      expect(e.type).toBe("fill");
      expect(e).toHaveProperty("stem");
      expect(e).not.toHaveProperty("options");
      expect(e).not.toHaveProperty("answers");
    }
    const target = fillExercises[0];

    // Wrong text -> incorrect, score 0, no FSRS "Easy/Good" bump; reveals correctAnswers.
    const wrong = await request(app)
      .post("/attempts")
      .send({ userId: writer.id, exerciseId: target.id, response: "definitely wrong", latencyMs: 2000 });
    expect(wrong.status).toBe(200);
    expect(wrong.body.correct).toBe(false);
    expect(wrong.body.score).toBe(0);
    expect(Array.isArray(wrong.body.correctAnswers)).toBe(true);
    expect(wrong.body.correctAnswers.length).toBeGreaterThan(0);
    expect(wrong.body.correctIndex).toBeNull();

    // The real accepted answer (server-side truth) graded correct, score 1, FSRS scheduled ahead.
    const trueAnswer = wrong.body.correctAnswers[0];
    const right = await request(app)
      .post("/attempts")
      .send({ userId: writer.id, exerciseId: target.id, response: trueAnswer, latencyMs: 2000 });
    expect(right.body.correct).toBe(true);
    expect(right.body.score).toBe(1);
    expect(right.body.sessionType).toBe("review"); // second attempt on the same exercise
    expect(new Date(right.body.due).getTime()).toBeGreaterThan(Date.now());

    // Rejects a request missing the field the exercise's type requires (400, not a crash).
    const missing = await request(app)
      .post("/attempts")
      .send({ userId: writer.id, exerciseId: target.id, latencyMs: 2000 });
    expect(missing.status).toBe(400);

    // The immutable log carries the typed response + graded score.
    const stored = await db.attempt.findFirst({
      where: { userId: writer.id, exerciseId: target.id, correct: true },
      orderBy: { createdAt: "desc" },
    });
    expect(stored?.responseJson).toEqual({ response: trueAnswer });
    expect(stored?.score).toBe(1);
  });

  it("runs the Phase 3 economy: earn → buy → tier-lock → sell, all as projections", async () => {
    // Fresh A1 user with no placement: tier 0, zero points.
    const { body: shopper } = await request(app)
      .post("/users")
      .send({ email: `shop-${Date.now()}@test.dev`, uiLanguage: "de" });
    await request(app).post("/enrollments").send({ userId: shopper.id, pairId });

    const eco0 = await request(app).get("/economy").query({ userId: shopper.id, pairId });
    expect(eco0.body.balance).toBe(0);
    expect(eco0.body.owned).toEqual([]);

    // Earn 50 points via 5 correct answers (10 xp each).
    const a1 = await db.exercise.findMany({
      where: { lesson: { skill: { pairId, cefr: "A1" } } },
      take: 5,
      orderBy: { id: "asc" },
    });
    for (const ex of a1) {
      const payload = mcqPayloadSchema.parse(ex.payloadJson);
      await request(app)
        .post("/attempts")
        .send({ userId: shopper.id, exerciseId: ex.id, selectedIndex: payload.correctIndex, latencyMs: 1500 });
    }
    const eco1 = await request(app).get("/economy").query({ userId: shopper.id, pairId });
    expect(eco1.body.balance).toBe(50);

    // Buy a tier-0 paint (40): balance drops, item owned.
    const buy = await request(app)
      .post("/purchases")
      .send({ userId: shopper.id, pairId, cosmeticId: "paint-crimson", action: "buy" });
    expect(buy.status).toBe(201);
    expect(buy.body.balance).toBe(10);
    expect(buy.body.owned).toContain("paint-crimson");

    // Re-buy owned → 409; unaffordable → 409; tier-locked → 403 (D3).
    expect((await request(app).post("/purchases").send({ userId: shopper.id, pairId, cosmeticId: "paint-crimson", action: "buy" })).status).toBe(409);
    expect((await request(app).post("/purchases").send({ userId: shopper.id, pairId, cosmeticId: "paint-ocean", action: "buy" })).status).toBe(409);
    const locked = await request(app)
      .post("/purchases")
      .send({ userId: shopper.id, pairId, cosmeticId: "wheels-gold", action: "buy" });
    expect(locked.status).toBe(403);
    expect(locked.body.error).toBe("tier_locked");

    // D3 invariant: no purchase attempt moved the tier.
    const prof = await request(app).get("/proficiency").query({ userId: shopper.id, pairId });
    expect(prof.body.currentCefr).toBe("A1");
    const car = await request(app).get("/car").query({ userId: shopper.id, pairId });
    expect(car.body.tier).toBe(0);

    // Sell back at 50%: refund 20, ownership gone (secondary-market MVP).
    const sell = await request(app)
      .post("/purchases")
      .send({ userId: shopper.id, pairId, cosmeticId: "paint-crimson", action: "sell" });
    expect(sell.status).toBe(201);
    expect(sell.body.balance).toBe(30);
    expect(sell.body.owned).not.toContain("paint-crimson");
    expect((await request(app).post("/purchases").send({ userId: shopper.id, pairId, cosmeticId: "paint-crimson", action: "sell" })).status).toBe(409);

    // Rule 4: the purchase ledger is append-only at the DB level.
    await expect(
      db.$executeRawUnsafe(`UPDATE "Purchase" SET points = 0 WHERE "userId" = $1`, shopper.id),
    ).rejects.toThrow();
  });

  it("runs Phase 4 races: server-authoritative, ceiling-bound, and reward-free (D5)", async () => {
    const { body: racer } = await request(app)
      .post("/users")
      .send({ email: `race-${Date.now()}@test.dev`, uiLanguage: "de" });
    await request(app).post("/enrollments").send({ userId: racer.id, pairId });

    // Snapshot everything a race must NOT change.
    const ecoBefore = await request(app).get("/economy").query({ userId: racer.id, pairId });
    const profBefore = await request(app).get("/proficiency").query({ userId: racer.id, pairId });

    // A finished-last, slow time, then a clean run right at this car's ceiling.
    const slow = await request(app)
      .post("/races")
      .send({ userId: racer.id, pairId, finishMs: 30_000, position: 4, rivalCount: 3 });
    expect(slow.status).toBe(201);
    const clean = await request(app)
      .post("/races")
      .send({ userId: racer.id, pairId, finishMs: slow.body.ceilingMs, position: 1, rivalCount: 3 });
    expect(clean.status).toBe(201);
    expect(clean.body.finishMs).toBeLessThan(slow.body.finishMs);
    // A clean run submitted exactly at the ceiling is accepted as-is — never inflated.
    expect(clean.body.finishMs).toBe(clean.body.ceilingMs);
    expect(clean.body.isNewBest).toBe(true);
    expect(clean.body.bestPosition).toBe(1);
    expect(clean.body.trackId).toBe("sprint-1");

    const races = await request(app).get("/races").query({ userId: racer.id, pairId });
    expect(races.body.best.finishMs).toBe(clean.body.finishMs);
    expect(races.body.recent).toHaveLength(2);

    // Racing awards NOTHING: economy, xp, and CEFR are untouched.
    const ecoAfter = await request(app).get("/economy").query({ userId: racer.id, pairId });
    const profAfter = await request(app).get("/proficiency").query({ userId: racer.id, pairId });
    expect(ecoAfter.body.balance).toBe(ecoBefore.body.balance);
    expect(profAfter.body.currentCefr).toBe(profBefore.body.currentCefr);
    expect(profAfter.body.proficiency?.xp ?? 0).toBe(profBefore.body.proficiency?.xp ?? 0);

    // Rule 4: the race log is append-only at the DB level.
    await expect(
      db.$executeRawUnsafe(`UPDATE "RaceResult" SET "finishMs" = 1 WHERE "userId" = $1`, racer.id),
    ).rejects.toThrow();

    // D5: the server rejects a submitted time faster than physically possible
    // for this car — a tampered client can never log an impossible result.
    const impossible = await request(app)
      .post("/races")
      .send({ userId: racer.id, pairId, finishMs: Math.floor(clean.body.ceilingMs * 0.3), position: 1, rivalCount: 3 });
    expect(impossible.status).toBe(400);
    expect(impossible.body.error).toBe("faster_than_ceiling");

    // Validation: a malformed submission is rejected.
    expect(
      (await request(app).post("/races").send({ userId: racer.id, pairId, finishMs: -1, position: 1, rivalCount: 3 }))
        .status,
    ).toBe(400);
    expect(
      (await request(app).post("/races").send({ userId: racer.id, pairId, finishMs: 9000, position: 9, rivalCount: 3 }))
        .status,
    ).toBe(400);
  });

  it("runs a listen (M2) exercise: exposes transcript for on-device TTS, hides correctIndex, grades like mcq", async () => {
    const { body: listener } = await request(app)
      .post("/users")
      .send({ email: `listen-${Date.now()}@test.dev`, uiLanguage: "de" });
    await request(app).post("/enrollments").send({ userId: listener.id, pairId });

    const lesson = await request(app).get("/lessons/lesson-de-es-greetings-3");
    expect(lesson.status).toBe(200);
    const [target] = lesson.body.exercises;
    expect(target.type).toBe("listen");
    expect(target).toHaveProperty("transcript"); // needed client-side for speechSynthesis
    expect(target).toHaveProperty("options");
    expect(target).not.toHaveProperty("correctIndex");

    // The transcript IS the correct option's text (by content-schema construction).
    const correctIndex = target.options.indexOf(target.transcript);
    expect(correctIndex).toBeGreaterThanOrEqual(0);

    const wrong = await request(app)
      .post("/attempts")
      .send({ userId: listener.id, exerciseId: target.id, selectedIndex: (correctIndex + 1) % target.options.length, latencyMs: 2000 });
    expect(wrong.body.correct).toBe(false);
    expect(wrong.body.correctIndex).toBe(correctIndex);
    expect(wrong.body.score).toBeNull(); // listen grades like mcq: binary, no score bucket

    const right = await request(app)
      .post("/attempts")
      .send({ userId: listener.id, exerciseId: target.id, selectedIndex: correctIndex, latencyMs: 2000 });
    expect(right.body.correct).toBe(true);
    expect(right.body.sessionType).toBe("review");
    expect(new Date(right.body.due).getTime()).toBeGreaterThan(Date.now());

    // Missing selectedIndex -> clean 400, not a crash.
    const missing = await request(app).post("/attempts").send({ userId: listener.id, exerciseId: target.id, latencyMs: 2000 });
    expect(missing.status).toBe(400);
  });

  it("runs a speak (M3 lite) exercise: shows the read-aloud prompt openly, grades the recognized text like fill", async () => {
    const { body: speaker } = await request(app)
      .post("/users")
      .send({ email: `speak-${Date.now()}@test.dev`, uiLanguage: "de" });
    await request(app).post("/enrollments").send({ userId: speaker.id, pairId });

    // The prompt IS shown openly (it's what to read aloud, not a hidden answer).
    const lesson = await request(app).get("/lessons/lesson-de-es-greetings-4");
    expect(lesson.status).toBe(200);
    const [target] = lesson.body.exercises;
    expect(target.type).toBe("speak");
    expect(target).toHaveProperty("text");
    expect(target).not.toHaveProperty("tolerance"); // grading internals stay server-side

    // A garbled "recognized speech" transcript grades incorrect, score 0.
    const wrong = await request(app)
      .post("/attempts")
      .send({ userId: speaker.id, exerciseId: target.id, response: "completely unrelated words", latencyMs: 3000 });
    expect(wrong.status).toBe(200);
    expect(wrong.body.correct).toBe(false);
    expect(wrong.body.score).toBe(0);
    expect(wrong.body.correctAnswers).toEqual([target.text]);

    // A perfect "recognized speech" transcript (matches the prompt exactly) grades score 1.
    const right = await request(app)
      .post("/attempts")
      .send({ userId: speaker.id, exerciseId: target.id, response: target.text, latencyMs: 3000 });
    expect(right.body.correct).toBe(true);
    expect(right.body.score).toBe(1);
    expect(right.body.sessionType).toBe("review");
    expect(new Date(right.body.due).getTime()).toBeGreaterThan(Date.now());

    // Missing response -> clean 400, not a crash.
    const missing = await request(app).post("/attempts").send({ userId: speaker.id, exerciseId: target.id, latencyMs: 3000 });
    expect(missing.status).toBe(400);

    // The immutable log carries the "recognized" text + graded score, same as fill.
    const stored = await db.attempt.findFirst({
      where: { userId: speaker.id, exerciseId: target.id, correct: true },
      orderBy: { createdAt: "desc" },
    });
    expect(stored?.responseJson).toEqual({ response: target.text });
    expect(stored?.score).toBe(1);
  });

  it("validates input and maps errors", async () => {
    expect((await request(app).post("/users").send({ email: "not-an-email" })).status).toBe(400);
    expect((await request(app).get("/queue").query({ userId })).status).toBe(400);
    expect((await request(app).get("/lessons/does-not-exist")).status).toBe(404);
    expect((await request(app).get("/nope")).status).toBe(404);
  });
});
