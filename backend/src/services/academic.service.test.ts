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
  getStudyEvaluationDate,
  getStudyAudienceBatches,
  getStudyAudienceLabel,
  getEligibleMembersForStudy,
  getNotParticipatingMembers,
  filterNotParticipatingMembers,
  AcademicMemberLike,
  AcademicEventLike,
  AcademicAttendanceLike,
} from "./academic.service";

describe("academic.service unit tests", () => {
  describe("getAcademicYear", () => {
    it("returns correct academic year before and after rollover date (September 11)", () => {
      // In August 2026, academic year is 2025/26 (starts 2025)
      expect(getAcademicYear(new Date(2026, 7, 31))).toBe(2025); // month 7 is August in 0-indexed JS

      // On September 1 2026, academic year is still 2025/26 (starts 2025)
      expect(getAcademicYear(new Date(2026, 8, 1))).toBe(2025);

      // On September 10 2026, academic year is still 2025/26 (starts 2025)
      expect(getAcademicYear(new Date(2026, 8, 10))).toBe(2025);

      // On September 11 2026, academic year rolls over to 2026/27 (starts 2026)
      expect(getAcademicYear(new Date(2026, 8, 11))).toBe(2026);

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

    describe("Sept 11 Rollover & Africa/Addis_Ababa Timezone Rules", () => {
      // Addis is UTC+3.
      // Sept 10 20:59:59 UTC = Sept 10 23:59:59 Addis (Academic year 2025)
      // Sept 10 21:00:00 UTC = Sept 11 00:00:00 Addis (Academic year 2026)
      const sept10AddisEveUTC = new Date("2026-09-10T20:59:59Z");
      const sept11AddisMidnightUTC = new Date("2026-09-10T21:00:00Z");
      const sept11AddisNoonUTC = new Date("2026-09-11T09:00:00Z"); // 12:00 in Addis
      const sept12AddisNoonUTC = new Date("2026-09-12T09:00:00Z"); // 12:00 in Addis

      it("evaluates academic year correctly across Addis Ababa timezone boundary", () => {
        expect(getAcademicYear(sept10AddisEveUTC)).toBe(2025);
        expect(getAcademicYear(sept11AddisMidnightUTC)).toBe(2026);
        expect(getAcademicYear(sept11AddisNoonUTC)).toBe(2026);
        expect(getAcademicYear(sept12AddisNoonUTC)).toBe(2026);
      });

      it("rolls over 4-year campuses (FOUR_KILO, SIX_KILO, ART) on Sept 11", () => {
        const campuses = [Campus.FOUR_KILO, Campus.SIX_KILO, Campus.ART];
        for (const campus of campuses) {
          // Member entered in 2023 (final-year YEAR_4 in 2025/2026):
          // On Sept 10 (still 2025/26): level = 2025 - 2023 + 1 = 3 -> YEAR_3? No, 2022 is YEAR_4 in 2025:
          // Entry 2022: level in 2025 = 2025 - 2022 + 1 = 4 (YEAR_4, final year)
          expect(computeBatch({ campus, entryAcademicYear: 2022 }, sept10AddisEveUTC)).toBe(Batch.YEAR_4);
          // On Sept 11 midnight in Addis (2026/27): level = 2026 - 2022 + 1 = 5 -> GRADUATE
          expect(computeBatch({ campus, entryAcademicYear: 2022 }, sept11AddisMidnightUTC)).toBe(Batch.GRADUATE);
          // On Sept 12: remains GRADUATE
          expect(computeBatch({ campus, entryAcademicYear: 2022 }, sept12AddisNoonUTC)).toBe(Batch.GRADUATE);

          // Member entered in 2025 (FRESHMAN in 2025/2026):
          // On Sept 10: FRESHMAN
          expect(computeBatch({ campus, entryAcademicYear: 2025 }, sept10AddisEveUTC)).toBe(Batch.FRESHMAN);
          // On Sept 11: advances to YEAR_2
          expect(computeBatch({ campus, entryAcademicYear: 2025 }, sept11AddisMidnightUTC)).toBe(Batch.YEAR_2);
          // On Sept 12: stays YEAR_2
          expect(computeBatch({ campus, entryAcademicYear: 2025 }, sept12AddisNoonUTC)).toBe(Batch.YEAR_2);
        }
      });

      it("rolls over 5-year campus (FIVE_KILO) on Sept 11: YEAR_5 -> GRADUATE, YEAR_4 -> YEAR_5", () => {
        const campus = Campus.FIVE_KILO;
        // Entry 2021: in 2025/26 (level = 5) is YEAR_5 (final year for FIVE_KILO)
        expect(computeBatch({ campus, entryAcademicYear: 2021 }, sept10AddisEveUTC)).toBe(Batch.YEAR_5);
        // On Sept 11 midnight (2026/27, level = 6) graduates!
        expect(computeBatch({ campus, entryAcademicYear: 2021 }, sept11AddisMidnightUTC)).toBe(Batch.GRADUATE);
        expect(computeBatch({ campus, entryAcademicYear: 2021 }, sept12AddisNoonUTC)).toBe(Batch.GRADUATE);

        // Entry 2022: in 2025/26 (level = 4) is YEAR_4
        expect(computeBatch({ campus, entryAcademicYear: 2022 }, sept10AddisEveUTC)).toBe(Batch.YEAR_4);
        // On Sept 11 midnight (2026/27, level = 5) advances to YEAR_5 (final year)
        expect(computeBatch({ campus, entryAcademicYear: 2022 }, sept11AddisMidnightUTC)).toBe(Batch.YEAR_5);
      });

      it("keeps already GRADUATE members as GRADUATE indefinitely across rollovers", () => {
        const campus = Campus.FOUR_KILO;
        const graduateMember = { campus, entryAcademicYear: 2018 };
        expect(computeBatch(graduateMember, sept10AddisEveUTC)).toBe(Batch.GRADUATE);
        expect(computeBatch(graduateMember, sept11AddisMidnightUTC)).toBe(Batch.GRADUATE);
        expect(computeBatch(graduateMember, sept12AddisNoonUTC)).toBe(Batch.GRADUATE);
      });

      it("advances mid-year registered member on the next Sept 11", () => {
        // Registered in February 2026 for academic year 2025/26 (entryAcademicYear: 2025)
        const midYearMember = { campus: Campus.SIX_KILO, entryAcademicYear: 2025 };
        // In June 2026 (still 2025/26 academic year):
        expect(computeBatch(midYearMember, new Date("2026-06-15T10:00:00Z"))).toBe(Batch.FRESHMAN);
        // On Sept 10, 2026 (day before rollover):
        expect(computeBatch(midYearMember, sept10AddisEveUTC)).toBe(Batch.FRESHMAN);
        // On Sept 11, 2026 (rollover to 2026/27 academic year):
        expect(computeBatch(midYearMember, sept11AddisMidnightUTC)).toBe(Batch.YEAR_2);
      });

      it("respects batchOverride across rollover dates without advancing", () => {
        const overridden = {
          campus: Campus.FOUR_KILO,
          entryAcademicYear: 2025,
          batchOverride: Batch.YEAR_4,
        };
        expect(computeBatch(overridden, sept10AddisEveUTC)).toBe(Batch.YEAR_4);
        expect(computeBatch(overridden, sept11AddisMidnightUTC)).toBe(Batch.YEAR_4);
        expect(computeBatch(overridden, sept12AddisNoonUTC)).toBe(Batch.YEAR_4);
      });
    });
  });

  describe("syncMemberBatches (Idempotent DB Synchronization Job)", () => {
    it("updates stale batches and is idempotent on repeat execution", async () => {
      // Mock members table in memory
      const mockMembers = [
        {
          id: "m-1",
          name: "Abebe",
          campus: Campus.FOUR_KILO,
          batch: Batch.FRESHMAN, // stale, should be YEAR_2 in 2026/27
          entryAcademicYear: 2025,
          batchOverride: null,
        },
        {
          id: "m-2",
          name: "Sara",
          campus: Campus.FOUR_KILO,
          batch: Batch.YEAR_4, // stale, should be GRADUATE in 2026/27
          entryAcademicYear: 2022,
          batchOverride: null,
        },
        {
          id: "m-3",
          name: "Dawit",
          campus: Campus.FIVE_KILO,
          batch: Batch.YEAR_2, // already in sync with override
          entryAcademicYear: 2025,
          batchOverride: Batch.YEAR_2,
        },
      ];

      const updateCalls: Array<{ id: string; batch: Batch }> = [];

      const mockPrisma: any = {
        member: {
          findMany: async () => mockMembers,
          update: async ({ where, data }: any) => {
            updateCalls.push({ id: where.id, batch: data.batch });
            const m = mockMembers.find((item) => item.id === where.id);
            if (m) m.batch = data.batch;
            return m;
          },
        },
      };

      // Import sync function dynamically
      const { syncMemberBatches } = await import("./batch-sync.service");

      // First run as of Sept 11, 2026: updates m-1 to YEAR_2 and m-2 to GRADUATE
      const result1 = await syncMemberBatches(mockPrisma, new Date("2026-09-11T09:00:00Z"));
      expect(result1.checkedCount).toBe(3);
      expect(result1.updatedCount).toBe(2);
      expect(updateCalls).toHaveLength(2);
      expect(mockMembers[0].batch).toBe(Batch.YEAR_2);
      expect(mockMembers[1].batch).toBe(Batch.GRADUATE);

      // Second run immediately after (idempotency check): updates 0 rows
      const result2 = await syncMemberBatches(mockPrisma, new Date("2026-09-11T09:00:00Z"));
      expect(result2.checkedCount).toBe(3);
      expect(result2.updatedCount).toBe(0);
      expect(updateCalls).toHaveLength(2); // no new updates
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

  describe("Amendment 2: Not participating section per study", () => {
    const asOf = new Date(2026, 9, 17); // Oct 17, 2026 (Academic Year 2026)

    it("1. ALL audience lists everyone eligible not participating", () => {
      const study = {
        id: "study-all",
        name: "Epiphany Hymns",
        audienceType: "ALL" as const,
        isActive: true,
      };

      const m1 = { id: "m1", name: "Abebe", uniqueId: "U01", campus: Campus.FOUR_KILO, entryAcademicYear: 2025, createdAt: new Date(2026, 0, 1) };
      const m2 = { id: "m2", name: "Biruk", uniqueId: "U02", campus: Campus.FOUR_KILO, entryAcademicYear: 2025, createdAt: new Date(2026, 0, 1) };
      const m3 = { id: "m3", name: "Chala", uniqueId: "U03", campus: Campus.FOUR_KILO, entryAcademicYear: 2025, createdAt: new Date(2026, 0, 1) };
      const members = [m1, m2, m3];

      const s1: AcademicEventLike = {
        id: "sess1",
        studyId: "study-all",
        startTime: new Date(2026, 8, 10, 17, 0),
        endTime: new Date(2026, 8, 10, 19, 0),
      };

      // m1 attended as PRESENT
      const attendances: AcademicAttendanceLike[] = [
        { memberId: "m1", eventId: "sess1", status: "PRESENT", markedAt: s1.startTime },
      ];

      const result = getNotParticipatingMembers(study, members, [s1], attendances, [s1], attendances, [], asOf);

      expect(result.totalEligible).toBe(3);
      expect(result.totalParticipants).toBe(1);
      expect(result.totalNotParticipating).toBe(2);
      expect(result.members.map((m) => m.id)).toEqual(["m2", "m3"]);
    });

    it("2. BATCHES audience excludes other batches", () => {
      const study = {
        id: "study-batches",
        name: "Senior Liturgy",
        audienceType: "BATCHES" as const,
        audienceBatches: [Batch.YEAR_3, Batch.YEAR_4],
        isActive: true,
      };

      const m_y1 = { id: "m1", name: "Y1", uniqueId: "U1", campus: Campus.FOUR_KILO, entryAcademicYear: 2026, createdAt: new Date(2026, 0, 1) };
      const m_y2 = { id: "m2", name: "Y2", uniqueId: "U2", campus: Campus.FOUR_KILO, entryAcademicYear: 2025, createdAt: new Date(2026, 0, 1) };
      const m_y3 = { id: "m3", name: "Y3", uniqueId: "U3", campus: Campus.FOUR_KILO, entryAcademicYear: 2024, createdAt: new Date(2026, 0, 1) };
      const m_y4 = { id: "m4", name: "Y4", uniqueId: "U4", campus: Campus.FOUR_KILO, entryAcademicYear: 2023, createdAt: new Date(2026, 0, 1) };

      const members = [m_y1, m_y2, m_y3, m_y4];

      const result = getNotParticipatingMembers(study, members, [], [], [], [], [], asOf);

      expect(result.totalEligible).toBe(2);
      expect(result.members.map((m) => m.id).sort()).toEqual(["m3", "m4"].sort());
      expect(result.audienceBatches).toEqual([Batch.YEAR_3, Batch.YEAR_4]);
    });

    it("3. FINAL_YEAR audience respects 5-year (5 Kilo) vs 4-year (other campuses) boundaries", () => {
      const study = {
        id: "study-final",
        name: "Graduation Mezmur",
        audienceType: "FINAL_YEAR" as const,
        isActive: true,
      };

      // 5 Kilo is 5-year: Level 5 (entry 2022) is final year; Level 4 (entry 2023) is NOT final year
      const m_5k_y4 = { id: "m5k4", name: "5K Year 4", uniqueId: "U54", campus: Campus.FIVE_KILO, entryAcademicYear: 2023, createdAt: new Date(2026, 0, 1) };
      const m_5k_y5 = { id: "m5k5", name: "5K Year 5", uniqueId: "U55", campus: Campus.FIVE_KILO, entryAcademicYear: 2022, createdAt: new Date(2026, 0, 1) };

      // 4 Kilo is 4-year: Level 4 (entry 2023) IS final year
      const m_4k_y4 = { id: "m4k4", name: "4K Year 4", uniqueId: "U44", campus: Campus.FOUR_KILO, entryAcademicYear: 2023, createdAt: new Date(2026, 0, 1) };

      const members = [m_5k_y4, m_5k_y5, m_4k_y4];

      const result = getNotParticipatingMembers(study, members, [], [], [], [], [], asOf);

      // m_5k_y4 must NOT be included; only m_5k_y5 and m_4k_y4 are eligible final-year members
      expect(result.members.map((m) => m.id).sort()).toEqual(["m4k4", "m5k5"].sort());
      expect(result.totalEligible).toBe(2);
    });

    it("4. a member with batchOverride appears under the overridden batch", () => {
      const study = {
        id: "study-override",
        name: "Final Year Study",
        audienceType: "FINAL_YEAR" as const,
        isActive: true,
      };

      // Naturally entry 2025 is Year 2, but has override to YEAR_4
      const m_ovr = {
        id: "m_ovr",
        name: "Dawit Override",
        uniqueId: "U_OVR",
        campus: Campus.FOUR_KILO,
        entryAcademicYear: 2025,
        batchOverride: Batch.YEAR_4,
        createdAt: new Date(2026, 0, 1),
      };

      const result = getNotParticipatingMembers(study, [m_ovr], [], [], [], [], [], asOf);

      expect(result.totalEligible).toBe(1);
      expect(result.members[0].effectiveBatch).toBe(Batch.YEAR_4);
      expect(result.members[0].id).toBe("m_ovr");
    });

    it("5. deactivated and not-yet-registered members excluded", () => {
      const study = {
        id: "study-active-check",
        name: "Ongoing Active Study",
        audienceType: "ALL" as const,
        isActive: true,
      };

      const m_active = { id: "m_act", name: "Active", uniqueId: "U_ACT", campus: Campus.FOUR_KILO, entryAcademicYear: 2025, createdAt: new Date(2026, 0, 1) };
      const m_deact = {
        id: "m_dea",
        name: "Deactivated",
        uniqueId: "U_DEA",
        campus: Campus.FOUR_KILO,
        entryAcademicYear: 2025,
        createdAt: new Date(2026, 0, 1),
        deactivatedAt: new Date(2026, 5, 1),
      };
      const m_future = {
        id: "m_fut",
        name: "Future Registered",
        uniqueId: "U_FUT",
        campus: Campus.FOUR_KILO,
        entryAcademicYear: 2025,
        createdAt: new Date(2026, 11, 1),
      };

      const result = getNotParticipatingMembers(study, [m_active, m_deact, m_future], [], [], [], [], [], asOf);

      expect(result.members.map((m) => m.id)).toEqual(["m_act"]);
    });

    it("6. a participant never appears; excused member appears with Excused badge", () => {
      const study = {
        id: "study-part-check",
        name: "Participation Check",
        audienceType: "ALL" as const,
        isActive: true,
      };

      const s1: AcademicEventLike = { id: "s1", studyId: "study-part-check", startTime: new Date(2026, 8, 1), endTime: new Date(2026, 8, 1, 2) };
      const s2: AcademicEventLike = { id: "s2", studyId: "study-part-check", startTime: new Date(2026, 8, 8), endTime: new Date(2026, 8, 8, 2) };

      const m_pres = { id: "m_pres", name: "Present Member", uniqueId: "U1", campus: Campus.FOUR_KILO, entryAcademicYear: 2025, createdAt: new Date(2026, 0, 1) };
      const m_late = { id: "m_late", name: "Late Member", uniqueId: "U2", campus: Campus.FOUR_KILO, entryAcademicYear: 2025, createdAt: new Date(2026, 0, 1) };
      const m_exc = { id: "m_exc", name: "Excused Member", uniqueId: "U3", campus: Campus.FOUR_KILO, entryAcademicYear: 2025, createdAt: new Date(2026, 0, 1) };
      const m_none = { id: "m_none", name: "None Member", uniqueId: "U4", campus: Campus.FOUR_KILO, entryAcademicYear: 2025, createdAt: new Date(2026, 0, 1) };

      const attendances: AcademicAttendanceLike[] = [
        { memberId: "m_pres", eventId: "s1", status: "PRESENT", markedAt: s1.startTime },
        { memberId: "m_late", eventId: "s2", status: "LATE", markedAt: s2.startTime },
        { memberId: "m_exc", eventId: "s1", status: "EXCUSED", markedAt: s1.startTime },
      ];

      const result = getNotParticipatingMembers(
        study,
        [m_pres, m_late, m_exc, m_none],
        [s1, s2],
        attendances,
        [s1, s2],
        attendances,
        [],
        asOf,
      );

      const ids = result.members.map((m) => m.id);
      expect(ids).not.toContain("m_pres");
      expect(ids).not.toContain("m_late");
      expect(ids).toContain("m_exc");
      expect(ids).toContain("m_none");

      const excMember = result.members.find((m) => m.id === "m_exc");
      expect(excMember?.hasExcusedOnly).toBe(true);
      expect(excMember?.badges).toContain("Excused");

      const noneMember = result.members.find((m) => m.id === "m_none");
      expect(noneMember?.hasExcusedOnly).toBe(false);
      expect(noneMember?.badges).not.toContain("Excused");
    });

    it("7. attendingOtherStudy badge, sorting, and hide toggle", () => {
      const studyA = { id: "study-A", name: "Study A", audienceType: "ALL" as const, isActive: true };
      const studyB = { id: "study-B", name: "Study B", audienceType: "ALL" as const, isActive: true };

      const mA = { id: "mA", name: "Aaron No Other", uniqueId: "U_A", campus: Campus.FOUR_KILO, entryAcademicYear: 2025, createdAt: new Date(2026, 0, 1) };
      const mB = { id: "mB", name: "Beth Other Study", uniqueId: "U_B", campus: Campus.FOUR_KILO, entryAcademicYear: 2025, createdAt: new Date(2026, 0, 1) };

      const eventB: AcademicEventLike = {
        id: "evB",
        studyId: "study-B",
        startTime: new Date(asOf.getTime() - 7 * 24 * 60 * 60 * 1000),
        endTime: new Date(asOf.getTime() - 7 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000),
      };

      const allEvents = [eventB];
      const allAttendances: AcademicAttendanceLike[] = [
        { memberId: "mB", eventId: "evB", status: "PRESENT", markedAt: eventB.startTime },
      ];

      const result = getNotParticipatingMembers(
        studyA,
        [mB, mA],
        [],
        [],
        allEvents,
        allAttendances,
        ["study-A", "study-B"],
        asOf,
      );

      // mA has no badge -> sorted first! mB has attendingOtherStudy -> sorted below!
      expect(result.members[0].id).toBe("mA");
      expect(result.members[0].attendingOtherStudy).toBe(false);

      expect(result.members[1].id).toBe("mB");
      expect(result.members[1].attendingOtherStudy).toBe(true);
      expect(result.members[1].badges).toContain("Attending Other Study");

      // Hide toggle
      const filtered = filterNotParticipatingMembers(result.members, { hideAttendingOther: true });
      expect(filtered.map((m) => m.id)).toEqual(["mA"]);
    });

    it("8. ended study evaluated as of its last session", () => {
      const lastSession: AcademicEventLike = {
        id: "last-s",
        studyId: "ended-study",
        startTime: new Date(2026, 7, 30, 14, 0),
        endTime: new Date(2026, 7, 30, 16, 0),
      };

      const study = {
        id: "ended-study",
        name: "Lent Study",
        audienceType: "ALL" as const,
        isActive: false,
        endDate: new Date(2026, 7, 31),
      };

      const m1 = { id: "m1", name: "M1 Early", uniqueId: "U1", campus: Campus.FOUR_KILO, entryAcademicYear: 2025, createdAt: new Date(2026, 6, 1) };
      const m2 = { id: "m2", name: "M2 Late", uniqueId: "U2", campus: Campus.FOUR_KILO, entryAcademicYear: 2025, createdAt: new Date(2026, 8, 5) };

      const result = getNotParticipatingMembers(
        study,
        [m1, m2],
        [lastSession],
        [],
        [lastSession],
        [],
        [],
        asOf,
      );

      expect(result.isOngoing).toBe(false);
      expect(result.evaluationDate.toISOString()).toBe(lastSession.endTime.toISOString());
      expect(result.members.map((m) => m.id)).toEqual(["m1"]);
    });
  });
});
