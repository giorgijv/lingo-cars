-- Race Step 4: move RaceResult from a shift-accuracy skill score to a
-- position-based outcome (the client now runs a real-time driven sprint
-- against AI rivals instead of a gear-shift timing minigame).

-- AddColumn (existing rows — local dev/test fixtures only — get a safe
-- default; the app always supplies real values on every future insert)
ALTER TABLE "RaceResult" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "RaceResult" ADD COLUMN "rivalCount" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "RaceResult" ADD COLUMN "trackId" TEXT NOT NULL DEFAULT 'sprint-1';

-- DropColumn — skillScore has no meaning once the race is really driven
-- rather than timed via gear-shift accuracy.
ALTER TABLE "RaceResult" DROP COLUMN "skillScore";

-- DropDefault — the app always supplies these explicitly on insert; the
-- defaults above exist only to satisfy pre-existing rows during this
-- migration.
ALTER TABLE "RaceResult" ALTER COLUMN "position" DROP DEFAULT;
ALTER TABLE "RaceResult" ALTER COLUMN "rivalCount" DROP DEFAULT;
ALTER TABLE "RaceResult" ALTER COLUMN "trackId" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "RaceResult_userId_pairId_position_idx" ON "RaceResult"("userId", "pairId", "position");
