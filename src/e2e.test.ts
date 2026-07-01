import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
import { createApp } from "./app.js";
import { mcqPayloadSchema } from "./content/mcq.js";

// Full learning-loop end-to-end over the real API. Skipped without DATABASE_URL.
// Proves Phase 0: placement -> study -> mastery -> automatic CEFR promotion,
// with the attempt log growing monotonically (append-only).
const RUN = !!process.env.DATABASE_URL;

describe.skipIf(!RUN)("Phase 0 end-to-end learning loop", () => {
  const db = new PrismaClient();
  const app = createApp(db);
  const pairId = "pair-de-es";

  afterAll(async () => {
    await db.$disconnect();
  });

  async function correctIndexOf(exerciseId: string): Promise<number> {
    const ex = await db.exercise.findUniqueOrThrow({ where: { id: exerciseId } });
    return mcqPayloadSchema.parse(ex.payloadJson).correctIndex;
  }

  it("places at A1, then studies A1 to mastery and auto-promotes to A2", async () => {
    // Enroll a fresh learner.
    const { body: user } = await request(app)
      .post("/users")
      .send({ email: `e2e-${Date.now()}@test.dev`, uiLanguage: "de" });
    await request(app).post("/enrollments").send({ userId: user.id, pairId });

    // Placement: answer everything WRONG so the starting bet is A1.
    let start = await request(app).post("/placement/start").send({ pairId });
    let state = start.body.state;
    let exercise = start.body.exercise;
    let done = false;
    let guard = 0;
    while (!done && exercise && guard++ < 40) {
      const ci = await correctIndexOf(exercise.id);
      const wrong = (ci + 1) % exercise.options.length;
      const ans = await request(app)
        .post("/placement/answer")
        .send({ pairId, state, exerciseId: exercise.id, selectedIndex: wrong, latencyMs: 3000 });
      state = ans.body.state;
      done = ans.body.done;
      exercise = ans.body.exercise;
    }
    const fin = await request(app).post("/placement/finalize").send({ userId: user.id, pairId, state });
    expect(fin.body.cefr).toBe("A1");

    const attemptsAfterPlacement = await db.attempt.count({ where: { userId: user.id } });
    expect(attemptsAfterPlacement).toBeGreaterThan(0);

    // All A1 exercises for this pair.
    const a1 = await db.exercise.findMany({
      where: { lesson: { skill: { pairId, cefr: "A1" } } },
      select: { id: true },
      orderBy: { id: "asc" },
    });

    // Study rounds: answer every A1 item correctly until promotion fires.
    let promoted = false;
    let currentCefr = "A1";
    for (let round = 0; round < 4 && !promoted; round++) {
      for (const ex of a1) {
        const ci = await correctIndexOf(ex.id);
        const res = await request(app)
          .post("/attempts")
          .send({ userId: user.id, exerciseId: ex.id, selectedIndex: ci, latencyMs: 1500 });
        expect(res.body.correct).toBe(true);
        currentCefr = res.body.tier.currentCefr;
        if (res.body.tier.action === "promote") {
          promoted = true;
          expect(res.body.tier.nextCefr).toBe("A2");
        }
      }
    }

    expect(promoted).toBe(true);

    // Enrollment now reflects A2; proficiency + FSRS state exist.
    const prof = await request(app).get("/proficiency").query({ userId: user.id, pairId });
    expect(prof.body.currentCefr).toBe("A2");
    expect(prof.body.proficiency.xp).toBeGreaterThan(0);

    const reviewStates = await db.reviewState.count({ where: { userId: user.id } });
    expect(reviewStates).toBe(a1.length);

    // Append-only: the log only grew (placement + study attempts), never shrank.
    const attemptsFinal = await db.attempt.count({ where: { userId: user.id } });
    expect(attemptsFinal).toBeGreaterThan(attemptsAfterPlacement);

    // No API path can mutate the log; a direct UPDATE is rejected by the DB.
    await expect(
      db.$executeRawUnsafe(`UPDATE "Attempt" SET correct = NOT correct WHERE "userId" = $1`, user.id),
    ).rejects.toThrow();
  });
});
