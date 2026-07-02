# lingo-cars — Phases 0–4 (learning loop, car projection, content pipeline, economy, race)

[![CI](https://github.com/giorgijv/lingo-cars/actions/workflows/ci.yml/badge.svg)](https://github.com/giorgijv/lingo-cars/actions/workflows/ci.yml)

> **🏎️ Live demo:** <https://giorgijv.github.io/lingo-cars/> — a standalone,
> in-browser illustration of the car-progression concept: pick a language pair
> (de→es, en→es, de→ka, en→ka), take a placement test, study multiple-choice,
> typed, listen, and read-aloud exercises, and watch the car level up City
> Hatch → Hypercar with milestone cosmetics along the way. It runs entirely
> client-side and is separate from the API below.
>
> **Placement and study draw from separate pools.** The demo's placement test
> (`BANKS`, ~40 items/language) and study mode (`STUDY_BANKS`, **100 items per
> target language**, A1–C2) are disjoint arrays with zero item overlap, so a
> learner never sees the exact same question in both modes back to back.
> Study items also carry a bilingual `why` explanation, shown under the
> feedback line whenever an answer is wrong. Georgian study content above A2
> is, like the rest of this build's `ka` content, not yet reviewed by a
> native speaker.

Backend for a gamified language-learning app.

- **Phase 0 — the learning loop:** schema, adaptive placement, one exercise
  type (multiple-choice), an FSRS spaced-repetition engine, and rolling CEFR
  promotion.
- **Phase 1 — the motivation loop:** the car as a **pure read-only projection**
  of proficiency — a static `CarCatalog` ladder, stat interpolation within a
  tier, and intra-tier micro-milestones. No points economy, no market, no race
  (Phase 3+).
- **Language pairs:** all four pairs — **de→es, en→es, de→ka, en→ka** — served
  from two target-language banks with per-source stems. The engine is
  byte-identical across pairs.
- **Phase 2 — content pipeline + Georgian depth:** course content lives as
  validated data in [`content/`](./content) (zod-gated by
  `src/content/bank.ts`; `npm run content:check` runs in CI). The Georgian
  bank carries real curriculum depth: Mkhedruli script recognition, the
  nominative/ergative/dative case system, and verb person/tense morphology.
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
  `RaceResult` log and awards nothing (no points/xp/CEFR).
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

Points economy & allocation choices, cosmetic market, race minigame, Georgian
(`ka`) backend content, English-source backend content, speaking/listening
exercises, and any C-level checkpoint (`assessments` table).
Per [`CLAUDE.md`](./CLAUDE.md) §8.
