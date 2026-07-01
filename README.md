# lingo-cars — Phase 0 (learning loop)

Backend for a gamified language-learning app. **This branch implements Phase 0 only:**
validating the *learning loop* — schema, adaptive placement, one exercise type
(multiple-choice), an FSRS spaced-repetition engine, and rolling CEFR promotion.

> **No gamification yet.** There is deliberately **no car system, no points
> economy, no cosmetics** (Phase 1+), and only the **de→es** pair (German →
> Spanish). See [`CLAUDE.md`](./CLAUDE.md) for the full product spec and the
> reasoning behind each decision.

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
npm run seed            # de/es, de->es, A1/A2 skills -> lessons -> MCQ exercises
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
| `POST /attempts` | `{ userId, exerciseId, selectedIndex, latencyMs }` → grades, schedules FSRS, rolls up proficiency, evaluates promotion — one transaction. |
| `GET /proficiency?userId&pairId` | Current CEFR + proficiency state. |

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

## Not in Phase 0

Car/vehicle state, points/economy, cosmetics, Georgian (`ka`), English source,
speaking/listening exercises, and any C-level checkpoint (`assessments` table).
These arrive in later phases per [`CLAUDE.md`](./CLAUDE.md) §8.
