-- V2 Migration: Studies, Lateness Threshold, Excuse Flow, Soft-Delete Undo, and Academic Tracking
-- Purely ADDITIVE schema changes (safe for v1 & v2 expand/contract deployment)

-- CreateEnum: SessionType
CREATE TYPE "SessionType" AS ENUM ('EVENING', 'OVERNIGHT', 'OTHER');

-- CreateEnum: AudienceType
CREATE TYPE "AudienceType" AS ENUM ('ALL', 'FINAL_YEAR', 'BATCHES');

-- CreateEnum: AttendanceStatus
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'EXCUSED');

-- AlterTable: members (additive nullable columns)
ALTER TABLE "members" 
  ADD COLUMN "batchOverride" "Batch",
  ADD COLUMN "deactivatedAt" TIMESTAMP(3),
  ADD COLUMN "entryAcademicYear" INTEGER;

-- AlterTable: events (additive nullable columns + defaulted sessionType)
ALTER TABLE "events" 
  ADD COLUMN "cancelReason" TEXT,
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "lateGraceMinutes" INTEGER,
  ADD COLUMN "plannedStartTime" TIMESTAMP(3),
  ADD COLUMN "rescheduleReason" TEXT,
  ADD COLUMN "rescheduledAt" TIMESTAMP(3),
  ADD COLUMN "sessionType" "SessionType" NOT NULL DEFAULT 'EVENING',
  ADD COLUMN "studyId" UUID;

-- AlterTable: attendances (additive nullable columns + defaulted status)
ALTER TABLE "attendances" 
  ADD COLUMN "excuseReason" TEXT,
  ADD COLUMN "removeReason" TEXT,
  ADD COLUMN "removedAt" TIMESTAMP(3),
  ADD COLUMN "removedById" UUID,
  ADD COLUMN "status" "AttendanceStatus" NOT NULL DEFAULT 'PRESENT';

-- CreateTable: studies
CREATE TABLE "studies" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "audienceType" "AudienceType" NOT NULL DEFAULT 'ALL',
    "audienceBatches" "Batch"[] DEFAULT ARRAY[]::"Batch"[],
    "requiredSessions" INTEGER,
    "defaultLateGraceMinutes" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "studies_pkey" PRIMARY KEY ("id")
);

-- Indexes for performance
CREATE INDEX "studies_startDate_idx" ON "studies"("startDate");
CREATE INDEX "studies_endDate_idx" ON "studies"("endDate");
CREATE INDEX "studies_isActive_idx" ON "studies"("isActive");

CREATE INDEX "members_campus_idx" ON "members"("campus");
CREATE INDEX "members_entryAcademicYear_idx" ON "members"("entryAcademicYear");

CREATE INDEX "events_studyId_idx" ON "events"("studyId");
CREATE INDEX "events_cancelledAt_idx" ON "events"("cancelledAt");

CREATE INDEX "attendances_status_idx" ON "attendances"("status");
CREATE INDEX "attendances_removedAt_idx" ON "attendances"("removedAt");

-- Foreign key constraints with safe cascade / set null rules
ALTER TABLE "events" ADD CONSTRAINT "events_studyId_fkey" 
  FOREIGN KEY ("studyId") REFERENCES "studies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "attendances" ADD CONSTRAINT "attendances_removedById_fkey" 
  FOREIGN KEY ("removedById") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
