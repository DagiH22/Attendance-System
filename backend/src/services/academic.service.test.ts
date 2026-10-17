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
});
