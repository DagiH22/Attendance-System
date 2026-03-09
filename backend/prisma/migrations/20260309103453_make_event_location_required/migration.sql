/*
  Warnings:

  - Made the column `location` on table `events` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "events" ALTER COLUMN "location" SET NOT NULL;
