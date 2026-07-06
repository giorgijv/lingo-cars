# lingo-cars — Phases 0–4 (learning loop, car projection, content pipeline, economy, race)

[![CI](https://github.com/giorgijv/lingo-cars/actions/workflows/ci.yml/badge.svg)](https://github.com/giorgijv/lingo-cars/actions/workflows/ci.yml)

&copy; 2026 Giorgi Jvarsheishvili. All rights reserved.

> **🏎️ Live demo:** <https://giorgijv.github.io/lingo-cars/> — a standalone,
> in-browser illustration of the car-progression concept: pick a language pair
> from the grouped/searchable picker (de/en→es/ka/ru, **and the reverse**:
> es/ka/ru→de/en — 12 pairs total), take a placement test, study
> multiple-choice, typed, listen, and read-aloud exercises, and watch the car
> level up City Hatch → Hypercar with milestone cosmetics along the way. It
> runs entirely client-side and is separate from the API below.
>
> **Placement and study draw from separate pools.** The demo's placement test
> (`BANKS`, ~45–50 items/language, including dedicated grammar items —
> ser/estar, gender agreement, the Georgian case system, ergative/dative/
> instrumental marking, the Russian case system, verb aspect) and study mode
> (`STUDY_BANKS`, **500 items per target language**, A1–C2, roughly half
> vocabulary/phrases and half verb conjugation, agreement, and case-system
> grammar drills) are disjoint arrays with zero item overlap, so a learner
> never sees the exact same question in both modes back to back. Within a
> proficiency tier, the next study question is picked at random from every
> not-yet-mastered item in that tier's pool (not a narrow, easily-repeated
> subset), and each answer option's on-screen position is reshuffled every
> time a question renders, so the correct answer isn't predictably in the
> same slot. Study items also carry a `why` explanation in every source
> language for that target (bilingual de/en for the es/ka/ru banks,
> trilingual es/ka/ru for the de/en banks), shown under the feedback line
> whenever an answer is wrong. Georgian, Russian, and the reverse-direction
> German/English content above A2 is, like the rest of this build's `ka`/`ru`
> content, not yet reviewed
> by a native speaker.
>
> **Login (👤, top right) syncs progress across devices.** The demo works
> fully offline by default (localStorage only, one browser); signing in calls
> a real backend (`/auth/signup`, `/auth/login`, `/me/demo-state` — see below)
> that persists your car/points/study state in Postgres keyed to your
> account, so any device that logs in sees the same progress. The API is now
> deployed (Supabase + Render, see "Deploying" below) and its URL is
> **pre-filled** in the login screen's "API server URL" field — sharing just
> the demo link is enough, nobody needs a second link. That field stays
> editable: anyone running their own instance (a fork, self-hosting, local
> `npm run dev`) can overwrite it, and their override is what gets remembered
> from then on (`DEFAULT_API_BASE` in `docs/index.html` is the fallback, not
> a hard requirement). Sync policy is intentionally simple: on login, the
> server's saved state wins if one exists, otherwise the current device's
> local state is uploaded as the starting point; two devices editing at the
> same moment aren't merged — the later save wins. Render's free tier sleeps
> after ~15 min idle, so the first request after a quiet period takes
> 30-60s to wake back up — expected, not a bug.

Backend for a gamified language-learning app.

- **Phase 0 — the learning loop:** schema, adaptive placement, one exercise
  type (multiple-choice), an FSRS spaced-repetition engine, and rolling CEFR
  promotion.
- **Phase 1 — the motivation loop:** the car as a **pure read-only projection**
  of proficiency — a static `CarCatalog` ladder, stat interpolation within a
  tier, and intra-tier micro-milestones. No points economy, no market, no race
  (Phase 3+).
- **Language pairs:** twelve pairs, both directions — **de/en→es/ka/ru**
  (learn Spanish, Georgian, or Russian) **and es/ka/ru→de/en** (learn German
  or English) — served from five target-language banks with per-source
  stems (`PAIRS` in `src/content/bank.ts` is the single source of truth,
  shared by content-coverage validation and DB seeding). The engine is
  byte-identical across pairs.
- **Phase 2 — content pipeline + script/case depth:** course content lives as
  validated data in [`content/`](./content) (zod-gated by
  `src/content/bank.ts`; `npm run content:check` runs in CI). The Georgian
  bank carries real curriculum depth: Mkhedruli script recognition, the
  nominative/ergative/dative case system, and verb person/tense morphology.
  The Russian bank (`content/ru.json`) mirrors that depth: Cyrillic script
  recognition, the six-case system, and verb aspect
  (perfective/imperfective) + motion verbs. The reverse-direction German
  and English banks (`content/de.json`, `content/en.json` — stems in
  es/ka/ru, since those are the source languages paired with them) carry
  the same depth in the other direction: German's four-case system
  (Nominativ/Akkusativ/Dativ/Genitiv) and separable/modal verbs; English's
  pronoun-case system (subject/object/possessive) and irregular verbs/
  phrasal verbs.
- **Phase 3 — economy & agency:** points (earned from answering) can be
  **spent** on visual cosmetics, **saved**, or items **sold back** at 50%
  (secondary-market MVP). `Purchase` is an immutable ledger like `Attempt`;
  balance and ownership are pure projections. **D3 holds:** cosmetics are
  gated to already-unlocked tiers and never advance one; **D5 holds:** stats
  are untouched by ownership.
- **Phase 4 — race minigame:** a time trial where **proficiency sets the
  performance ceiling** (D5: `ceiling = speed^0.7 × handling^0.3` from the car
  projection) and shift skill only realizes 50–100% of it — a zero-skill
  Hypercar beats a perfect City Hatch. Racing appends to an immutable
  `RaceResult` log and awards a small points trickle (well under a single
  lesson answer) — it still never moves CEFR or unlocks a higher car class.
- **Multi-modal placement — M1 + M2 + M3 shipped:**
  - **M1 — `fill`** (typed free-text answer), graded server-side by
    edit-distance + accent-insensitive matching (`src/content/grading.ts`),
    feeding both FSRS (score-based grade quality) and the adaptive placement
    staircase.
  - **M2 — `listen`** (hear target-language audio, pick what was said).
    Deviates from the plan's original sketch: no TTS account or object
    storage is provisioned in this build, so audio is synthesized **on-device**
    via the browser's Web Speech API from a stored `transcript`, not served
    as a pre-generated file. Grading is selectedIndex-based, identical to mcq.
  - **M3 — `speak`** (read a target-language sentence aloud). Server-side is
    identical to `fill`: the same `gradeFillAnswer` grader scores the
    recognized text against the target `text`. Deviates from the plan's
    original sketch: no Python/Whisper ASR microservice is provisioned in this
    build, so the demo runs speech-to-text **in-browser** via the
    `SpeechRecognition` Web API (Chrome/Edge; cloud-backed by the browser
    vendor, not on-device — a bigger privacy caveat than M2's on-device TTS),
    with a graceful fallback to typed input everywhere it's unsupported.
  - All three non-mcq types get a **soft placement-staging bonus**: once
    ability is roughly located (past `mcqStageItems`), non-mcq items surface
    preferentially — the "productive/listening/speaking check" that corrects
    over-placement from pure MCQ recognition.
  - See [`plans/placement-modalities.md`](./plans/placement-modalities.md) for
    the full plan and every "what actually got built" deviation writeup (M1,
    M2, M3).
  See [`CLAUDE.md`](./CLAUDE.md) for the spec.

## Non-negotiable guardrails (enforced here)

| Rule | How it's enforced |
|------|-------------------|
| **Rule 4 — the attempt log is immutable** | `Attempt` has SELECT+INSERT grants only for the app role; a DB trigger rejects `UPDATE`/`DELETE`/`TRUNCATE` for every role. All derived state replays from it. |
| **D5 — car state is a projection** | No car exists in Phase 0. `inTierProgress` is a *learning* metric on `ProficiencyState`; a future car will only read it. |
| **D3 — tier unlocks only via CEFR** | `evaluateTier` decides purely on the mastery metric over `ProficiencyState`. No points/economy input exists or is consulted. |

**Auth scope, disclosed:** `/auth/*` and `/me/demo-state` are gated by a bearer
session token (`requireAuth`, `src/http/auth.ts`) and are the only routes that
resolve "which user" from a verified session rather than a client-supplied
`userId`. The pre-existing Phase 0-4 routes (`/enrollments`, `/placement/*`,
`/attempts`, `/car`, `/economy`, `/purchases`, `/races`, `/proficiency`,
`/queue`) still take an explicit `userId` in the request, unchanged — gating
all of them behind sessions too is a real follow-up (and a much larger
migration of their existing test suite), not done in this change.

## Architecture

- **TypeScript / Node + Express** REST API — all proficiency/scheduling logic
  lives behind the API (thin client, D7).
- **Postgres + Prisma** — schema in [`prisma/schema.prisma`](./prisma/schema.prisma).
- **[`ts-fsrs`](https://github.com/open-spaced-repetition/ts-fsrs)** — FSRS
  scheduler (fuzz disabled for deterministic replay).
- **zod** — request + stored-payload validation.

### Data model

```
Language ──< LanguagePair >── Language
LanguagePair ──< Skill ──< Lesson ──< Exercise
User ──< Enrollment (currentCefr)
User ──< Attempt (IMMUTABLE) >── Exercise          # raw event log
User ──< ReviewState (per-card FSRS) >── Exercise   # derived, replayable
User ──< ProficiencyState (per pair)                # derived, replayable
User ──< Session (login token hash + expiry)        # mutable; deleted on logout
User ──< DemoState (one JSON blob)                  # cross-device sync target for docs/index.html
```

Derived tables (`ReviewState`, `ProficiencyState`) are pure projections of the
`Attempt` log and can be rebuilt at any time via `recomputeFromScratch`.

## Setup

Requires Node ≥ 20. Choose Docker (zero-config) or an existing Postgres ≥ 14.

### Option A — Docker (recommended)

```bash
npm install
cp .env.example .env    # defaults already match docker-compose
npm run setup           # starts Postgres, applies migrations, seeds content
npm test                # 121 tests, incl. DB integration + e2e
npm run dev             # http://localhost:3000
```

`npm run setup` = `db:up` (Docker Postgres + healthcheck) → `prisma:deploy`
→ `seed`. The compose init script creates the restricted `app_role`; the
migration then applies its grants and the append-only trigger. Tear down with
`npm run db:down` (keep data) or `npm run db:reset` (wipe volume).

### Option B — existing Postgres

```bash
npm install

# Create the app role (must NOT own tables) + database:
#   CREATE ROLE app_role LOGIN PASSWORD 'app_pass';
#   CREATE DATABASE lingo_cars OWNER postgres;
cp .env.example .env    # edit DATABASE_URL (app_role) + DIRECT_URL (owner)

npm run prisma:deploy   # tables + append-only trigger/grants
npm run seed            # 4 languages, 4 pairs, car catalog, A1/A2 content per pair
```

`DATABASE_URL` uses the **restricted** `app_role`; `DIRECT_URL` uses the table
**owner** (for migrations). The split is what makes the append-only revoke
effective — table owners bypass GRANT/REVOKE.

## Run & test

```bash
npm run dev        # start the API (default :3000)
npm run typecheck  # tsc --noEmit
npm test           # vitest — pure unit tests always run;
                   # DB integration + e2e run only when DATABASE_URL is set
```

## Deploying (Supabase + Render, both free-tier)

The demo's login (`docs/index.html`, 👤 button) needs this API reachable from
the public internet — it isn't hosted anywhere by default. This is the
cheapest path: **Supabase for Postgres, Render for the Node API.** Neither
requires code changes; both configs below are already in the repo.

### 1. Database — Supabase

1. Create a Supabase project (or reuse an existing one) at
   [supabase.com](https://supabase.com).
2. Open **SQL Editor** and run the same role-creation SQL used for local dev
   (`docker/init/01-app-role.sql`), against Supabase's default `postgres`
   database:
   ```sql
   CREATE ROLE app_role LOGIN PASSWORD 'choose-a-strong-password-here';
   GRANT CONNECT ON DATABASE postgres TO app_role;
   ```
   `prisma migrate deploy` (next step, run by Render) applies this role's
   per-table grants and the append-only triggers automatically — same
   migrations as local dev, nothing Supabase-specific to write.
3. In **Project Settings → Database**, copy two connection strings:
   - **Connection pooling** (port 6543, "Transaction" mode) — this becomes
     `DATABASE_URL`. Swap in the `app_role` user/password from step 2, and
     append `?pgbouncer=true` (Prisma needs this over PgBouncer).
   - **Direct connection** (port 5432) — this becomes `DIRECT_URL`, using the
     `postgres` (owner) user/password Supabase gives you. Migrations need a
     direct connection, not the pooled one.

### 2. API — Render

1. Push this repo to GitHub (already done), then in Render create
   **New → Blueprint** and point it at the repo — it reads
   [`render.yaml`](./render.yaml) and creates the `lingo-cars-api` free web
   service automatically. (Or create a **Web Service** by hand with the same
   build/start commands from that file, if you'd rather not use Blueprints.)
2. In the service's **Environment** tab, set `DATABASE_URL` and `DIRECT_URL`
   to the two Supabase strings from step 1 (`render.yaml` deliberately leaves
   these blank — never commit real credentials).
3. Deploy. The build runs `npm run render-build`
   (`prisma generate` → `prisma migrate deploy` → `tsc build` → `npm run seed`
   — seeding is idempotent, safe on every deploy) then starts the API;
   `/health` is the configured health-check path.
4. Copy the resulting `https://lingo-cars-api-xxxx.onrender.com` URL.

### 3. Point the demo at it

Open the live demo, click 👤 → paste that Render URL into **API server URL**,
then sign up. Render's free tier spins the service down after ~15 min idle,
so the first request after a quiet spell takes a few seconds (cold start) —
expected, not a bug.

## API

| Method & path | Purpose |
|---|---|
| `GET /health` | Liveness. |
| `GET /languages`, `GET /pairs` | Catalog. |
| `POST /users` | Create a user `{ email, uiLanguage }` — no password; kept for the existing Phase 0-4 flows below, which still take an explicit `userId` and aren't gated by a session. |
| `POST /auth/signup` | `{ email, password, uiLanguage }` → `201` `{ token, expiresAt, user }`. Password hashed with scrypt (Node's built-in `crypto`, no new dependency). |
| `POST /auth/login` | `{ email, password }` → `{ token, expiresAt, user }`, or `401` on a bad password/unknown email. |
| `POST /auth/logout` | Bearer-authenticated; deletes the session so the token stops working immediately. |
| `GET /auth/me` | Bearer-authenticated; returns the signed-in user. |
| `GET /me/demo-state` | Bearer-authenticated; returns the caller's synced `docs/index.html` progress blob (`null` if never synced). |
| `PUT /me/demo-state` | Bearer-authenticated; upserts `{ state }` (opaque JSON, size-capped at 256KB) as the caller's synced progress. |
| `POST /enrollments` | Enroll `{ userId, pairId }`. |
| `POST /placement/start` | Begin adaptive placement `{ pairId }` → `{ state, exercise }`. |
| `POST /placement/answer` | Answer `{ pairId, state, exerciseId, selectedIndex \| response, latencyMs }` (`selectedIndex` for mcq/listen, `response` for fill — by the exercise's own type) → next item or `done`. |
| `POST /placement/finalize` | `{ userId, pairId, state }` → `{ cefr, confidence, inTierProgress, … }`; seeds enrollment. |
| `GET /lessons/:id` | Lesson + exercises (no `correctIndex`/`answers`). |
| `GET /queue?userId&pairId` | Due reviews + new tier items. |
| `POST /attempts` | `{ userId, exerciseId, selectedIndex \| response, latencyMs }` → grades, schedules FSRS, rolls up proficiency, evaluates promotion — one transaction. Response includes `score`/`correctAnswers` for `fill` exercises and the updated car projection. |
| `GET /proficiency?userId&pairId` | Current CEFR + proficiency state. |
| `GET /car?userId&pairId` | **Phase 1.** The car as a pure projection: tier/class from `currentCefr`, speed & handling interpolated by `inTierProgress` toward the next class's base stats, plus micro-milestones (0.25/0.5/0.75). Computed on read — never stored (D5). |
| `GET /economy?userId&pairId` | **Phase 3.** Balance (= xp − buys + sells), owned cosmetics, and the catalog with unlocked/affordable flags — all projections of xp + the `Purchase` ledger. |
| `POST /purchases` | **Phase 3.** `{ userId, pairId, cosmeticId, action: buy\|sell }` — appends one immutable ledger row (serializable tx). Buy requires the item's tier to be already unlocked (403 otherwise — D3), sufficient balance, and non-ownership; sell refunds 50%. |
| `POST /races` | **Phase 4.** `{ userId, pairId, shiftAccuracies: number[0..1][] }` — server projects the car (the D5 ceiling), computes the finish time, appends one immutable `RaceResult`. Awards nothing. |
| `GET /races?userId&pairId` | Personal best + last 10 runs. |

Grading is **server-authoritative**: clients send the selected option index and
never receive `correctIndex`.

## Engine internals (`src/engine`)

- **`fsrs.ts`** — `gradeFor` (correct/latency → Again/Good/Easy), `nextCardFields`
  (pure scheduling), `applyAttempt` (upserts `ReviewState`; skips placement).
- **`proficiency.ts`** — `recomputeProficiency` (incremental rollup) and
  `recomputeFromScratch` (replay the whole log); coverage-weighted `tierMasteryFrom`.
- **`mastery.ts`** — `evaluateTier` (pure): A1→B1 auto-promote at mastery ≥ 0.85
  with coverage; C1→C2 held for a checkpoint; silent gated demotion (D6) below
  0.60 with hysteresis. `applyTierDecision` applies it.
- **`placement.ts`** — logistic staircase; ability → CEFR + confidence + low seed.
- **`car.ts`** — Phase 1: `projectCar` (pure — cefr + inTierProgress + catalog →
  class, interpolated stats, micro-milestones) and the read-only `getCar` loader.
  Tier moves only via CEFR (D3); nothing is ever written (D5).

## Not built yet (later phases)

Points economy & allocation choices, cosmetic market, race minigame, and any
C-level checkpoint (`assessments` table).
Per [`CLAUDE.md`](./CLAUDE.md) §8.
