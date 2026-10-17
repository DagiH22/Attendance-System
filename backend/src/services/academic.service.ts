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
  name?: string;
  uniqueId?: string;
  phoneNumber?: string | null;
  campus: Campus;
  department?: string | null;
  entryAcademicYear: number;
  batchOverride?: Batch | null;
  createdAt: Date | string;
  deactivatedAt?: Date | string | null;
  isActive?: boolean;
  [key: string]: any;
}

export interface AcademicStudyLike {
  id?: string;
  name?: string;
  isActive?: boolean;
  endDate?: Date | string | null;
  audienceType?: AudienceType | string | null;
  audienceBatches?: Batch[] | string[] | null;
  defaultLateGraceMinutes?: number | null;
  requiredSessions?: number | null;
  [key: string]: any;
}

export interface AcademicEventLike {
  id: string;
  title?: string;
  eventDate?: Date | string | null;
  startTime: Date;
  endTime: Date;
  endedAt?: Date | null;
  type?: any;
  recurrenceIndex?: number | null;
  studyId?: string | null;
  study?: AcademicStudyLike | null;
  cancelledAt?: Date | null;
  lateGraceMinutes?: number | null;
  [key: string]: any;
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
  participants: number;
  present: number;
  late: number;
  excused: number;
  absentAmongParticipants: number;
  turnoutAmongParticipants: number | null;
  eligibleAttendanceRate: number | null;
  attendanceRate: number | null;
  absent: number;
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
 * - participants: participants of the event's study as of event's end
 * - absentAmongParticipants = participants - (present + late + excusedAmongParticipants)
 * - turnoutAmongParticipants = (present + late) / (participants - excusedAmongParticipants)
 * - eligibleAttendanceRate = (present + late) / (eligible - excused)
 * - attendanceRate = turnoutAmongParticipants ?? eligibleAttendanceRate (headline turnout)
 */
export function getEventStats(
  event: AcademicEventLike,
  eligibleMembers: AcademicMemberLike[],
  attendances: AcademicAttendanceLike[],
  studyParticipantsCount?: number,
  studyParticipantIds?: Set<string>,
): EventStatsResult {
  if (event.cancelledAt) {
    return {
      isCancelled: true,
      eligible: 0,
      participants: 0,
      present: 0,
      late: 0,
      excused: 0,
      absentAmongParticipants: 0,
      turnoutAmongParticipants: null,
      eligibleAttendanceRate: null,
      attendanceRate: null,
      absent: 0,
    };
  }

  const activeRecords = attendances.filter(
    (a) => a.eventId === event.id && !a.removedAt,
  );

  let present = 0;
  let late = 0;
  let excused = 0;
  let excusedAmongParticipants = 0;

  for (const record of activeRecords) {
    if (record.status === "PRESENT") present++;
    else if (record.status === "LATE") late++;
    else if (record.status === "EXCUSED") {
      excused++;
      if (!studyParticipantIds || studyParticipantIds.has(record.memberId)) {
        excusedAmongParticipants++;
      }
    }
  }

  const eligible = eligibleMembers.length;
  const participants =
    typeof studyParticipantsCount === "number"
      ? studyParticipantsCount
      : eligible;

  const absentAmongParticipants = Math.max(
    0,
    participants - (present + late + excusedAmongParticipants),
  );
  const turnoutDenominator = participants - excusedAmongParticipants;
  const turnoutAmongParticipants =
    turnoutDenominator > 0
      ? Math.round(((present + late) / turnoutDenominator) * 1000) / 1000
      : null;

  const eligibleDenominator = eligible - excused;
  const eligibleAttendanceRate =
    eligibleDenominator > 0
      ? Math.round(((present + late) / eligibleDenominator) * 1000) / 1000
      : null;

  const attendanceRate = turnoutAmongParticipants ?? eligibleAttendanceRate;
  const absent = Math.max(0, eligible - (present + late + excused));

  return {
    isCancelled: false,
    eligible,
    participants,
    present,
    late,
    excused,
    absentAmongParticipants,
    turnoutAmongParticipants,
    eligibleAttendanceRate,
    attendanceRate,
    absent,
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

export const REGULAR_STUDY_ID = "REGULAR";
export const REGULAR_STUDY_NAME = "Regular";
export const STUDY_TURNOUT_DIFF_THRESHOLD = 0.20;

export function getEffectiveStudyId(studyId?: string | null): string {
  return studyId || REGULAR_STUDY_ID;
}

export function isStudyOngoing(
  study: { isActive?: boolean; endDate?: Date | string | null } | null | undefined,
  asOf: Date,
): boolean {
  if (!study) return true; // Regular pseudo-study is always ongoing
  if (study.isActive === false) return false;
  if (!study.endDate) return true;
  return new Date(study.endDate).getTime() >= new Date(asOf).getTime();
}

/**
 * Filter held sessions of a study: non-cancelled sessions that ended by asOf.
 * Sorted chronologically by startTime ascending.
 */
export function getHeldSessions(
  events: AcademicEventLike[],
  asOf: Date,
): AcademicEventLike[] {
  const asOfMs = new Date(asOf).getTime();
  return events
    .filter((e) => {
      if (e.cancelledAt) return false;
      const endMs = new Date(e.endTime).getTime();
      return endMs <= asOfMs;
    })
    .sort(
      (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
    );
}

/**
 * Identifies participants of a study as of a reference date.
 * A participant is a member with at least one non-removed attendance of status PRESENT or LATE
 * in a non-cancelled session of that study held on or before asOf.
 */
export function getStudyParticipants(
  studyId: string,
  events: AcademicEventLike[],
  attendances: AcademicAttendanceLike[],
  asOf: Date,
): string[] {
  const heldSessions = getHeldSessions(
    events.filter((e) => getEffectiveStudyId(e.studyId) === studyId),
    asOf,
  );
  const heldSessionIdSet = new Set(heldSessions.map((s) => s.id));

  const participantIds = new Set<string>();

  for (const a of attendances) {
    if (a.removedAt) continue;
    if (a.status !== "PRESENT" && a.status !== "LATE") continue;
    if (heldSessionIdSet.has(a.eventId)) {
      participantIds.add(a.memberId);
    }
  }

  return Array.from(participantIds);
}

export interface ParticipantTrailingMissesResult {
  isParticipant: boolean;
  firstAttendedSessionIndex: number | null; // 1-indexed
  lastAttendedSessionIndex: number | null; // 1-indexed
  trailingMisses: number;
  droppedOff: boolean;
  droppedOffAfterSession: number | null; // 1-indexed
  alertLevel: "CRITICAL" | "WARNING" | null;
}

/**
 * For each participant, trailingMisses = number of held sessions after the member's LAST
 * PRESENT/LATE session in that study, excluding sessions where the member is EXCUSED,
 * and excluding sessions that started before the member's first attendance (never count sessions before they joined).
 *
 * Alert rules:
 * - Shown ONLY for studies that are still ongoing (study has not ended and is active).
 * - trailingMisses >= 3 -> CRITICAL
 * - trailingMisses >= 2 -> WARNING
 * - Never flag a member for a study they have not participated in (alertLevel = null).
 *
 * Ended studies:
 * - No alerts (alertLevel = null).
 * - Expose droppedOff (trailingMisses > 0) and droppedOffAfterSession (lastAttendedSessionIndex).
 */
export function computeParticipantTrailingMisses(
  memberId: string,
  heldSessions: AcademicEventLike[], // chronological
  attendancesForStudy: AcademicAttendanceLike[],
  isOngoing: boolean,
): ParticipantTrailingMissesResult {
  if (heldSessions.length === 0) {
    return {
      isParticipant: false,
      firstAttendedSessionIndex: null,
      lastAttendedSessionIndex: null,
      trailingMisses: 0,
      droppedOff: false,
      droppedOffAfterSession: null,
      alertLevel: null,
    };
  }

  // Map session id to 1-indexed position
  const sessionIndexMap = new Map<string, number>();
  heldSessions.forEach((s, idx) => {
    sessionIndexMap.set(s.id, idx + 1);
  });

  // Attendances of this member in held sessions
  const memberAttendancesByEvent = new Map<string, AcademicAttendanceLike>();
  for (const att of attendancesForStudy) {
    if (
      att.memberId === memberId &&
      !att.removedAt &&
      sessionIndexMap.has(att.eventId)
    ) {
      memberAttendancesByEvent.set(att.eventId, att);
    }
  }

  const attendedIndices: number[] = [];
  for (let i = 0; i < heldSessions.length; i++) {
    const session = heldSessions[i];
    const att = memberAttendancesByEvent.get(session.id);
    if (att && (att.status === "PRESENT" || att.status === "LATE")) {
      attendedIndices.push(i + 1);
    }
  }

  if (attendedIndices.length === 0) {
    // Not a participant of this study!
    return {
      isParticipant: false,
      firstAttendedSessionIndex: null,
      lastAttendedSessionIndex: null,
      trailingMisses: 0,
      droppedOff: false,
      droppedOffAfterSession: null,
      alertLevel: null,
    };
  }

  const firstAttendedIdx = attendedIndices[0];
  const lastAttendedIdx = attendedIndices[attendedIndices.length - 1];

  // Count unexcused held sessions strictly after lastAttendedIdx
  let misses = 0;
  for (let i = lastAttendedIdx; i < heldSessions.length; i++) {
    const session = heldSessions[i];
    const att = memberAttendancesByEvent.get(session.id);
    if (att && att.status === "EXCUSED") {
      // Excused session is excluded
      continue;
    }
    // Any session after lastAttended where they are not excused counts as a trailing miss
    misses++;
  }

  const droppedOff = misses > 0;
  const droppedOffAfterSession = droppedOff ? lastAttendedIdx : null;

  let alertLevel: "CRITICAL" | "WARNING" | null = null;
  if (isOngoing) {
    if (misses >= 3) {
      alertLevel = "CRITICAL";
    } else if (misses >= 2) {
      alertLevel = "WARNING";
    }
  }

  return {
    isParticipant: true,
    firstAttendedSessionIndex: firstAttendedIdx,
    lastAttendedSessionIndex: lastAttendedIdx,
    trailingMisses: misses,
    droppedOff,
    droppedOffAfterSession,
    alertLevel,
  };
}

/**
 * Checks whether a member attended any session of another ongoing study in the last 3 weeks.
 */
export function checkAttendingOtherStudy(
  memberId: string,
  currentStudyId: string,
  allEvents: AcademicEventLike[],
  allAttendances: AcademicAttendanceLike[],
  ongoingStudyIds: Set<string> | string[],
  asOf: Date,
): boolean {
  const ongoingSet = ongoingStudyIds instanceof Set ? ongoingStudyIds : new Set(ongoingStudyIds);
  const asOfMs = new Date(asOf).getTime();
  const threeWeeksAgoMs = asOfMs - 21 * 24 * 60 * 60 * 1000;

  const eventMap = new Map<string, AcademicEventLike>();
  for (const e of allEvents) {
    if (!e.cancelledAt) {
      eventMap.set(e.id, e);
    }
  }

  for (const att of allAttendances) {
    if (att.memberId !== memberId || att.removedAt) continue;
    if (att.status !== "PRESENT" && att.status !== "LATE") continue;

    const event = eventMap.get(att.eventId);
    if (!event) continue;

    const effectiveStudy = getEffectiveStudyId(event.studyId);
    if (effectiveStudy === currentStudyId) continue;
    if (!ongoingSet.has(effectiveStudy)) continue;

    const eventTime = new Date(event.startTime).getTime();
    if (eventTime >= threeWeeksAgoMs && eventTime <= asOfMs) {
      return true;
    }
  }

  return false;
}

/**
 * Determines the evaluation date for a study:
 * - Ongoing study: evaluated as of today (asOf).
 * - Ended study: evaluated as of the study's last session date (or study.endDate if no sessions).
 */
export function getStudyEvaluationDate(
  study: AcademicStudyLike & { endDate?: Date | string | null; isActive?: boolean },
  studyEvents: AcademicEventLike[] = [],
  asOf: Date = new Date(),
): Date {
  const ongoing = isStudyOngoing(study, asOf);
  if (ongoing) {
    return asOf;
  }

  const nonCancelledSessions = studyEvents
    .filter((e) => !e.cancelledAt)
    .sort(
      (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime(),
    );

  if (nonCancelledSessions.length > 0) {
    const lastSession = nonCancelledSessions[0];
    return new Date(lastSession.endTime || lastSession.endedAt || lastSession.startTime);
  }

  return study.endDate ? new Date(study.endDate) : asOf;
}

export function getStudyAudienceBatches(study: AcademicStudyLike): Batch[] {
  const audienceType: AudienceType = (study.audienceType as AudienceType) || "ALL";
  if (audienceType === "ALL") {
    return [
      Batch.FRESHMAN,
      Batch.YEAR_2,
      Batch.YEAR_3,
      Batch.YEAR_4,
      Batch.YEAR_5,
      Batch.GRADUATE,
    ];
  }
  if (audienceType === "FINAL_YEAR") {
    return [Batch.YEAR_4, Batch.YEAR_5];
  }
  if (audienceType === "BATCHES") {
    return ((study.audienceBatches || []) as Batch[]).filter(Boolean);
  }
  return [];
}

export function getStudyAudienceLabel(study: AcademicStudyLike): string {
  const audienceType: AudienceType = (study.audienceType as AudienceType) || "ALL";
  if (audienceType === "ALL") {
    return "All members";
  }
  if (audienceType === "FINAL_YEAR") {
    return "Final-year students";
  }
  if (audienceType === "BATCHES") {
    const batches = (study.audienceBatches || []) as string[];
    return batches.length > 0 ? `Batches: ${batches.join(", ")}` : "Specific batches";
  }
  return "All members";
}

/**
 * Evaluates eligible members for a study as of reference evaluation date.
 * Excludes members who registered after asOf or were deactivated on/before asOf.
 */
export function getEligibleMembersForStudy<T extends AcademicMemberLike>(
  study: AcademicStudyLike,
  allMembers: T[],
  asOf: Date,
): T[] {
  const asOfDate = new Date(asOf);
  const audienceType: AudienceType = (study.audienceType as AudienceType) || "ALL";
  const audienceBatches = (study.audienceBatches || []) as Batch[];

  return allMembers.filter((member) => {
    // Registered at or before asOf (never count members who registered after the study/date)
    const registeredAt = new Date(member.createdAt);
    if (registeredAt > asOfDate) {
      return false;
    }

    // Exclude deactivated members
    if (member.deactivatedAt && new Date(member.deactivatedAt) <= asOfDate) {
      return false;
    }
    if ((member as any).isActive === false && (!member.deactivatedAt || new Date(member.deactivatedAt) <= asOfDate)) {
      return false;
    }

    // Audience filtering based on computed batch at asOf
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

    return false;
  });
}

export interface NotParticipatingMember {
  id: string;
  name: string;
  uniqueId: string;
  phoneNumber?: string | null;
  campus: Campus;
  effectiveBatch: Batch;
  department?: string | null;
  hasExcusedOnly: boolean;
  attendingOtherStudy: boolean;
  badges: string[];
  createdAt: Date | string;
}

export interface NotParticipatingResult {
  evaluationDate: Date;
  isOngoing: boolean;
  totalEligible: number;
  totalParticipants: number;
  totalNotParticipating: number;
  audienceLabel: string;
  audienceBatches: Batch[];
  members: NotParticipatingMember[];
}

export function getNotParticipatingMembers<
  T extends AcademicMemberLike & {
    name: string;
    uniqueId: string;
    phoneNumber?: string | null;
    department?: string | null;
  },
>(
  study: AcademicStudyLike & { id: string; endDate?: Date | string | null; isActive?: boolean },
  allMembers: T[],
  studyEvents: AcademicEventLike[],
  studyAttendances: AcademicAttendanceLike[],
  allEvents: AcademicEventLike[] = studyEvents,
  allAttendances: AcademicAttendanceLike[] = studyAttendances,
  ongoingStudyIds: Set<string> | string[] = [],
  asOf: Date = new Date(),
): NotParticipatingResult {
  const evaluationDate = getStudyEvaluationDate(study, studyEvents, asOf);
  const isOngoing = isStudyOngoing(study, asOf);

  // 1. Non-cancelled event IDs of this study
  const nonCancelledEventIds = new Set(
    studyEvents
      .filter((e) => getEffectiveStudyId(e.studyId) === study.id && !e.cancelledAt)
      .map((e) => e.id),
  );

  // 2. Participants: at least one non-removed PRESENT or LATE attendance in held session
  const participantIds = new Set(
    getStudyParticipants(study.id, studyEvents, studyAttendances, evaluationDate),
  );

  // 3. Eligible members as of evaluationDate
  const eligible = getEligibleMembersForStudy(study, allMembers, evaluationDate);

  // 4. Exclude participants (participants never appear)
  const nonParticipants = eligible.filter((m) => !participantIds.has(m.id));

  // 5. Build member records
  const members: NotParticipatingMember[] = nonParticipants.map((m) => {
    const effectiveBatch = computeBatch(m, evaluationDate);

    // Excused only: has non-removed EXCUSED attendance in a non-cancelled session of this study
    const hasExcusedOnly = studyAttendances.some(
      (a) =>
        a.memberId === m.id &&
        !a.removedAt &&
        a.status === "EXCUSED" &&
        nonCancelledEventIds.has(a.eventId),
    );

    // Attended any session of another ongoing study in the last 3 weeks
    const attendingOtherStudy = checkAttendingOtherStudy(
      m.id,
      study.id,
      allEvents,
      allAttendances,
      ongoingStudyIds,
      evaluationDate,
    );

    const badges: string[] = [];
    if (hasExcusedOnly) badges.push("Excused");
    if (attendingOtherStudy) badges.push("Attending Other Study");

    return {
      id: m.id,
      name: m.name,
      uniqueId: m.uniqueId,
      phoneNumber: m.phoneNumber || null,
      campus: m.campus,
      effectiveBatch,
      department: m.department || null,
      hasExcusedOnly,
      attendingOtherStudy,
      badges,
      createdAt: m.createdAt,
    };
  });

  // 6. Sort: members with attendingOtherStudy badge sorted below members without, then alphabetically
  members.sort((a, b) => {
    if (a.attendingOtherStudy !== b.attendingOtherStudy) {
      return a.attendingOtherStudy ? 1 : -1;
    }
    return a.name.localeCompare(b.name);
  });

  return {
    evaluationDate,
    isOngoing,
    totalEligible: eligible.length,
    totalParticipants: participantIds.size,
    totalNotParticipating: members.length,
    audienceLabel: getStudyAudienceLabel(study),
    audienceBatches: getStudyAudienceBatches(study),
    members,
  };
}

export interface NotParticipatingFilterOptions {
  search?: string;
  campus?: Campus | string;
  batch?: Batch | string;
  department?: string;
  hideAttendingOther?: boolean | string;
}

export function filterNotParticipatingMembers(
  members: NotParticipatingMember[],
  filters: NotParticipatingFilterOptions = {},
): NotParticipatingMember[] {
  const { search, campus, batch, department, hideAttendingOther } = filters;
  const isHideAttending =
    hideAttendingOther === true || hideAttendingOther === "true";
  const query = search?.trim().toLowerCase();

  return members.filter((m) => {
    if (isHideAttending && m.attendingOtherStudy) {
      return false;
    }
    if (campus && campus !== "ALL" && m.campus !== campus) {
      return false;
    }
    if (batch && batch !== "ALL" && m.effectiveBatch !== batch) {
      return false;
    }
    if (department && department !== "ALL" && m.department !== department) {
      return false;
    }
    if (query) {
      const matchName = m.name.toLowerCase().includes(query);
      const matchUniqueId = m.uniqueId.toLowerCase().includes(query);
      const matchPhone = m.phoneNumber?.toLowerCase().includes(query);
      const matchDept = m.department?.toLowerCase().includes(query);
      if (!matchName && !matchUniqueId && !matchPhone && !matchDept) {
        return false;
      }
    }
    return true;
  });
}
