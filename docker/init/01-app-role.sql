-- Runs once, on first container init (empty data dir).
-- Creates the restricted runtime role. It deliberately does NOT own any tables
-- (postgres does), so the append-only REVOKE on "Attempt" in the Prisma
-- migration is enforceable — table owners bypass GRANT/REVOKE.
--
-- Per-table grants + schema USAGE for app_role are applied by the migration
-- (20260701180500_append_only_attempt), which runs as the owner.

CREATE ROLE app_role LOGIN PASSWORD 'app_pass';
GRANT CONNECT ON DATABASE lingo_cars TO app_role;
