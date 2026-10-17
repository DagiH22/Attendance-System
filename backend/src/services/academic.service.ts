import { Campus, Batch } from "@prisma/client";
import {
  CAMPUS_PROGRAM_YEARS,
  ACADEMIC_YEAR_START_MONTH,
  LEVEL_TO_BATCH,
  DEFAULT_LATE_GRACE_MINUTES,
} from "../config/academic.config";

export type AudienceType = "ALL" | "FINAL_YEAR" | "BATCHES";

export interface AcademicMemberLike {
  id: string;
  campus: Campus;
  entryAcademicYear: number;
  batchOverride?: Batch | null;
  createdAt: Date;
  deactivatedAt?: Date | null;
}

export interface AcademicStudyLike {
  id?: string;
  audienceType?: AudienceType | string | null;
  audienceBatches?: Batch[] | string[] | null;
  defaultLateGraceMinutes?: number | null;
  requiredSessions?: number | null;
}

export interface AcademicEventLike {
  id: string;
  startTime: Date;
  endTime: Date;
  studyId?: string | null;
  study?: AcademicStudyLike | null;
  cancelledAt?: Date | null;
  lateGraceMinutes?: number | null;
}

export interface AcademicAttendanceLike {
  id?: string;
  memberId: string;
  eventId: string;
  status: "PRESENT" | "LATE" | "EXCUSED";
  markedAt: Date;
  removedAt?: Date | null;
}

export interface EventStatsResult {
  isCancelled: boolean;
  eligible: number;
  present: number;
  late: number;
  excused: number;
  absent: number;
  attendanceRate: number | null;
}

/**
 * Returns the 4-digit starting calendar year for the academic year of the given date.
 * E.g., with startMonth = 9 (September):
 * - 2026-10-17 -> 2026 (2026/27 academic year)
 * - 2026-08-31 -> 2025 (2025/26 academic year)
 * - 2026-09-01 -> 2026 (2026/27 academic year)
 */
export function getAcademicYear(
  date: Date,
  startMonth: number = ACADEMIC_YEAR_START_MONTH,
): number {
  const d = new Date(date);
  const month = d.getMonth() + 1; // 1-12
  const fullYear = d.getFullYear();
  return month >= startMonth ? fullYear : fullYear - 1;
}

/**
 * Computes the effective batch of a member as of a reference date.
 * Formula: level = academicYear(asOf) - entryAcademicYear + 1.
 * If level > campus years -> GRADUATE.
 * Otherwise mapped to FRESHMAN, YEAR_2..YEAR_5.
 * If batchOverride is set, batchOverride wins.
 */
export function computeBatch(
  member: Pick<AcademicMemberLike, "campus" | "entryAcademicYear"> & {
    batchOverride?: Batch | null;
  },
  asOfDate: Date,
): Batch {
  if (member.batchOverride) {
    return member.batchOverride;
  }

  const currentAcademicYear = getAcademicYear(asOfDate);
  const level = currentAcademicYear - member.entryAcademicYear + 1;
  const programYears = CAMPUS_PROGRAM_YEARS[member.campus] ?? 4;

  if (level <= 0) {
    return Batch.FRESHMAN;
  }

  if (level > programYears) {
    return Batch.GRADUATE;
  }

  return LEVEL_TO_BATCH[level] ?? Batch.GRADUATE;
}

/**
 * Determines whether a member is in their final year of university study as of a reference date.
 * level == campus years (or matching batchOverride).
 */
export function isFinalYear(
  member: Pick<AcademicMemberLike, "campus" | "entryAcademicYear"> & {
    batchOverride?: Batch | null;
  },
  asOfDate: Date,
): boolean {
  const programYears = CAMPUS_PROGRAM_YEARS[member.campus] ?? 4;

  if (member.batchOverride) {
    const finalYearBatch = programYears === 5 ? Batch.YEAR_5 : Batch.YEAR_4;
    return member.batchOverride === finalYearBatch;
  }

  const currentAcademicYear = getAcademicYear(asOfDate);
  const level = currentAcademicYear - member.entryAcademicYear + 1;
  return level === programYears;
}

/**
 * Determines eligible members for an event:
 * - Registered before or at event startTime (createdAt <= event.startTime)
 * - Not deactivated before event startTime (deactivatedAt == null || deactivatedAt > event.startTime)
 * - Filtered by study's audience:
 *    - Events without a study: audience ALL
 *    - ALL: all members
 *    - FINAL_YEAR: members where isFinalYear(member, event.startTime) is true
 *    - BATCHES: members where study.audienceBatches includes computeBatch(member, event.startTime)
 * - CRITICAL: Any member who has an active attendance record for the event is ALWAYS counted as eligible.
 */
export function getEligibleMembers<T extends AcademicMemberLike>(
  event: AcademicEventLike,
  allMembers: T[],
  attendances: AcademicAttendanceLike[] = [],
  asOfDate: Date = event.startTime,
): T[] {
  const eventStart = new Date(event.startTime);
  const activeAttendees = new Set(
    attendances
      .filter((a) => a.eventId === event.id && !a.removedAt)
      .map((a) => a.memberId),
  );

  const audienceType: AudienceType =
    (event.study?.audienceType as AudienceType) || "ALL";
  const audienceBatches = (event.study?.audienceBatches || []) as Batch[];

  return allMembers.filter((member) => {
    // If the member attended the event, they are ALWAYS eligible
    if (activeAttendees.has(member.id)) {
      return true;
    }

    // Registered at or before event start
    const registeredAt = new Date(member.createdAt);
    if (registeredAt > eventStart) {
      return false;
    }

    // Not deactivated before event start
    if (member.deactivatedAt && new Date(member.deactivatedAt) <= eventStart) {
      return false;
    }

    // Audience filtering based on computed batch at event time
    if (audienceType === "ALL") {
      return true;
    }

    if (audienceType === "FINAL_YEAR") {
      return isFinalYear(member, asOfDate);
    }

    if (audienceType === "BATCHES") {
      const batch = computeBatch(member, asOfDate);
      return audienceBatches.includes(batch);
    }

    return true;
  });
}

/**
 * Calculates event attendance stats:
 * - Cancelled events are excluded from analytics (isCancelled: true, counts 0 / null rate)
 * - Present, Late, Excused counts from non-removed attendances
 * - Absent = eligible - (present + late + excused) (minimum 0)
 * - Attendance Rate = (present + late) / (eligible - excused), null if denominator <= 0
 */
export function getEventStats(
  event: AcademicEventLike,
  eligibleMembers: AcademicMemberLike[],
  attendances: AcademicAttendanceLike[],
): EventStatsResult {
  if (event.cancelledAt) {
    return {
      isCancelled: true,
      eligible: 0,
      present: 0,
      late: 0,
      excused: 0,
      absent: 0,
      attendanceRate: null,
    };
  }

  const activeRecords = attendances.filter(
    (a) => a.eventId === event.id && !a.removedAt,
  );

  let present = 0;
  let late = 0;
  let excused = 0;

  for (const record of activeRecords) {
    if (record.status === "PRESENT") present++;
    else if (record.status === "LATE") late++;
    else if (record.status === "EXCUSED") excused++;
  }

  const eligible = eligibleMembers.length;
  const absent = Math.max(0, eligible - (present + late + excused));
  const denominator = eligible - excused;

  const attendanceRate =
    denominator > 0
      ? Math.round(((present + late) / denominator) * 1000) / 1000
      : null;

  return {
    isCancelled: false,
    eligible,
    present,
    late,
    excused,
    absent,
    attendanceRate,
  };
}

/**
 * Resolves the late grace minutes for an event:
 * Event.lateGraceMinutes -> Study.defaultLateGraceMinutes -> DEFAULT_LATE_GRACE_MINUTES (15)
 */
export function resolveLateGraceMinutes(
  event: AcademicEventLike,
  study?: AcademicStudyLike | null,
): number {
  if (
    typeof event.lateGraceMinutes === "number" &&
    !Number.isNaN(event.lateGraceMinutes)
  ) {
    return event.lateGraceMinutes;
  }
  const studyObj = study ?? event.study;
  if (
    studyObj &&
    typeof studyObj.defaultLateGraceMinutes === "number" &&
    !Number.isNaN(studyObj.defaultLateGraceMinutes)
  ) {
    return studyObj.defaultLateGraceMinutes;
  }
  return DEFAULT_LATE_GRACE_MINUTES;
}

/**
 * Determines whether a check-in is PRESENT or LATE.
 * Check-in after event.startTime + graceMinutes is LATE.
 * Exactly at boundary or before is PRESENT.
 */
export function computeLatenessStatus(
  eventStartTime: Date,
  checkInTime: Date,
  graceMinutes: number = DEFAULT_LATE_GRACE_MINUTES,
): "PRESENT" | "LATE" {
  const startMs = new Date(eventStartTime).getTime();
  const checkInMs = new Date(checkInTime).getTime();
  const thresholdMs = startMs + graceMinutes * 60 * 1000;

  return checkInMs > thresholdMs ? "LATE" : "PRESENT";
}

/**
 * Derives entryAcademicYear for a legacy member during migration/backfill.
 * E.g. in 2025/26 (academicYear = 2025):
 * FRESHMAN (level 1) -> 2025 - 1 + 1 = 2025
 * YEAR_2 (level 2)   -> 2025 - 2 + 1 = 2024
 * YEAR_5 (level 5)   -> 2025 - 5 + 1 = 2021
 * GRADUATE           -> 2025 - programYears (i.e. finished in past)
 * Returns { entryAcademicYear, isInconsistent, inconsistencyReason }
 */
export function deriveEntryAcademicYearForBackfill(
  member: { campus: Campus; batch: Batch },
  asOfDate: Date = new Date(),
): {
  entryAcademicYear: number;
  isInconsistent: boolean;
  inconsistencyReason?: string;
} {
  const currentAcademicYear = getAcademicYear(asOfDate);
  const programYears = CAMPUS_PROGRAM_YEARS[member.campus] ?? 4;

  if (member.batch === Batch.YEAR_5 && programYears < 5) {
    return {
      entryAcademicYear: currentAcademicYear - 4, // 5th year level on a 4-year campus
      isInconsistent: true,
      inconsistencyReason: `Member has batch YEAR_5 on ${member.campus} which is a ${programYears}-year program.`,
    };
  }

  const levelMap: Record<Batch, number> = {
    FRESHMAN: 1,
    YEAR_2: 2,
    YEAR_3: 3,
    YEAR_4: 4,
    YEAR_5: 5,
    GRADUATE: programYears + 1,
  };

  const level = levelMap[member.batch] ?? 1;
  const entryAcademicYear = currentAcademicYear - level + 1;

  return {
    entryAcademicYear,
    isInconsistent: false,
  };
}
