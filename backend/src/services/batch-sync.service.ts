import { PrismaClient } from "@prisma/client";
import { computeBatch, getAddisDateParts } from "./academic.service";
import { ACADEMIC_TIMEZONE } from "../config/academic.config";

export interface BatchSyncResult {
  checkedCount: number;
  updatedCount: number;
  changes: Array<{
    memberId: string;
    name: string;
    oldBatch: string;
    newBatch: string;
  }>;
}

/**
 * Idempotently evaluates each member's effective batch as of referenceDate
 * and persists it to the stored `batch` column in table `members`.
 * Logs how many rows changed.
 */
export async function syncMemberBatches(
  prisma: PrismaClient,
  referenceDate: Date = new Date(),
): Promise<BatchSyncResult> {
  const members = await prisma.member.findMany({
    select: {
      id: true,
      name: true,
      campus: true,
      batch: true,
      entryAcademicYear: true,
      batchOverride: true,
    },
  });

  const changes: BatchSyncResult["changes"] = [];

  for (const member of members) {
    const entryYear = member.entryAcademicYear ?? 2025;
    const effective = computeBatch(
      {
        campus: member.campus,
        entryAcademicYear: entryYear,
        batchOverride: member.batchOverride,
      },
      referenceDate,
    );

    if (member.batch !== effective) {
      await prisma.member.update({
        where: { id: member.id },
        data: { batch: effective },
      });
      changes.push({
        memberId: member.id,
        name: member.name,
        oldBatch: member.batch,
        newBatch: effective,
      });
    }
  }

  console.log(
    `[BatchSync] Recomputed stored batch column as of ${referenceDate.toISOString()} (Addis time). Evaluated: ${members.length}, updated: ${changes.length}.`,
  );

  return {
    checkedCount: members.length,
    updatedCount: changes.length,
    changes,
  };
}

let batchSyncTimerHandle: NodeJS.Timeout | null = null;
let lastSyncAddisDateStr: string | null = null;

/**
 * Starts the daily batch synchronization runner.
 * 1. Runs immediately at startup for catch-up (e.g. if server was down on Sept 11).
 * 2. Runs once per day at 00:05 Addis Ababa time (21:05 UTC).
 */
export function startBatchSyncScheduler(
  prisma: PrismaClient,
  checkIntervalMs: number = 60_000,
): () => void {
  // 1. Startup catch-up execution
  const now = new Date();
  const startupParts = getAddisDateParts(now, ACADEMIC_TIMEZONE);
  const startupDateStr = `${startupParts.year}-${String(startupParts.month).padStart(2, "0")}-${String(startupParts.day).padStart(2, "0")}`;

  void syncMemberBatches(prisma, now)
    .then((result) => {
      console.log(
        `[BatchSync Startup] Catch-up completed. Rows updated: ${result.updatedCount}`,
      );
      if (startupParts.hour === 0 && startupParts.minute >= 5) {
        lastSyncAddisDateStr = startupDateStr;
      }
    })
    .catch((err) => {
      console.error("[BatchSync Startup] Failed initial catch-up sync:", err);
    });

  // 2. Periodic checker for 00:05 Addis time
  if (batchSyncTimerHandle) {
    clearInterval(batchSyncTimerHandle);
  }

  batchSyncTimerHandle = setInterval(() => {
    const currentTime = new Date();
    const parts = getAddisDateParts(currentTime, ACADEMIC_TIMEZONE);
    const currentDateStr = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;

    // Target: 00:05 in Africa/Addis_Ababa
    if (parts.hour === 0 && parts.minute === 5 && lastSyncAddisDateStr !== currentDateStr) {
      lastSyncAddisDateStr = currentDateStr;
      console.log(
        `[BatchSync Scheduler] Triggering scheduled 00:05 Addis batch sync for date: ${currentDateStr}`,
      );
      void syncMemberBatches(prisma, currentTime).catch((err) => {
        console.error("[BatchSync Scheduler] Error executing scheduled batch sync:", err);
      });
    }
  }, checkIntervalMs);

  return () => {
    if (batchSyncTimerHandle) {
      clearInterval(batchSyncTimerHandle);
      batchSyncTimerHandle = null;
    }
  };
}
