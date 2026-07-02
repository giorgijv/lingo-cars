-- CreateEnum
CREATE TYPE "CosmeticKind" AS ENUM ('wheels', 'spoiler', 'paint', 'decal');

-- CreateEnum
CREATE TYPE "PurchaseAction" AS ENUM ('buy', 'sell');

-- CreateTable
CREATE TABLE "CosmeticsCatalog" (
    "id" TEXT NOT NULL,
    "tier" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "costPoints" INTEGER NOT NULL,
    "kind" "CosmeticKind" NOT NULL,

    CONSTRAINT "CosmeticsCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pairId" TEXT NOT NULL,
    "cosmeticId" TEXT NOT NULL,
    "action" "PurchaseAction" NOT NULL,
    "points" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Purchase_userId_pairId_createdAt_idx" ON "Purchase"("userId", "pairId", "createdAt");

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_pairId_fkey" FOREIGN KEY ("pairId") REFERENCES "LanguagePair"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_cosmeticId_fkey" FOREIGN KEY ("cosmeticId") REFERENCES "CosmeticsCatalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Economy grants + append-only enforcement (Rule 4, same as Attempt) ──

-- Catalog is read-only at runtime.
GRANT SELECT ON "CosmeticsCatalog" TO app_role;

-- Immutable purchase ledger: SELECT + INSERT ONLY.
GRANT SELECT, INSERT ON "Purchase" TO app_role;

CREATE OR REPLACE FUNCTION forbid_purchase_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Purchase is append-only (Rule 4): % is not permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER purchase_no_update
  BEFORE UPDATE ON "Purchase"
  FOR EACH ROW EXECUTE FUNCTION forbid_purchase_mutation();

CREATE TRIGGER purchase_no_delete
  BEFORE DELETE ON "Purchase"
  FOR EACH ROW EXECUTE FUNCTION forbid_purchase_mutation();

CREATE TRIGGER purchase_no_truncate
  BEFORE TRUNCATE ON "Purchase"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_purchase_mutation();
