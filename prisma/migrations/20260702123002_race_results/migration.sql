-- CreateTable
CREATE TABLE "RaceResult" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pairId" TEXT NOT NULL,
    "tier" INTEGER NOT NULL,
    "speed" DOUBLE PRECISION NOT NULL,
    "handling" DOUBLE PRECISION NOT NULL,
    "skillScore" DOUBLE PRECISION NOT NULL,
    "finishMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RaceResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RaceResult_userId_pairId_finishMs_idx" ON "RaceResult"("userId", "pairId", "finishMs");

-- AddForeignKey
ALTER TABLE "RaceResult" ADD CONSTRAINT "RaceResult_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RaceResult" ADD CONSTRAINT "RaceResult_pairId_fkey" FOREIGN KEY ("pairId") REFERENCES "LanguagePair"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Race log grants + append-only enforcement (Rule 4 house style) ──
GRANT SELECT, INSERT ON "RaceResult" TO app_role;

CREATE OR REPLACE FUNCTION forbid_race_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'RaceResult is append-only (Rule 4): % is not permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER race_no_update BEFORE UPDATE ON "RaceResult"
  FOR EACH ROW EXECUTE FUNCTION forbid_race_mutation();
CREATE TRIGGER race_no_delete BEFORE DELETE ON "RaceResult"
  FOR EACH ROW EXECUTE FUNCTION forbid_race_mutation();
CREATE TRIGGER race_no_truncate BEFORE TRUNCATE ON "RaceResult"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_race_mutation();
