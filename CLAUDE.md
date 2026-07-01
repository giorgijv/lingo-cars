# Language Learner × Car Progression — Project Specification

> **Purpose of this document:** A build-ready specification to hand to Claude Code. It defines the product, the core mechanic, the data model, the architecture, and a phased roadmap. It also records where the design **diverges from the original brief and why** — read the "Design Decisions & Rationale" section before implementing, because several choices exist specifically to protect the product's motivational integrity and to avoid expensive rework.

---

## 1. Vision

A gamified language-learning web app (later mobile) where an English- or German-speaking user learns **Spanish** or **Georgian**. The user's language proficiency is expressed as a **car** that visibly improves — in appearance and in performance stats (speed, handling) — as the learner advances. Proficiency milestones (CEFR levels A1→C2) unlock progressively higher car classes; day-to-day study continuously tunes the current car.

**Strategic note:** Spanish content is abundant and de-risks the learning engine. **Georgian is the real competitive moat** — almost no serious app competition exists — but it has *no content shortcuts*. Treat Spanish as the engine-validation pair and Georgian as the differentiator, sequenced accordingly (see Roadmap).

---

## 2. Design Decisions & Rationale (read first)

These are deliberate deviations from a literal reading of the brief. Each protects either motivation integrity or future flexibility.

| # | Decision | Why | Brief said |
|---|----------|-----|------------|
| D1 | **Two-tier progression:** CEFR unlocks 6 car *models* (milestones); continuous "tuning" raises speed/handling *within* each level (daily loop). | CEFR levels are wildly non-linear (A1→A2 ≈ 80–100h; B2→C1 ≈ 200h+). A model-swap-only reward means zero visible car change for hundreds of hours at higher levels — reward cadence collapses exactly when retention matters most. | Car changes at 6 CEFR levels |
| D2 | **Single economy for MVP.** Points → progress current car toward next tier. Secondary "sell old / buy new" market deferred to v2. | Two parallel economies is premature complexity for an unvalidated core loop. Validate one before adding a second. | Build-to-match *and* sell/buy |
| D3 | **Model tier unlocks ONLY via CEFR. Points buy tuning/cosmetics *within* the gated model — never a higher model.** | The entire signal is proficiency → visible reward. Allowing purchase of a car above your level decouples car from proficiency and destroys the signal. | Points can buy next-level car |
| D4 | **Brand-agnostic car classes.** Original designs mapped to a power/handling curve; German brand references kept only as *internal* design targets. | Real brand names, logos, and specific model likenesses (VW/Porsche/Bugatti Chiron SS 300+) are a trademark/licensing liability for any commercial product. Cheap to design around now, expensive to retrofit. | VW Polo → Bugatti Chiron by name |
| D5 | **Car stats are a pure read-only projection of proficiency state.** No skill-based gameplay can alter them. | Preserves the proficiency→reward coupling. If a race minigame is ever added, proficiency sets a *ceiling*; race skill only operates within it. | "race better" (implies gameplay) |
| D6 | **Placement is a starting bet, not a verdict.** 10-min test places receptive level with moderate confidence; a re-tiering mechanic adjusts up/down over the first N sessions. | A short test cannot certify productive (speaking/writing) C-level skill. Mis-placement must self-correct without feeling punitive. | Test → assigned a fixed car |
| D7 | **API-first, web/PWA first, mobile deferred.** | Backend, schema, and logic are 100% reusable across clients; UI is not. Validate the loop cheaply on one codebase before paying the ~2–3× cost of native mobile. | "make it complexer" incl. mobile |

---

## 3. Core Mechanic

### 3.1 The two-tier progression model

```
CEFR level        →  Car MODEL (6 discrete milestones)      [rare dopamine spike]
Tuning progress   →  Car SPEED & HANDLING within that model [daily/weekly loop]
```

**Stat interpolation.** For the current tier `t`, with normalized in-tier progress `p ∈ [0,1]`:

```
speed(car)    = base_speed[t]    + p × (base_speed[t+1]    − base_speed[t])
handling(car) = base_handling[t] + p × (base_handling[t+1] − base_handling[t])
```

So the car's numbers climb continuously toward "what the next class starts at," giving visible weekly movement even during long tiers. Reaching the CEFR threshold swaps the model (`t → t+1`, `p → 0`) — the big reward.

**Non-linearity handling.** The XP required to fill a tier scales with the *real* CEFR effort curve (B2→C1 requires far more accumulated mastery than A1→A2). But the **displayed progress bar is normalized**, so the learner always sees steady per-session movement. To keep long tiers from feeling barren, add **intra-tier micro-milestones** (visual tuning parts, decals, spoiler, wheels) at fixed `p` breakpoints (e.g., 0.25/0.5/0.75).

### 3.2 The car ladder (brand-agnostic, with internal reference targets)

| CEFR | Car class (shipped name = original) | Internal reference (design target only — do NOT ship names/logos) | Rel. speed | Rel. handling |
|------|-------------------------------------|------------------------------------------------------------------|-----------|---------------|
| A1 | City Hatch | VW Polo class | 1.0 | 1.0 |
| A2 | Hot Hatch | Golf GTI class | 1.4 | 1.3 |
| B1 | Sports Sedan | Audi S4 / M340i class | 2.0 | 1.7 |
| B2 | Sports Coupe | 911 Carrera class | 2.8 | 2.4 |
| C1 | Supercar | 918 / AMG One class | 3.8 | 3.2 |
| C2 | Hypercar | Chiron SS 300+ class | 5.0 | 4.0 |

(Numbers are relative anchors for the interpolation curve; tune during playtesting.)

### 3.3 Points / economy (MVP)

- Points are earned from lessons, correct answers, and streaks.
- In MVP, points are a **visible score** and fund **tuning + cosmetics within the current gated model**.
- Points **cannot** buy a higher model (see D3).
- **v2:** introduce agency — let the learner *choose* how to allocate points (tuning vs. cosmetics vs. saving), and a secondary market to trade in cosmetic inventory. Model unlock remains CEFR-gated.

---

## 4. Placement Test

- **Length:** ~10 min, adaptive (item difficulty adjusts to responses).
- **Scope:** receptive skills (reading, listening, grammar recognition) — reliable in the time budget. Productive skills are *not* certified here.
- **Output:** a starting CEFR estimate → starting car model + a low initial `p`.
- **Re-tiering safety net (D6):** during the first ~5 sessions, if performance strongly contradicts placement (too easy/too hard), silently adjust the tier ±1 with a friendly framing ("Your car got an upgrade — you were underrated" / "Recalibrating to your level"). Never a hard demotion that reads as failure.

---

## 5. Data Model (schema sketch)

Postgres. Separate the **raw event log** (immutable truth) from **derived state** (proficiency, car) so the car is always a clean projection.

```
users(id, email, ui_language[en|de], created_at)

languages(code[es|ka|en|de], name)

language_pairs(id, source_lang, target_lang)   -- en→es, de→es, en→ka, de→ka

enrollments(id, user_id, pair_id, current_cefr, placement_result_json, created_at)

-- CONTENT
skills(id, pair_id, cefr, name, order_index)
lessons(id, skill_id, order_index)
exercises(id, lesson_id, type[mcq|fill|listen|match|speak], payload_json, difficulty)

-- RAW EVENT LOG (immutable)
attempts(id, user_id, exercise_id, correct, latency_ms, created_at)

-- DERIVED STATE (recomputed from attempts)
proficiency_state(user_id, pair_id, per_skill_mastery_json, xp, streak_days,
                  last_active, srs_due_json)

car_state(user_id, pair_id, current_tier, tuning_progress_p, points_balance,
          owned_cosmetics_json)   -- projection of proficiency + economy

-- CATALOG
car_catalog(tier, class_name, base_speed, base_handling, unlock_cefr)
cosmetics_catalog(id, tier, name, cost_points, kind[wheels|spoiler|paint|decal])
```

**Key principle:** `car_state.current_tier` and the interpolated stats are *functions of* `enrollments.current_cefr` and `proficiency_state`. Never let car state drift independently of proficiency (D5).

**Tier promotion (rolling threshold — §9.3):** `enrollments.current_cefr` advances when a threshold **function over `proficiency_state.per_skill_mastery`** is crossed — no separate exam for A1–B2. Implement as a pure function, not a scheduled event. At **C-level boundaries only**, gate promotion behind an optional checkpoint (`assessments` table added at that phase); do not build the `assessments` table until C-level content exists.

---

## 6. Content Model

- Matrix: **source language × target language** → supports en→es, de→es, en→ka, de→ka from one schema.
- Exercise types (MVP): multiple-choice, fill-in-the-blank, listening, matching. (Speaking = later; needs ASR.)
- **SRS engine:** spaced repetition drives `srs_due`. **DECIDED: FSRS** (modern, per-item difficulty + individual retention curves; open reference implementations). Cold-start runs on default parameters until enough review history accrues to fit — degrades gracefully, never breaks.
- **Georgian content warning:** no off-the-shelf content pipeline. Budget explicit effort for curriculum authoring (script/Mkhedruli handling, phonetics, case system). This is the hard, differentiating work — do not underestimate it.

---

## 7. Architecture

- **Backend:** API-first (REST or tRPC). **DECIDED: TypeScript/Node** + Postgres. Rationale: end-to-end TypeScript with React frontend and future React Native — one type system, shared types between client and server (`car_state`, `proficiency_state` defined once), eliminating contract drift at the exact boundary where the D5 invariant lives. Any heavy Georgian NLP/ASR (Phase 2+) goes in a *separate* Python service behind the API, not the primary backend.
- **Frontend:** React, **PWA-first** (installable, one codebase). No native mobile in early phases.
- **Auth + DB + storage:** consider **Supabase** (Postgres + auth + storage) to reach MVP fastest; swap later if needed.
- **Client is thin:** all proficiency/car/economy logic lives behind the API so a future mobile client reuses it verbatim (D7).
- **Mobile (later):** if justified by retention data, cross-platform (React Native / Expo) to reuse React logic; native only with a concrete feature need.

---

## 8. Phased Roadmap

| Phase | Goal | Scope | Exit criterion |
|-------|------|-------|----------------|
| **0** | Validate the learning loop | Schema + placement test + **de→es** + one exercise type + FSRS. **No car yet.** | Users complete lessons; SRS scheduling works |
| **1** | Validate the motivation loop | Add car projection: single ladder, tuning interpolation, stats, intra-tier micro-milestones. Cosmetic + stat only, no race. | Retention lift measurable vs. Phase 0 |
| **2** | Add the moat | Second pair: **Georgian**. Build the content pipeline (the hard part). | Georgian A1–A2 playable end-to-end |
| **3** | Economy & agency | Points allocation choices; secondary cosmetic market. Model unlock stays CEFR-gated. | Users engage with spend decisions |
| **4** | Race minigame *(only if data justifies)* | Proficiency sets stat **ceiling**; race skill operates within it (D5). | Only build if Phase 1 showed cosmetic wasn't enough |
| **5** | Native mobile | Cross-platform client reusing the API. | Justified by real usage data |

**Do not skip Phase 0's "no car" step.** Proving people will study *before* adding gamification tells you whether the content works on its own — otherwise you can't tell if the car is compensating for a weak core.

---

## 9. Decisions

### 9a. RESOLVED

| # | Decision | Choice |
|---|----------|--------|
| 1 | **First language pair** | **de→es** — user is native German (dogfooding friction removed); engine byte-identical across pairs, so en→es is just another `language_pairs` row added later. |
| 2 | **SRS algorithm** | **FSRS** (see §6). |
| 3 | **CEFR promotion cadence** | **Rolling mastery threshold** — auto-promote a tier when accumulated per-skill mastery in `proficiency_state` crosses a bar (no jarring exam; promotion ties directly to the same state the car reads). **Plus an optional periodic checkpoint test at C-level boundaries**, where receptive mastery alone is a weak proxy for real proficiency. |
| 4 | **Backend language** | **TypeScript/Node** (see §7). |

**Full language-pair matrix (all four in scope; sequenced by phase):**

| Pair | Code | Phase |
|------|------|-------|
| German → Spanish | de→es | 0 (first) |
| German → Georgian | de→ka | 2 (moat) |
| English → Spanish | en→es | 3+ (market expansion) |
| English → Georgian | en→ka | 3+ (market expansion) |

> **Note on `ka`:** Georgian's ISO 639-1 language code is `ka` (Kartuli). `ge` is the *country* code for Georgia and is **not** a valid language code — the schema uses `ka` throughout.

### 9b. STILL OPEN (defer to Phase 2)

5. **Georgian content sourcing:** author in-house vs. partner vs. licensed corpus. Biggest unknown; the moat lives here.
6. **Monetization model:** out of scope now, but it determines how hard the IP/brand-agnostic line (D4) must be held.

---

## 10. Non-Negotiable Design Principles (guardrails for implementation)

1. Car state is **always** a projection of proficiency — never independent (D5).
2. Model tier unlocks **only** via CEFR; points never buy a higher model (D3).
3. Ship **original** car designs; brand references are internal design targets only (D4).
4. Raw attempt log is immutable; all derived state recomputes from it.
5. Client is thin; all logic behind the API for future mobile reuse (D7).
