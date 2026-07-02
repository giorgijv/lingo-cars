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
      const ans = await request(app)
        .post("/placement/answer")
        .send({ pairId, state, exerciseId: exercise.id, selectedIndex: 0, latencyMs: 1500 });
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

  it("runs a placement with at least 15 items", async () => {
    let start = await request(app).post("/placement/start").send({ pairId: "pair-de-ka" });
    let state = start.body.state;
    let exercise = start.body.exercise;
    let done = false;
    let count = 0;
    while (!done && exercise && count < 40) {
      const ans = await request(app)
        .post("/placement/answer")
        .send({ pairId: "pair-de-ka", state, exerciseId: exercise.id, selectedIndex: 0, latencyMs: 1500 });
      state = ans.body.state;
      done = ans.body.done;
      exercise = ans.body.exercise;
      count++;
    }
    expect(state.responses.length).toBeGreaterThanOrEqual(15);
  });

  it("returns a lesson without correctIndex", async () => {
    const lesson = await request(app).get("/lessons/lesson-de-es-greetings-0");
    expect(lesson.status).toBe(200);
    for (const e of lesson.body.exercises) {
      expect(e).toHaveProperty("options");
      expect(e).not.toHaveProperty("correctIndex");
    }
  });

  it("validates input and maps errors", async () => {
    expect((await request(app).post("/users").send({ email: "not-an-email" })).status).toBe(400);
    expect((await request(app).get("/queue").query({ userId })).status).toBe(400);
    expect((await request(app).get("/lessons/does-not-exist")).status).toBe(404);
    expect((await request(app).get("/nope")).status).toBe(404);
  });
});
