# lingo-cars — Phases 0 + 1 (learning loop + car projection)

[![CI](https://github.com/giorgijv/lingo-cars/actions/workflows/ci.yml/badge.svg)](https://github.com/giorgijv/lingo-cars/actions/workflows/ci.yml)

> **🏎️ Live demo:** <https://giorgijv.github.io/lingo-cars/> — a standalone,
> in-browser illustration of the car-progression concept: pick a language pair
> (de→es, en→es, de→ka, en→ka), take a placement test, study MCQs, and watch
> the car level up City Hatch → Hypercar with milestone cosmetics along the
> way. It runs entirely client-side and is separate from the API below.

Backend for a gamified language-learning app.

- **Phase 0 — the learning loop:** schema, adaptive placement, one exercise
  type (multiple-choice), an FSRS spaced-repetition engine, and rolling CEFR
  promotion.
- **Phase 1 — the motivation loop:** the car as a **pure read-only projection**
  of proficiency — a static `CarCatalog` ladder, stat interpolation within a
  tier, and intra-tier micro-milestones. No points economy, no market, no race
  (Phase 3+).
- **Language pairs:** all four pairs are seeded with A1/A2 MCQ content —
  **de→es, en→es, de→ka, en→ka** — generated from two target-language banks
  (Spanish + Georgian/Mkhedruli) with per-source stems. The engine is
  byte-identical across pairs. See [`CLAUDE.md`](./CLAUDE.md) for the spec.

## Non-negotiable guardrails (enforced here)

| Rule | How it's enforced |
|------|-------------------|
| **Rule 4 — the attempt log is immutable** | `Attempt` has SELECT+INSERT grants only for the app role; a DB trigger rejects `UPDATE`/`DELETE`/`TRUNCATE` for every role. All derived state replays from it. |
| **D5 — car state is a projection** | No car exists in Phase 0. `inTierProgress` is a *learning* metric on `ProficiencyState`; a future car will only read it. |
| **D3 — tier unlocks only via CEFR** | `evaluateTier` decides purely on the mastery metric over `ProficiencyState`. No points/economy input exists or is consulted. |

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
npm test                # 38 tests, incl. DB integration + e2e
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

## API

| Method & path | Purpose |
|---|---|
| `GET /health` | Liveness. |
| `GET /languages`, `GET /pairs` | Catalog. |
| `POST /users` | Create a user `{ email, uiLanguage }`. |
| `POST /enrollments` | Enroll `{ userId, pairId }`. |
| `POST /placement/start` | Begin adaptive placement `{ pairId }` → `{ state, exercise }`. |
| `POST /placement/answer` | Answer `{ pairId, state, exerciseId, selectedIndex, latencyMs }` → next item or `done`. |
| `POST /placement/finalize` | `{ userId, pairId, state }` → `{ cefr, confidence, inTierProgress, … }`; seeds enrollment. |
| `GET /lessons/:id` | Lesson + exercises (no `correctIndex`). |
| `GET /queue?userId&pairId` | Due reviews + new tier items. |
| `POST /attempts` | `{ userId, exerciseId, selectedIndex, latencyMs }` → grades, schedules FSRS, rolls up proficiency, evaluates promotion — one transaction. Response includes the updated car projection. |
| `GET /proficiency?userId&pairId` | Current CEFR + proficiency state. |
| `GET /car?userId&pairId` | **Phase 1.** The car as a pure projection: tier/class from `currentCefr`, speed & handling interpolated by `inTierProgress` toward the next class's base stats, plus micro-milestones (0.25/0.5/0.75). Computed on read — never stored (D5). |

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

Points economy & allocation choices, cosmetic market, race minigame, Georgian
(`ka`) backend content, English-source backend content, speaking/listening
exercises, and any C-level checkpoint (`assessments` table).
Per [`CLAUDE.md`](./CLAUDE.md) §8.
