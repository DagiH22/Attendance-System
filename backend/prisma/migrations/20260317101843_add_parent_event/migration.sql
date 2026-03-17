/*
  Warnings:

  - You are about to drop the column `parent_event_id` on the `events` table. All the data in the column will be lost.
  - You are about to drop the column `recurrence_index` on the `events` table. All the data in the column will be lost.
  - You are about to drop the column `recurrence_length_weeks` on the `events` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "events" DROP CONSTRAINT "events_parent_event_id_fkey";

-- DropIndex
DROP INDEX "events_parent_event_id_idx";

-- AlterTable
ALTER TABLE "events" DROP COLUMN "parent_event_id",
DROP COLUMN "recurrence_index",
DROP COLUMN "recurrence_length_weeks",
ADD COLUMN     "parentEventId" UUID,
ADD COLUMN     "recurrenceIndex" INTEGER,
ADD COLUMN     "recurrenceLengthWeeks" INTEGER;

-- CreateIndex
CREATE INDEX "events_parentEventId_idx" ON "events"("parentEventId");

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_parentEventId_fkey" FOREIGN KEY ("parentEventId") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
