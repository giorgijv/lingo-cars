-- AlterEnum
ALTER TYPE "ExerciseType" ADD VALUE 'fill';

-- AlterTable
ALTER TABLE "Attempt" ADD COLUMN     "responseJson" JSONB,
ADD COLUMN     "score" DOUBLE PRECISION;
