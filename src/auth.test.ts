import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
import { createApp } from "./app.js";

// DB-backed integration test. Skipped when no DATABASE_URL so unit `npm test`
// stays green without Postgres.
const RUN = !!process.env.DATABASE_URL;

describe.skipIf(!RUN)("Auth: signup, login, sessions, demo-state sync", () => {
  const db = new PrismaClient();
  const app = createApp(db);

  afterAll(async () => {
    await db.$disconnect();
  });

  function freshEmail() {
    return `auth-${Date.now()}-${Math.random().toString(36).slice(2)}@test.dev`;
  }

  it("signs up, returns a usable token, and rejects a duplicate email", async () => {
    const email = freshEmail();
    const signup = await request(app).post("/auth/signup").send({ email, password: "correct horse battery" });
    expect(signup.status).toBe(201);
    expect(signup.body.token).toEqual(expect.any(String));
    expect(signup.body.user.email).toBe(email);

    const me = await request(app).get("/auth/me").set("Authorization", `Bearer ${signup.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(email);

    const dup = await request(app).post("/auth/signup").send({ email, password: "another password" });
    expect(dup.status).toBe(409); // Prisma P2002 on the unique email constraint
  });

  it("rejects signup with a short password", async () => {
    const res = await request(app).post("/auth/signup").send({ email: freshEmail(), password: "short" });
    expect(res.status).toBe(400);
  });

  it("logs in with correct credentials, rejects wrong password and unknown email", async () => {
    const email = freshEmail();
    const password = "a real password 123";
    await request(app).post("/auth/signup").send({ email, password });

    const ok = await request(app).post("/auth/login").send({ email, password });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toEqual(expect.any(String));

    const wrongPassword = await request(app).post("/auth/login").send({ email, password: "nope nope nope" });
    expect(wrongPassword.status).toBe(401);

    const unknownEmail = await request(app).post("/auth/login").send({ email: freshEmail(), password });
    expect(unknownEmail.status).toBe(401);
  });

  it("rejects /auth/me and /me/demo-state with no or a bogus token", async () => {
    const noToken = await request(app).get("/auth/me");
    expect(noToken.status).toBe(401);

    const bogus = await request(app).get("/auth/me").set("Authorization", "Bearer not-a-real-token");
    expect(bogus.status).toBe(401);

    const demoNoToken = await request(app).get("/me/demo-state");
    expect(demoNoToken.status).toBe(401);
  });

  it("invalidates the token on logout", async () => {
    const email = freshEmail();
    const password = "logout test password";
    const signup = await request(app).post("/auth/signup").send({ email, password });
    const token = signup.body.token as string;

    const before = await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`);
    expect(before.status).toBe(200);

    const logout = await request(app).post("/auth/logout").set("Authorization", `Bearer ${token}`);
    expect(logout.status).toBe(204);

    const after = await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`);
    expect(after.status).toBe(401);
  });

  it("syncs demo-state across what stands in for two devices — same account, no state on signup, then round-trips a saved blob", async () => {
    const email = freshEmail();
    const password = "cross device password";
    const signup = await request(app).post("/auth/signup").send({ email, password });
    const tokenDeviceA = signup.body.token as string;

    // Nothing synced yet.
    const empty = await request(app).get("/me/demo-state").set("Authorization", `Bearer ${tokenDeviceA}`);
    expect(empty.status).toBe(200);
    expect(empty.body.state).toBeNull();

    // "Device A" saves progress.
    const demoBlob = { pair: "de-es", pairs: { "de-es": { tier: 2, xp: 340, strength: { "1|hola": 0.8 } } } };
    const put = await request(app)
      .put("/me/demo-state")
      .set("Authorization", `Bearer ${tokenDeviceA}`)
      .send({ state: demoBlob });
    expect(put.status).toBe(200);
    expect(put.body.state).toEqual(demoBlob);

    // "Device B" logs into the SAME account and reads the same blob back.
    const login = await request(app).post("/auth/login").send({ email, password });
    const tokenDeviceB = login.body.token as string;
    const get = await request(app).get("/me/demo-state").set("Authorization", `Bearer ${tokenDeviceB}`);
    expect(get.status).toBe(200);
    expect(get.body.state).toEqual(demoBlob);

    // Overwriting from "device B" is visible back on device A's token too.
    const updatedBlob = { ...demoBlob, pairs: { ...demoBlob.pairs, "de-es": { ...demoBlob.pairs["de-es"], xp: 999 } } };
    await request(app).put("/me/demo-state").set("Authorization", `Bearer ${tokenDeviceB}`).send({ state: updatedBlob });
    const getAgain = await request(app).get("/me/demo-state").set("Authorization", `Bearer ${tokenDeviceA}`);
    expect(getAgain.body.state.pairs["de-es"].xp).toBe(999);
  });

  it("rejects an oversized demo-state blob", async () => {
    const email = freshEmail();
    const signup = await request(app).post("/auth/signup").send({ email, password: "oversize blob password" });
    const token = signup.body.token as string;

    const huge = { junk: "x".repeat(300_000) };
    const res = await request(app).put("/me/demo-state").set("Authorization", `Bearer ${token}`).send({ state: huge });
    expect(res.status).toBe(413);
  });
});
