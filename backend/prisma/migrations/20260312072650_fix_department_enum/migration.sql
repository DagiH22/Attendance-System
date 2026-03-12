/*
  Warnings:

  - The `department` column on the `members` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterEnum
ALTER TYPE "Batch" ADD VALUE 'POST_GRADUATE';

-- AlterEnum
ALTER TYPE "Campus" ADD VALUE 'ART';

-- AlterTable
ALTER TABLE "members" DROP COLUMN "department",
ADD COLUMN     "department" TEXT;

-- DropEnum
DROP TYPE "Department";
