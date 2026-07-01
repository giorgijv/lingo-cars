-- CreateTable
CREATE TABLE "CarCatalog" (
    "tier" INTEGER NOT NULL,
    "className" TEXT NOT NULL,
    "baseSpeed" DOUBLE PRECISION NOT NULL,
    "baseHandling" DOUBLE PRECISION NOT NULL,
    "unlockCefr" "Cefr" NOT NULL,

    CONSTRAINT "CarCatalog_pkey" PRIMARY KEY ("tier")
);

-- CreateIndex
CREATE UNIQUE INDEX "CarCatalog_unlockCefr_key" ON "CarCatalog"("unlockCefr");

-- Runtime role reads the catalog only; content authoring stays owner-side.
GRANT SELECT ON "CarCatalog" TO app_role;
