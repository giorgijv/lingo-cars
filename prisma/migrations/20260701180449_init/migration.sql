-- CreateEnum
CREATE TYPE "Cefr" AS ENUM ('A1', 'A2', 'B1', 'B2', 'C1', 'C2');

-- CreateEnum
CREATE TYPE "UiLanguage" AS ENUM ('en', 'de');

-- CreateEnum
CREATE TYPE "ExerciseType" AS ENUM ('mcq');

-- CreateEnum
CREATE TYPE "SessionType" AS ENUM ('placement', 'study', 'review');

-- CreateEnum
CREATE TYPE "FsrsState" AS ENUM ('new', 'learning', 'review', 'relearning');

-- CreateTable
CREATE TABLE "Language" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Language_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "LanguagePair" (
    "id" TEXT NOT NULL,
    "sourceCode" TEXT NOT NULL,
    "targetCode" TEXT NOT NULL,

    CONSTRAINT "LanguagePair_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "uiLanguage" "UiLanguage" NOT NULL DEFAULT 'en',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Enrollment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pairId" TEXT NOT NULL,
    "currentCefr" "Cefr" NOT NULL DEFAULT 'A1',
    "placementResultJson" JSONB,
    "placementCompletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Enrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Skill" (
    "id" TEXT NOT NULL,
    "pairId" TEXT NOT NULL,
    "cefr" "Cefr" NOT NULL,
    "name" TEXT NOT NULL,
    "orderIdx" INTEGER NOT NULL,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lesson" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "orderIdx" INTEGER NOT NULL,

    CONSTRAINT "Lesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exercise" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "type" "ExerciseType" NOT NULL DEFAULT 'mcq',
    "payloadJson" JSONB NOT NULL,
    "difficulty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Exercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "correct" BOOLEAN NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "sessionType" "SessionType" NOT NULL DEFAULT 'study',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "stability" DOUBLE PRECISION NOT NULL,
    "difficulty" DOUBLE PRECISION NOT NULL,
    "due" TIMESTAMP(3) NOT NULL,
    "lastReview" TIMESTAMP(3),
    "reps" INTEGER NOT NULL DEFAULT 0,
    "lapses" INTEGER NOT NULL DEFAULT 0,
    "state" "FsrsState" NOT NULL DEFAULT 'new',
    "fsrsParamsVersion" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProficiencyState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pairId" TEXT NOT NULL,
    "perSkillMasteryJson" JSONB NOT NULL,
    "tierMastery" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "inTierProgress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "streakDays" INTEGER NOT NULL DEFAULT 0,
    "lastActive" TIMESTAMP(3),
    "fsrsParamsVersion" INTEGER NOT NULL,
    "recomputedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProficiencyState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LanguagePair_sourceCode_targetCode_key" ON "LanguagePair"("sourceCode", "targetCode");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Enrollment_userId_pairId_key" ON "Enrollment"("userId", "pairId");

-- CreateIndex
CREATE INDEX "Skill_pairId_cefr_idx" ON "Skill"("pairId", "cefr");

-- CreateIndex
CREATE UNIQUE INDEX "Skill_pairId_cefr_orderIdx_key" ON "Skill"("pairId", "cefr", "orderIdx");

-- CreateIndex
CREATE UNIQUE INDEX "Lesson_skillId_orderIdx_key" ON "Lesson"("skillId", "orderIdx");

-- CreateIndex
CREATE INDEX "Exercise_lessonId_idx" ON "Exercise"("lessonId");

-- CreateIndex
CREATE INDEX "Attempt_userId_createdAt_idx" ON "Attempt"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Attempt_userId_exerciseId_createdAt_idx" ON "Attempt"("userId", "exerciseId", "createdAt");

-- CreateIndex
CREATE INDEX "ReviewState_userId_due_idx" ON "ReviewState"("userId", "due");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewState_userId_exerciseId_key" ON "ReviewState"("userId", "exerciseId");

-- CreateIndex
CREATE UNIQUE INDEX "ProficiencyState_userId_pairId_key" ON "ProficiencyState"("userId", "pairId");

-- AddForeignKey
ALTER TABLE "LanguagePair" ADD CONSTRAINT "LanguagePair_sourceCode_fkey" FOREIGN KEY ("sourceCode") REFERENCES "Language"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LanguagePair" ADD CONSTRAINT "LanguagePair_targetCode_fkey" FOREIGN KEY ("targetCode") REFERENCES "Language"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_pairId_fkey" FOREIGN KEY ("pairId") REFERENCES "LanguagePair"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Skill" ADD CONSTRAINT "Skill_pairId_fkey" FOREIGN KEY ("pairId") REFERENCES "LanguagePair"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewState" ADD CONSTRAINT "ReviewState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewState" ADD CONSTRAINT "ReviewState_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProficiencyState" ADD CONSTRAINT "ProficiencyState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProficiencyState" ADD CONSTRAINT "ProficiencyState_pairId_fkey" FOREIGN KEY ("pairId") REFERENCES "LanguagePair"("id") ON DELETE CASCADE ON UPDATE CASCADE;
