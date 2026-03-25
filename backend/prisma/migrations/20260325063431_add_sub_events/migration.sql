/*
  Warnings:

  - A unique constraint covering the columns `[memberId,subEventId]` on the table `attendances` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "attendances" ADD COLUMN     "subEventId" UUID,
ALTER COLUMN "eventId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "sub_events" (
    "id" UUID NOT NULL,
    "parentEventId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sub_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sub_events_parentEventId_idx" ON "sub_events"("parentEventId");

-- CreateIndex
CREATE INDEX "sub_events_date_idx" ON "sub_events"("date");

-- CreateIndex
CREATE INDEX "attendances_subEventId_idx" ON "attendances"("subEventId");

-- CreateIndex
CREATE UNIQUE INDEX "attendances_memberId_subEventId_key" ON "attendances"("memberId", "subEventId");

-- AddForeignKey
ALTER TABLE "sub_events" ADD CONSTRAINT "sub_events_parentEventId_fkey" FOREIGN KEY ("parentEventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_subEventId_fkey" FOREIGN KEY ("subEventId") REFERENCES "sub_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
