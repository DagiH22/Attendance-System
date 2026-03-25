/*
  Warnings:

  - This migration removes sub event artifacts if they still exist.
*/

-- Drop legacy sub-event artifacts if present
ALTER TABLE "attendances" DROP CONSTRAINT IF EXISTS "attendances_subEventId_fkey";

DROP INDEX IF EXISTS "attendances_memberId_subEventId_key";
DROP INDEX IF EXISTS "attendances_subEventId_idx";

ALTER TABLE "attendances" DROP COLUMN IF EXISTS "subEventId";
ALTER TABLE "attendances" ALTER COLUMN "eventId" SET NOT NULL;

DROP TABLE IF EXISTS "sub_events";

DROP INDEX IF EXISTS "sub_events_parentEventId_idx";
DROP INDEX IF EXISTS "sub_events_date_idx";

-- CreateTable
CREATE TABLE "event_clusters" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID NOT NULL,

    CONSTRAINT "event_clusters_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "clusterId" UUID,
ADD COLUMN     "clusterLabel" TEXT;

-- CreateIndex
CREATE INDEX "event_clusters_createdById_idx" ON "event_clusters"("createdById");
CREATE INDEX "event_clusters_startDate_idx" ON "event_clusters"("startDate");
CREATE INDEX "event_clusters_endDate_idx" ON "event_clusters"("endDate");
CREATE INDEX "events_clusterId_idx" ON "events"("clusterId");

-- AddForeignKey
ALTER TABLE "event_clusters" ADD CONSTRAINT "event_clusters_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "events" ADD CONSTRAINT "events_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "event_clusters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
