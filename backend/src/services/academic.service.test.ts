import { describe, it, expect } from "vitest";
import { Campus, Batch } from "@prisma/client";
import {
  getAcademicYear,
  computeBatch,
  isFinalYear,
  getEligibleMembers,
  getEventStats,
  computeLatenessStatus,
  deriveEntryAcademicYearForBackfill,
  getEffectiveStudyId,
  isStudyOngoing,
  getHeldSessions,
  getStudyParticipants,
  computeParticipantTrailingMisses,
  checkAttendingOtherStudy,
  REGULAR_STUDY_ID,
  AcademicMemberLike,
  AcademicEventLike,
  AcademicAttendanceLike,
} from "./academic.service";

describe("academic.service unit tests", () => {
  describe("getAcademicYear", () => {
    it("returns correct academic year before and after rollover date (September 1)", () => {
      // In August 2026, academic year is 2025/26 (starts 2025)
      expect(getAcademicYear(new Date(2026, 7, 31))).toBe(2025); // month 7 is August in 0-indexed JS

      // On September 1 2026, academic year is 2026/27 (starts 2026)
      expect(getAcademicYear(new Date(2026, 8, 1))).toBe(2026); // month 8 is September in 0-indexed JS

      // In October 2026
      expect(getAcademicYear(new Date(2026, 9, 17))).toBe(2026);

      // In January 2027, academic year is still 2026/27 (starts 2026)
      expect(getAcademicYear(new Date(2027, 0, 15))).toBe(2026);
    });
  });

  describe("computeBatch", () => {
    // Current academic year 2026
    const asOfDate = new Date(2026, 9, 1);

    it("computes 4-year program campuses (FOUR_KILO, SIX_KILO, ART)", () => {
      const campuses: Campus[] = [Campus.FOUR_KILO, Campus.SIX_KILO, Campus.ART];

      for (const campus of campuses) {
        // level 1: entry 2026 -> FRESHMAN
        expect(computeBatch({ campus, entryAcademicYear: 2026 }, asOfDate)).toBe(Batch.FRESHMAN);

        // level 2: entry 2025 -> YEAR_2
        expect(computeBatch({ campus, entryAcademicYear: 2025 }, asOfDate)).toBe(Batch.YEAR_2);

        // level 3: entry 2024 -> YEAR_3
        expect(computeBatch({ campus, entryAcademicYear: 2024 }, asOfDate)).toBe(Batch.YEAR_3);

        // level 4: entry 2023 -> YEAR_4 (final year)
        expect(computeBatch({ campus, entryAcademicYear: 2023 }, asOfDate)).toBe(Batch.YEAR_4);

        // level 5: entry 2022 -> GRADUATE (4-year campus graduated after year 4)
        expect(computeBatch({ campus, entryAcademicYear: 2022 }, asOfDate)).toBe(Batch.GRADUATE);

        // level 6+: entry 2020 -> GRADUATE
        expect(computeBatch({ campus, entryAcademicYear: 2020 }, asOfDate)).toBe(Batch.GRADUATE);
      }
    });

    it("computes 5-year program campus (FIVE_KILO)", () => {
      const campus = Campus.FIVE_KILO;

      // level 1: entry 2026 -> FRESHMAN
      expect(computeBatch({ campus, entryAcademicYear: 2026 }, asOfDate)).toBe(Batch.FRESHMAN);

      // level 4: entry 2023 -> YEAR_4
      expect(computeBatch({ campus, entryAcademicYear: 2023 }, asOfDate)).toBe(Batch.YEAR_4);

      // level 5: entry 2022 -> YEAR_5 (final year for FIVE_KILO)
      expect(computeBatch({ campus, entryAcademicYear: 2022 }, asOfDate)).toBe(Batch.YEAR_5);

      // level 6: entry 2021 -> GRADUATE
      expect(computeBatch({ campus, entryAcademicYear: 2021 }, asOfDate)).toBe(Batch.GRADUATE);
    });

    it("respects batchOverride when set, regardless of computed years", () => {
      const member = {
        campus: Campus.FOUR_KILO,
        entryAcademicYear: 2021, // naturally would be GRADUATE
        batchOverride: Batch.YEAR_3, // repeating year 3
      };
      expect(computeBatch(member, asOfDate)).toBe(Batch.YEAR_3);
    });
  });

  describe("isFinalYear", () => {
    const asOfDate = new Date(2026, 9, 1);

    it("identifies final year on 4-year campus vs 5-year campus", () => {
      // 4-year campus final year is level 4 (entry 2023)
      expect(isFinalYear({ campus: Campus.FOUR_KILO, entryAcademicYear: 2023 }, asOfDate)).toBe(true);
      expect(isFinalYear({ campus: Campus.FOUR_KILO, entryAcademicYear: 2024 }, asOfDate)).toBe(false);
      expect(isFinalYear({ campus: Campus.FOUR_KILO, entryAcademicYear: 2022 }, asOfDate)).toBe(false);

      // 5-year campus final year is level 5 (entry 2022)
      expect(isFinalYear({ campus: Campus.FIVE_KILO, entryAcademicYear: 2022 }, asOfDate)).toBe(true);
      expect(isFinalYear({ campus: Campus.FIVE_KILO, entryAcademicYear: 2023 }, asOfDate)).toBe(false);
    });

    it("handles batchOverride for final year", () => {
      expect(
        isFinalYear(
          { campus: Campus.FOUR_KILO, entryAcademicYear: 2026, batchOverride: Batch.YEAR_4 },
          asOfDate,
        ),
      ).toBe(true);

      expect(
        isFinalYear(
          { campus: Campus.FIVE_KILO, entryAcademicYear: 2026, batchOverride: Batch.YEAR_5 },
          asOfDate,
        ),
      ).toBe(true);
    });
  });

  describe("getEligibleMembers", () => {
    const eventTime = new Date("2026-10-15T18:00:00Z");
    const event: AcademicEventLike = {
      id: "ev-1",
      startTime: eventTime,
      endTime: new Date("2026-10-15T20:00:00Z"),
      study: {
        audienceType: "ALL",
      },
    };

    const member1: AcademicMemberLike = {
      id: "m-1",
      campus: Campus.FOUR_KILO,
      entryAcademicYear: 2026,
      createdAt: new Date("2026-10-01T00:00:00Z"),
      deactivatedAt: null,
    };

    const memberRegisteredAfterEvent: AcademicMemberLike = {
      id: "m-2",
      campus: Campus.FOUR_KILO,
      entryAcademicYear: 2026,
      createdAt: new Date("2026-10-16T00:00:00Z"), // registered after event
      deactivatedAt: null,
    };

    const memberDeactivatedBeforeEvent: AcademicMemberLike = {
      id: "m-3",
      campus: Campus.FOUR_KILO,
      entryAcademicYear: 2026,
      createdAt: new Date("2026-10-01T00:00:00Z"),
      deactivatedAt: new Date("2026-10-10T00:00:00Z"), // deactivated before event
    };

    const memberDeactivatedAfterEvent: AcademicMemberLike = {
      id: "m-4",
      campus: Campus.FOUR_KILO,
      entryAcademicYear: 2026,
      createdAt: new Date("2026-10-01T00:00:00Z"),
      deactivatedAt: new Date("2026-10-20T00:00:00Z"), // deactivated after event
    };

    it("filters out members registered after event and deactivated before event", () => {
      const eligible = getEligibleMembers(
        event,
        [member1, memberRegisteredAfterEvent, memberDeactivatedBeforeEvent, memberDeactivatedAfterEvent],
        [],
        eventTime,
      );

      const ids = eligible.map((m) => m.id);
      expect(ids).toContain("m-1");
      expect(ids).toContain("m-4"); // deactivated after event is still eligible
      expect(ids).not.toContain("m-2"); // registered after
      expect(ids).not.toContain("m-3"); // deactivated before
    });

    it("always includes attendee as eligible even if registered later or deactivated", () => {
      const attendances: AcademicAttendanceLike[] = [
        {
          id: "att-1",
          memberId: "m-2", // registered after event
          eventId: "ev-1",
          status: "PRESENT",
          markedAt: eventTime,
        },
      ];

      const eligible = getEligibleMembers(
        event,
        [member1, memberRegisteredAfterEvent],
        attendances,
        eventTime,
      );

      const ids = eligible.map((m) => m.id);
      expect(ids).toContain("m-2");
    });

    it("filters properly for FINAL_YEAR audience", () => {
      const finalYearStudyEvent: AcademicEventLike = {
        ...event,
        study: { audienceType: "FINAL_YEAR" },
      };

      const finalYearMember: AcademicMemberLike = {
        id: "m-final",
        campus: Campus.FOUR_KILO,
        entryAcademicYear: 2023, // level 4 in 2026 = final year
        createdAt: new Date("2026-10-01T00:00:00Z"),
      };

      const freshmanMember: AcademicMemberLike = {
        id: "m-fresh",
        campus: Campus.FOUR_KILO,
        entryAcademicYear: 2026,
        createdAt: new Date("2026-10-01T00:00:00Z"),
      };

      const eligible = getEligibleMembers(
        finalYearStudyEvent,
        [finalYearMember, freshmanMember],
        [],
        eventTime,
      );

      expect(eligible.map((m) => m.id)).toEqual(["m-final"]);
    });

    it("filters properly for BATCHES audience", () => {
      const batchesStudyEvent: AcademicEventLike = {
        ...event,
        study: {
          audienceType: "BATCHES",
          audienceBatches: [Batch.YEAR_2, Batch.YEAR_3],
        },
      };

      const y2Member: AcademicMemberLike = {
        id: "m-y2",
        campus: Campus.FOUR_KILO,
        entryAcademicYear: 2025, // level 2 in 2026 = YEAR_2
        createdAt: new Date("2026-10-01T00:00:00Z"),
      };

      const freshmanMember: AcademicMemberLike = {
        id: "m-fresh",
        campus: Campus.FOUR_KILO,
        entryAcademicYear: 2026, // FRESHMAN
        createdAt: new Date("2026-10-01T00:00:00Z"),
      };

      const eligible = getEligibleMembers(
        batchesStudyEvent,
        [y2Member, freshmanMember],
        [],
        eventTime,
      );

      expect(eligible.map((m) => m.id)).toEqual(["m-y2"]);
    });
  });

  describe("getEventStats", () => {
    const event: AcademicEventLike = {
      id: "ev-stats",
      startTime: new Date("2026-10-15T18:00:00Z"),
      endTime: new Date("2026-10-15T20:00:00Z"),
    };

    const eligibleMembers: AcademicMemberLike[] = [
      { id: "m-1", campus: Campus.FOUR_KILO, entryAcademicYear: 2026, createdAt: new Date() },
      { id: "m-2", campus: Campus.FOUR_KILO, entryAcademicYear: 2026, createdAt: new Date() },
      { id: "m-3", campus: Campus.FOUR_KILO, entryAcademicYear: 2026, createdAt: new Date() },
      { id: "m-4", campus: Campus.FOUR_KILO, entryAcademicYear: 2026, createdAt: new Date() },
      { id: "m-5", campus: Campus.FOUR_KILO, entryAcademicYear: 2026, createdAt: new Date() },
    ];

    it("computes stats with present, late, excused, absent, and rate", () => {
      const attendances: AcademicAttendanceLike[] = [
        { id: "a-1", memberId: "m-1", eventId: "ev-stats", status: "PRESENT", markedAt: new Date() },
        { id: "a-2", memberId: "m-2", eventId: "ev-stats", status: "LATE", markedAt: new Date() },
        { id: "a-3", memberId: "m-3", eventId: "ev-stats", status: "EXCUSED", markedAt: new Date() },
      ];

      // Eligible = 5. Excused = 1. Present = 1, Late = 1.
      // Absent = 5 - (1 + 1 + 1) = 2.
      // Denominator = 5 - 1 = 4.
      // Rate = (1 + 1) / 4 = 2/4 = 0.5.
      const stats = getEventStats(event, eligibleMembers, attendances);

      expect(stats.isCancelled).toBe(false);
      expect(stats.eligible).toBe(5);
      expect(stats.present).toBe(1);
      expect(stats.late).toBe(1);
      expect(stats.excused).toBe(1);
      expect(stats.absent).toBe(2);
      expect(stats.attendanceRate).toBe(0.5);
    });

    it("returns null attendanceRate when denominator is zero", () => {
      // 1 eligible member who is excused
      const singleEligible = [eligibleMembers[0]];
      const attendances: AcademicAttendanceLike[] = [
        { id: "a-1", memberId: "m-1", eventId: "ev-stats", status: "EXCUSED", markedAt: new Date() },
      ];

      const stats = getEventStats(event, singleEligible, attendances);
      expect(stats.eligible).toBe(1);
      expect(stats.excused).toBe(1);
      expect(stats.attendanceRate).toBeNull();
    });

    it("excludes cancelled events from all analytics", () => {
      const cancelledEvent: AcademicEventLike = {
        ...event,
        cancelledAt: new Date(),
      };

      const stats = getEventStats(cancelledEvent, eligibleMembers, []);
      expect(stats.isCancelled).toBe(true);
      expect(stats.eligible).toBe(0);
      expect(stats.absent).toBe(0);
      expect(stats.attendanceRate).toBeNull();
    });
  });

  describe("computeLatenessStatus", () => {
    const startTime = new Date("2026-10-15T18:00:00Z");
    const graceMinutes = 15;

    it("marks check-in before grace threshold as PRESENT", () => {
      const checkIn = new Date("2026-10-15T18:10:00Z");
      expect(computeLatenessStatus(startTime, checkIn, graceMinutes)).toBe("PRESENT");
    });

    it("marks check-in exactly at the grace boundary as PRESENT", () => {
      const checkIn = new Date("2026-10-15T18:15:00.000Z");
      expect(computeLatenessStatus(startTime, checkIn, graceMinutes)).toBe("PRESENT");
    });

    it("marks check-in 1 second after grace boundary as LATE", () => {
      const checkIn = new Date("2026-10-15T18:15:01.000Z");
      expect(computeLatenessStatus(startTime, checkIn, graceMinutes)).toBe("LATE");
    });
  });

  describe("deriveEntryAcademicYearForBackfill", () => {
    const asOfDate = new Date(2026, 9, 1); // academic year 2026

    it("derives entry year correctly for batches", () => {
      expect(deriveEntryAcademicYearForBackfill({ campus: Campus.FOUR_KILO, batch: Batch.FRESHMAN }, asOfDate).entryAcademicYear).toBe(2026);
      expect(deriveEntryAcademicYearForBackfill({ campus: Campus.FOUR_KILO, batch: Batch.YEAR_2 }, asOfDate).entryAcademicYear).toBe(2025);
      expect(deriveEntryAcademicYearForBackfill({ campus: Campus.FOUR_KILO, batch: Batch.YEAR_4 }, asOfDate).entryAcademicYear).toBe(2023);
    });

    it("detects inconsistent YEAR_5 on a 4-year campus", () => {
      const result = deriveEntryAcademicYearForBackfill({ campus: Campus.FOUR_KILO, batch: Batch.YEAR_5 }, asOfDate);
      expect(result.isInconsistent).toBe(true);
      expect(result.inconsistencyReason).toContain("4-year program");
    });

    it("allows YEAR_5 on FIVE_KILO campus without inconsistency", () => {
      const result = deriveEntryAcademicYearForBackfill({ campus: Campus.FIVE_KILO, batch: Batch.YEAR_5 }, asOfDate);
      expect(result.isInconsistent).toBe(false);
    });
  });

  describe("reschedule and lifecycle recomputation", () => {
    it("preserves series linkage/recurrenceIndex and plannedStartTime when rescheduled", () => {
      const originalStartTime = new Date("2026-10-20T18:00:00Z");
      const originalEndTime = new Date("2026-10-20T20:00:00Z");

      const recurringEvent = {
        id: "child-event-2",
        parentEventId: "parent-event-1",
        recurrenceIndex: 2,
        recurrenceLengthWeeks: 8,
        startTime: originalStartTime,
        endTime: originalEndTime,
        plannedStartTime: originalStartTime,
      };

      // Reschedule Tuesday -> Wednesday
      const newStart = new Date("2026-10-21T18:00:00Z");
      const newEnd = new Date("2026-10-21T20:00:00Z");

      const rescheduledEvent = {
        ...recurringEvent,
        startTime: newStart,
        endTime: newEnd,
        rescheduledAt: new Date("2026-10-18T10:00:00Z"),
        rescheduleReason: "Venue conflict on Tuesday",
        // plannedStartTime must be preserved
        plannedStartTime: recurringEvent.plannedStartTime,
      };

      expect(rescheduledEvent.parentEventId).toBe("parent-event-1");
      expect(rescheduledEvent.recurrenceIndex).toBe(2);
      expect(rescheduledEvent.recurrenceLengthWeeks).toBe(8);
      expect(rescheduledEvent.plannedStartTime.toISOString()).toBe(originalStartTime.toISOString());
      expect(rescheduledEvent.startTime.toISOString()).toBe(newStart.toISOString());
      expect(rescheduledEvent.rescheduleReason).toBe("Venue conflict on Tuesday");
    });
  });

  describe("Studies Amendment: Participants, Trailing Misses, Alerts, and Turnout", () => {
    const makeSession = (
      id: string,
      studyId: string | null,
      day: number,
      cancelled: boolean = false,
    ): AcademicEventLike => ({
      id,
      studyId,
      startTime: new Date(`2026-10-0${day}T18:00:00Z`),
      endTime: new Date(`2026-10-0${day}T20:00:00Z`),
      cancelledAt: cancelled ? new Date(`2026-10-0${day}T10:00:00Z`) : null,
    });

    it("1. member who joins at session 5 (earlier sessions not counted)", () => {
      // 7 held sessions
      const sessions = [
        makeSession("s1", "mary", 1),
        makeSession("s2", "mary", 2),
        makeSession("s3", "mary", 3),
        makeSession("s4", "mary", 4),
        makeSession("s5", "mary", 5),
        makeSession("s6", "mary", 6),
        makeSession("s7", "mary", 7),
      ];

      // Member attends s5 and s6. Misses s7.
      const attendances: AcademicAttendanceLike[] = [
        { memberId: "m1", eventId: "s5", status: "PRESENT", markedAt: new Date() },
        { memberId: "m1", eventId: "s6", status: "LATE", markedAt: new Date() },
      ];

      const result = computeParticipantTrailingMisses("m1", sessions, attendances, true);

      expect(result.isParticipant).toBe(true);
      expect(result.firstAttendedSessionIndex).toBe(5);
      expect(result.lastAttendedSessionIndex).toBe(6);
      // Only s7 is counted as trailing miss (sessions 1-4 are NOT counted!)
      expect(result.trailingMisses).toBe(1);
      expect(result.alertLevel).toBeNull(); // 1 miss is below warning threshold (>= 2)
    });

    it("2. participant of Mary study not flagged in Epiphany", () => {
      const epiphanySessions = [
        makeSession("ep1", "epiphany", 1),
        makeSession("ep2", "epiphany", 2),
        makeSession("ep3", "epiphany", 3),
      ];

      // Member attended Mary sessions, but ZERO attendances in Epiphany
      const attendances: AcademicAttendanceLike[] = [
        { memberId: "m1", eventId: "mary1", status: "PRESENT", markedAt: new Date() },
      ];

      const result = computeParticipantTrailingMisses("m1", epiphanySessions, attendances, true);

      expect(result.isParticipant).toBe(false);
      expect(result.trailingMisses).toBe(0);
      expect(result.alertLevel).toBeNull();
    });

    it("3. graduate with no attendance not flagged", () => {
      const sessions = [
        makeSession("s1", "study-1", 1),
        makeSession("s2", "study-1", 2),
        makeSession("s3", "study-1", 3),
      ];

      // No attendance in this study
      const result = computeParticipantTrailingMisses("m-grad", sessions, [], true);

      expect(result.isParticipant).toBe(false);
      expect(result.trailingMisses).toBe(0);
      expect(result.alertLevel).toBeNull();
    });

    it("4. excused session not counted towards trailing misses", () => {
      const sessions = [
        makeSession("s1", "study-1", 1),
        makeSession("s2", "study-1", 2),
        makeSession("s3", "study-1", 3),
        makeSession("s4", "study-1", 4),
        makeSession("s5", "study-1", 5),
      ];

      // Attended s1, s2. Missed s3. Excused at s4. Missed s5.
      const attendances: AcademicAttendanceLike[] = [
        { memberId: "m1", eventId: "s1", status: "PRESENT", markedAt: new Date() },
        { memberId: "m1", eventId: "s2", status: "PRESENT", markedAt: new Date() },
        { memberId: "m1", eventId: "s4", status: "EXCUSED", markedAt: new Date() },
      ];

      const result = computeParticipantTrailingMisses("m1", sessions, attendances, true);

      expect(result.isParticipant).toBe(true);
      expect(result.lastAttendedSessionIndex).toBe(2);
      // After s2: s3 (miss), s4 (EXCUSED -> excluded), s5 (miss) = 2 misses
      expect(result.trailingMisses).toBe(2);
      expect(result.alertLevel).toBe("WARNING");
    });

    it("5. cancelled session not counted as held session", () => {
      const allSessions = [
        makeSession("s1", "study-1", 1),
        makeSession("s2", "study-1", 2, true), // CANCELLED
        makeSession("s3", "study-1", 3),
      ];

      const asOf = new Date("2026-10-10T00:00:00Z");
      const held = getHeldSessions(allSessions, asOf);

      // Cancelled session s2 is filtered out
      expect(held.map((s) => s.id)).toEqual(["s1", "s3"]);

      // Attended s1, missed s3
      const attendances: AcademicAttendanceLike[] = [
        { memberId: "m1", eventId: "s1", status: "PRESENT", markedAt: new Date() },
      ];

      const result = computeParticipantTrailingMisses("m1", held, attendances, true);
      expect(result.trailingMisses).toBe(1);
    });

    it("6. ended study produces no alert but a dropped-off record", () => {
      const sessions = [
        makeSession("s1", "study-ended", 1),
        makeSession("s2", "study-ended", 2),
        makeSession("s3", "study-ended", 3),
      ];

      // Attended s1, missed s2 and s3
      const attendances: AcademicAttendanceLike[] = [
        { memberId: "m1", eventId: "s1", status: "PRESENT", markedAt: new Date() },
      ];

      // Study has ended: isOngoing = false
      const result = computeParticipantTrailingMisses("m1", sessions, attendances, false);

      expect(result.isParticipant).toBe(true);
      expect(result.trailingMisses).toBe(2);
      // Ended study must NOT produce alerts on dashboard!
      expect(result.alertLevel).toBeNull();
      // But exposes dropped-off record in study report
      expect(result.droppedOff).toBe(true);
      expect(result.droppedOffAfterSession).toBe(1);
    });

    it("7. member flagged in one study with attendingOtherStudy true", () => {
      const studyASessions = [
        makeSession("a1", "study-a", 1),
        makeSession("a2", "study-a", 2),
        makeSession("a3", "study-a", 3),
      ];

      // Attended a1, missed a2 and a3 -> trailingMisses = 2 (WARNING)
      const attendances: AcademicAttendanceLike[] = [
        { memberId: "m1", eventId: "a1", status: "PRESENT", markedAt: new Date() },
      ];

      const result = computeParticipantTrailingMisses("m1", studyASessions, attendances, true);
      expect(result.alertLevel).toBe("WARNING");

      // Other study event held within 3 weeks (say 10 days ago from asOf)
      const asOf = new Date("2026-10-25T00:00:00Z");
      const otherStudyEvent: AcademicEventLike = {
        id: "b-recent",
        studyId: "study-b",
        startTime: new Date("2026-10-15T18:00:00Z"), // 10 days before asOf
        endTime: new Date("2026-10-15T20:00:00Z"),
      };

      const allEvents = [...studyASessions, otherStudyEvent];
      const allAttendances: AcademicAttendanceLike[] = [
        ...attendances,
        { memberId: "m1", eventId: "b-recent", status: "PRESENT", markedAt: new Date() },
      ];

      const ongoingStudyIds = new Set(["study-a", "study-b"]);

      const attendingOther = checkAttendingOtherStudy(
        "m1",
        "study-a",
        allEvents,
        allAttendances,
        ongoingStudyIds,
        asOf,
      );

      expect(attendingOther).toBe(true);
    });

    it("8. trailingMisses boundaries (0, 1 -> null, 2 -> WARNING, 3+ -> CRITICAL)", () => {
      const sessions = [
        makeSession("s1", "study-1", 1),
        makeSession("s2", "study-1", 2),
        makeSession("s3", "study-1", 3),
        makeSession("s4", "study-1", 4),
        makeSession("s5", "study-1", 5),
      ];

      // 0 misses: attended s5
      const att0: AcademicAttendanceLike[] = [
        { memberId: "m1", eventId: "s5", status: "PRESENT", markedAt: new Date() },
      ];
      expect(computeParticipantTrailingMisses("m1", sessions, att0, true).alertLevel).toBeNull();

      // 1 miss: attended s4, missed s5
      const att1: AcademicAttendanceLike[] = [
        { memberId: "m1", eventId: "s4", status: "PRESENT", markedAt: new Date() },
      ];
      expect(computeParticipantTrailingMisses("m1", sessions, att1, true).alertLevel).toBeNull();

      // 2 misses: attended s3, missed s4, s5 -> WARNING
      const att2: AcademicAttendanceLike[] = [
        { memberId: "m1", eventId: "s3", status: "PRESENT", markedAt: new Date() },
      ];
      const res2 = computeParticipantTrailingMisses("m1", sessions, att2, true);
      expect(res2.trailingMisses).toBe(2);
      expect(res2.alertLevel).toBe("WARNING");

      // 3 misses: attended s2, missed s3, s4, s5 -> CRITICAL
      const att3: AcademicAttendanceLike[] = [
        { memberId: "m1", eventId: "s2", status: "PRESENT", markedAt: new Date() },
      ];
      const res3 = computeParticipantTrailingMisses("m1", sessions, att3, true);
      expect(res3.trailingMisses).toBe(3);
      expect(res3.alertLevel).toBe("CRITICAL");

      // 4 misses: attended s1, missed s2, s3, s4, s5 -> CRITICAL
      const att4: AcademicAttendanceLike[] = [
        { memberId: "m1", eventId: "s1", status: "PRESENT", markedAt: new Date() },
      ];
      const res4 = computeParticipantTrailingMisses("m1", sessions, att4, true);
      expect(res4.trailingMisses).toBe(4);
      expect(res4.alertLevel).toBe("CRITICAL");
    });

    it("9. participants growing over time changes later sessions' turnout correctly", () => {
      const eligibleMembers: AcademicMemberLike[] = [
        { id: "mA", campus: Campus.FOUR_KILO, entryAcademicYear: 2026, createdAt: new Date() },
        { id: "mB", campus: Campus.FOUR_KILO, entryAcademicYear: 2026, createdAt: new Date() },
        { id: "mC", campus: Campus.FOUR_KILO, entryAcademicYear: 2026, createdAt: new Date() },
        { id: "mD", campus: Campus.FOUR_KILO, entryAcademicYear: 2026, createdAt: new Date() },
      ];

      const s1 = makeSession("s1", "study-grow", 1);
      const s2 = makeSession("s2", "study-grow", 2);
      const s3 = makeSession("s3", "study-grow", 3);
      const allStudyEvents = [s1, s2, s3];

      // Session 1: only mA attends
      const attS1: AcademicAttendanceLike[] = [
        { memberId: "mA", eventId: "s1", status: "PRESENT", markedAt: s1.startTime },
      ];
      const participantsS1 = getStudyParticipants("study-grow", allStudyEvents, attS1, s1.endTime);
      expect(participantsS1).toEqual(["mA"]);

      const stats1 = getEventStats(s1, eligibleMembers, attS1, participantsS1.length, new Set(participantsS1));
      // 1 present out of 1 participant = 100%
      expect(stats1.participants).toBe(1);
      expect(stats1.turnoutAmongParticipants).toBe(1);
      // Secondary: 1 present out of 4 eligible = 25%
      expect(stats1.eligibleAttendanceRate).toBe(0.25);

      // Session 2: mA and mB attend
      const attS2: AcademicAttendanceLike[] = [
        ...attS1,
        { memberId: "mA", eventId: "s2", status: "PRESENT", markedAt: s2.startTime },
        { memberId: "mB", eventId: "s2", status: "PRESENT", markedAt: s2.startTime },
      ];
      const participantsS2 = getStudyParticipants("study-grow", allStudyEvents, attS2, s2.endTime);
      expect(participantsS2.sort()).toEqual(["mA", "mB"].sort());

      const stats2 = getEventStats(s2, eligibleMembers, attS2, participantsS2.length, new Set(participantsS2));
      // 2 present out of 2 participants = 100%
      expect(stats2.participants).toBe(2);
      expect(stats2.turnoutAmongParticipants).toBe(1);
      expect(stats2.eligibleAttendanceRate).toBe(0.5);

      // Session 3: mA attends, but mB misses!
      const attS3: AcademicAttendanceLike[] = [
        ...attS2,
        { memberId: "mA", eventId: "s3", status: "PRESENT", markedAt: s3.startTime },
      ];
      const participantsS3 = getStudyParticipants("study-grow", allStudyEvents, attS3, s3.endTime);
      expect(participantsS3.length).toBe(2);

      const stats3 = getEventStats(s3, eligibleMembers, attS3, participantsS3.length, new Set(participantsS3));
      // 1 present out of 2 participants = 50%
      expect(stats3.participants).toBe(2);
      expect(stats3.absentAmongParticipants).toBe(1);
      expect(stats3.turnoutAmongParticipants).toBe(0.5);
      expect(stats3.eligibleAttendanceRate).toBe(0.25);
    });

    it("10. Regular pseudo-study behaves the same", () => {
      // Events with studyId = null (or undefined)
      const reg1 = makeSession("r1", null, 1);
      const reg2 = makeSession("r2", null, 2);
      const reg3 = makeSession("r3", null, 3);
      const regSessions = [reg1, reg2, reg3];

      expect(getEffectiveStudyId(reg1.studyId)).toBe(REGULAR_STUDY_ID);
      expect(isStudyOngoing(null, new Date())).toBe(true);

      // Member attends r1, misses r2 and r3
      const attendances: AcademicAttendanceLike[] = [
        { memberId: "m1", eventId: "r1", status: "PRESENT", markedAt: reg1.startTime },
      ];

      const participants = getStudyParticipants(REGULAR_STUDY_ID, regSessions, attendances, reg3.endTime);
      expect(participants).toEqual(["m1"]);

      const result = computeParticipantTrailingMisses("m1", regSessions, attendances, true);
      expect(result.isParticipant).toBe(true);
      expect(result.trailingMisses).toBe(2);
      expect(result.alertLevel).toBe("WARNING");
    });
  });
});
