/*
  Warnings:

  - Made the column `phone` on table `members` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "Department" AS ENUM ('BIO', 'CHEM', 'CS', 'GEO', 'STAT', 'MATH', 'PHY', 'IS', 'ENGINEERING', 'FRESHMAN');

-- CreateEnum
CREATE TYPE "Batch" AS ENUM ('FRESHMAN', 'YEAR_2', 'YEAR_3', 'YEAR_4', 'YEAR_5');

-- CreateEnum
CREATE TYPE "Campus" AS ENUM ('FOUR_KILO', 'FIVE_KILO', 'SIX_KILO');

-- AlterTable
ALTER TABLE "members" ADD COLUMN     "batch" "Batch",
ADD COLUMN     "campus" "Campus",
ADD COLUMN     "department" "Department",
ALTER COLUMN "phone" SET NOT NULL;
