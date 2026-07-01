-- Append-only enforcement for the "Attempt" immutable event log (Rule 4),
-- plus least-privilege runtime grants for the restricted app_role.
--
-- Two independent layers guarantee immutability:
--   1. app_role is granted SELECT + INSERT on "Attempt" only (never UPDATE/DELETE).
--      This is effective ONLY because app_role does NOT own the tables (postgres
--      does); table owners bypass GRANT/REVOKE.
--   2. A trigger hard-fails UPDATE/DELETE/TRUNCATE on "Attempt" for EVERY role
--      (including the owner) — belt-and-suspenders against migrations, ad-hoc
--      queries, or a future privileged path.

-- ─────────────── Layer 1: least-privilege grants for app_role ───────────────

-- Schema access. Kept here (not as an out-of-band grant) so it survives
-- `prisma migrate reset`, which drops & recreates the public schema.
GRANT USAGE ON SCHEMA public TO app_role;

-- Start from a clean slate on every table.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM app_role;

-- Read-only catalog & content.
GRANT SELECT ON "Language", "LanguagePair", "Skill", "Lesson", "Exercise" TO app_role;

-- Users & enrollment: app creates and updates these (placement seeds currentCefr,
-- evaluateTier promotes/demotes it). No DELETE from the app.
GRANT SELECT, INSERT, UPDATE ON "User", "Enrollment" TO app_role;

-- Immutable event log: SELECT + INSERT ONLY. Deliberately no UPDATE/DELETE.
GRANT SELECT, INSERT ON "Attempt" TO app_role;

-- Derived, fully replayable state: recompute wipes & rewrites, so full DML.
GRANT SELECT, INSERT, UPDATE, DELETE ON "ReviewState", "ProficiencyState" TO app_role;

-- ─────────────── Layer 2: trigger blocking mutation for all roles ───────────────

CREATE OR REPLACE FUNCTION forbid_attempt_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Attempt is append-only (Rule 4): % is not permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER attempt_no_update
  BEFORE UPDATE ON "Attempt"
  FOR EACH ROW EXECUTE FUNCTION forbid_attempt_mutation();

CREATE TRIGGER attempt_no_delete
  BEFORE DELETE ON "Attempt"
  FOR EACH ROW EXECUTE FUNCTION forbid_attempt_mutation();

-- TRUNCATE bypasses row-level DELETE triggers, so guard it at statement level.
CREATE TRIGGER attempt_no_truncate
  BEFORE TRUNCATE ON "Attempt"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_attempt_mutation();
