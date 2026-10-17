import dotenv from "dotenv";
import path from "path";

// Ensure .env.test is loaded before any imports
dotenv.config({ path: path.resolve(__dirname, "../../.env.test"), override: true });

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { PrismaClient, AdminRole, SessionType, AttendanceStatus } from "@prisma/client";
import app from "../index";
import { createAccessToken } from "../utils/token.utils";

const prisma = new PrismaClient();

describe("Integration Tests against Throwaway Database", () => {
  let adminToken: string;
  let superAdminToken: string;
  let adminId: string;
  let superAdminId: string;
  let testMemberId: string;
  let testMemberUniqueId: string;
  let createdStudyId: string;

  beforeAll(async () => {
    // Safety check
    const dbUrl = process.env.DATABASE_URL || "";
    expect(
      dbUrl.includes("throwaway") || dbUrl.includes("_test"),
      "DATABASE_URL must point to a throwaway or test database",
    ).toBe(true);

    // Fetch seeded admin & superadmin
    const admin = await prisma.admin.findUnique({ where: { email: "admin@attendance.test" } });
    const superAdmin = await prisma.admin.findUnique({ where: { email: "superadmin@attendance.test" } });
    const member = await prisma.member.findFirst({ where: { uniqueId: "4K-FR-001" } });

    expect(admin).toBeDefined();
    expect(superAdmin).toBeDefined();
    expect(member).toBeDefined();

    adminId = admin!.id;
    superAdminId = superAdmin!.id;
    testMemberId = member!.id;
    testMemberUniqueId = member!.uniqueId;

    adminToken = createAccessToken({
      id: admin!.id,
      email: admin!.email,
      role: AdminRole.ADMIN,
    });

    superAdminToken = createAccessToken({
      id: superAdmin!.id,
      email: superAdmin!.email,
      role: AdminRole.SUPER_ADMIN,
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("Role Checks (ADMIN vs SUPER_ADMIN)", () => {
    it("rejects non-SUPER_ADMIN for study creation with 403 Forbidden", async () => {
      const res = await request(app)
        .post("/studies")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: "Unauthorized Study",
          startDate: "2026-11-01T00:00:00Z",
          endDate: "2026-12-01T00:00:00Z",
          audienceType: "ALL",
        });

      expect(res.status).toBe(403);
    });

    it("rejects non-SUPER_ADMIN for promote preview with 403 Forbidden", async () => {
      const res = await request(app)
        .get("/members/promote-preview")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(403);
    });

    it("allows SUPER_ADMIN to access promote preview", async () => {
      const res = await request(app)
        .get("/members/promote-preview")
        .set("Authorization", `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.preview)).toBe(true);
      expect(typeof res.body.summary.totalActive).toBe("number");
    });
  });

  describe("Study Creation and Session Generation in all 3 Modes", () => {
    it("creates a study with SUPER_ADMIN role", async () => {
      const res = await request(app)
        .post("/studies")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          name: "Integration Test Study 2026",
          description: "A test study verifying session modes",
          startDate: "2026-11-01T00:00:00Z",
          endDate: "2026-12-31T00:00:00Z",
          audienceType: "ALL",
          requiredSessions: 3,
          defaultLateGraceMinutes: 15,
        });

      expect(res.status).toBe(201);
      expect(res.body.study).toBeDefined();
      expect(res.body.study.id).toBeDefined();
      createdStudyId = res.body.study.id;
    });

    it("Mode 1 (one-time): adds a single session to the study", async () => {
      const res = await request(app)
        .post(`/studies/${createdStudyId}/sessions`)
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          mode: "one-time",
          title: "One-Time Special Workshop",
          sessionType: "OVERNIGHT",
          startTime: "2026-11-05T20:00:00Z",
          endTime: "2026-11-06T06:00:00Z",
          location: "Overnight Hall",
        });

      expect(res.status).toBe(201);
      expect(Array.isArray(res.body.sessions)).toBe(true);
      expect(res.body.sessions.length).toBe(1);
      expect(res.body.sessions[0].sessionType).toBe(SessionType.OVERNIGHT);
      expect(res.body.sessions[0].plannedStartTime).toBeDefined();
    });

    it("Mode 2 (weekly): generates a weekly series of sessions", async () => {
      const res = await request(app)
        .post(`/studies/${createdStudyId}/sessions`)
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          mode: "weekly",
          title: "Weekly Liturgy Study",
          sessionType: "EVENING",
          startTime: "2026-11-10T17:00:00Z",
          endTime: "2026-11-10T19:00:00Z",
          recurrenceLengthWeeks: 4,
          location: "Choir Room",
        });

      expect(res.status).toBe(201);
      expect(Array.isArray(res.body.sessions)).toBe(true);
      expect(res.body.sessions.length).toBe(4);
      expect(res.body.sessions[0].recurrenceIndex).toBe(1);
      expect(res.body.sessions[1].recurrenceIndex).toBe(2);
    });

    it("Mode 3 (custom): generates sessions from explicit dates/times", async () => {
      const res = await request(app)
        .post(`/studies/${createdStudyId}/sessions`)
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          mode: "custom",
          sessions: [
            {
              title: "Custom Fasting Study 1",
              sessionType: "EVENING",
              startTime: "2026-12-01T17:00:00Z",
              endTime: "2026-12-01T19:00:00Z",
              location: "Room A",
            },
            {
              title: "Custom Fasting Study 2",
              sessionType: "EVENING",
              startTime: "2026-12-03T17:00:00Z",
              endTime: "2026-12-03T19:00:00Z",
              location: "Room B",
            },
          ],
        });

      expect(res.status).toBe(201);
      expect(Array.isArray(res.body.sessions)).toBe(true);
      expect(res.body.sessions.length).toBe(2);
    });
  });

  describe("Reschedule and Cancel Lifecycle and Stats Effect", () => {
    let testEventId: string;

    beforeAll(async () => {
      // Create a test event for rescheduling
      const ev = await prisma.event.create({
        data: {
          title: "Reschedule Test Event",
          description: "Testing reschedule and cancel",
          eventDate: new Date("2026-11-15T00:00:00Z"),
          startTime: new Date("2026-11-15T18:00:00Z"),
          endTime: new Date("2026-11-15T20:00:00Z"),
          plannedStartTime: new Date("2026-11-15T18:00:00Z"),
          location: "Main Hall",
          createdById: superAdminId,
        },
      });
      testEventId = ev.id;
    });

    it("reschedules event, preserving plannedStartTime and updating start/end times", async () => {
      const newStart = "2026-11-16T18:00:00Z";
      const newEnd = "2026-11-16T20:00:00Z";
      const reason = "Venue double booked by university";

      const res = await request(app)
        .patch(`/events/${testEventId}/reschedule`)
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          newStartTime: newStart,
          newEndTime: newEnd,
          reason,
        });

      expect(res.status).toBe(200);
      expect(res.body.event).toBeDefined();
      expect(new Date(res.body.event.startTime).toISOString()).toBe(new Date(newStart).toISOString());
      expect(res.body.event.rescheduleReason).toBe(reason);
      expect(res.body.event.plannedStartTime).toBeDefined();
    });

    it("cancels event, setting cancelledAt and cancelReason", async () => {
      const cancelReason = "Severe weather storm";

      const res = await request(app)
        .patch(`/events/${testEventId}/cancel`)
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ reason: cancelReason });

      expect(res.status).toBe(200);
      expect(res.body.event).toBeDefined();
      expect(res.body.event.cancelReason).toBe(cancelReason);
      expect(res.body.event.cancelledAt).toBeDefined();

      // Verify that event detail reflects CANCELLED status and stats are excluded
      const detailRes = await request(app)
        .get(`/events/${testEventId}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(detailRes.status).toBe(200);
      expect(detailRes.body.event.status).toBe("CANCELLED");
      expect(detailRes.body.stats.isCancelled).toBe(true);
      expect(detailRes.body.stats.attendanceRate).toBeNull();
    });
  });

  describe("Attendance Marking, Lateness, Duplicate 409, Soft-Remove & Re-Mark Revival", () => {
    let activeEventId: string;

    beforeAll(async () => {
      // Create an active event starting 30 minutes ago, grace 15 minutes
      const now = new Date();
      const startTime = new Date(now.getTime() - 30 * 60 * 1000); // started 30 mins ago
      const endTime = new Date(now.getTime() + 60 * 60 * 1000); // ends in 1 hr

      const ev = await prisma.event.create({
        data: {
          title: "Active Attendance Test Session",
          description: "Live session testing check-in",
          eventDate: startTime,
          startTime,
          endTime,
          plannedStartTime: startTime,
          location: "Chapel",
          lateGraceMinutes: 15,
          createdById: adminId,
        },
      });
      activeEventId = ev.id;
    });

    it("marks attendance via QR and detects LATE status when check-in is past grace period", async () => {
      const res = await request(app)
        .post("/attendance")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          eventId: activeEventId,
          code: testMemberUniqueId, // QR payload format is member's uniqueId
        });

      expect(res.status).toBe(201);
      // Started 30 min ago, grace is 15 -> should be LATE
      expect(res.body.attendance.status).toBe(AttendanceStatus.LATE);
      expect(res.body.member.name).toBe("Abebe Bikila");
    });

    it("returns 409 Conflict when attempting duplicate check-in", async () => {
      const res = await request(app)
        .post("/attendance")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          eventId: activeEventId,
          code: testMemberUniqueId,
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toContain("already marked");
    });

    it("soft-removes attendance record (undo)", async () => {
      // Find the attendance record
      const record = await prisma.attendance.findFirst({
        where: { eventId: activeEventId, memberId: testMemberId, removedAt: null },
      });
      expect(record).toBeDefined();

      const res = await request(app)
        .patch(`/attendance/${record!.id}/undo`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ reason: "Accidental check-in of wrong member" });

      expect(res.status).toBe(200);
      expect(res.body.attendance.removedAt).toBeDefined();
      expect(res.body.attendance.removeReason).toBe("Accidental check-in of wrong member");
    });

    it("revives soft-removed attendance on re-mark instead of throwing 409", async () => {
      // Re-mark the same member manually
      const res = await request(app)
        .post("/attendance")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          eventId: activeEventId,
          memberId: testMemberId,
        });

      expect(res.status).toBe(200);
      expect(res.body.attendance.removedAt).toBeNull();
      expect(res.body.attendance.memberId).toBe(testMemberId);
    });

    it("marks member as EXCUSED with excuse reason", async () => {
      // Pick another member for excuse testing
      const y2Member = await prisma.member.findFirst({ where: { uniqueId: "4K-Y2-002" } });
      expect(y2Member).toBeDefined();

      const res = await request(app)
        .post("/attendance/excuse")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          eventId: activeEventId,
          memberId: y2Member!.id,
          reason: "Attending university lab midterm exam",
        });

      expect(res.status).toBe(200);
      expect(res.body.attendance.status).toBe("EXCUSED");
      expect(res.body.attendance.excuseReason).toBe("Attending university lab midterm exam");
    });
  });

  describe("Study Stats and Member x Session Grid", () => {
    it("returns turnout series, average turnout, attended-all and attended-none lists", async () => {
      const res = await request(app)
        .get(`/studies/${createdStudyId}/stats`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.study.id).toBe(createdStudyId);
      expect(Array.isArray(res.body.sessionSeries)).toBe(true);
      expect(Array.isArray(res.body.attendedAllMembers)).toBe(true);
      expect(Array.isArray(res.body.attendedNoneMembers)).toBe(true);
    });

    it("returns member x session grid with completed flag and required sessions", async () => {
      const res = await request(app)
        .get(`/studies/${createdStudyId}/grid`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.sessions)).toBe(true);
      expect(Array.isArray(res.body.rows)).toBe(true);

      const firstRow = res.body.rows[0];
      if (firstRow) {
        expect(firstRow.memberId).toBeDefined();
        expect(firstRow.name).toBeDefined();
        expect(firstRow.attendedCount).toBeDefined();
        expect(typeof firstRow.isCompleted).toBe("boolean");
      }
    });
  });

  describe("Amendment 2: Not Participating Section and Export", () => {
    it("allows ADMIN to view not-participating members", async () => {
      const res = await request(app)
        .get(`/studies/${createdStudyId}/not-participating`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.study).toBeDefined();
      expect(res.body.study.id).toBe(createdStudyId);
      expect(typeof res.body.totalEligible).toBe("number");
      expect(typeof res.body.totalNotParticipating).toBe("number");
      expect(Array.isArray(res.body.members)).toBe(true);
      expect(Array.isArray(res.body.departments)).toBe(true);
      expect(Array.isArray(res.body.audienceBatches)).toBe(true);
    });

    it("filters not-participating members by campus and search", async () => {
      const res = await request(app)
        .get(`/studies/${createdStudyId}/not-participating?campus=KILO_4&search=4K-`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      for (const m of res.body.members) {
        expect(m.campus).toBe("KILO_4");
        expect(m.uniqueId.includes("4K-") || m.name.toLowerCase().includes("4k-")).toBe(true);
      }
    });

    it("allows ADMIN and SUPER_ADMIN to export not-participating to Excel with filters applied", async () => {
      const res = await request(app)
        .get(`/studies/${createdStudyId}/not-participating/export?campus=KILO_4`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("spreadsheetml");
      expect(res.headers["content-disposition"]).toContain("attachment; filename=");
      expect(res.headers["content-disposition"]).toContain(".xlsx");
    });
  });
});
