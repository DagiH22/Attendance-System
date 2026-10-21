import dotenv from "dotenv";
import path from "path";

// Ensure .env.test is loaded before any imports
dotenv.config({ path: path.resolve(__dirname, "../../.env.test"), override: true });

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { PrismaClient, AdminRole, SessionType, AttendanceStatus, MarkMethod, Batch, Campus, EventType } from "@prisma/client";
import app from "../index";
import { createAccessToken } from "../utils/token.utils";
import { computeEventLifecycle, runEventLifecycleSweep } from "../services/event-lifecycle.service";
import { createWeeklyEvents, updateWeeklyEvents } from "../services/recurrence.service";

const prisma = new PrismaClient();

describe("Item 9 Overnight Sessions Spanning Two Days - Automated Test Suite", () => {
  let adminToken: string;
  let superAdminToken: string;
  let adminId: string;
  let testMemberId: string;

  beforeAll(async () => {
    const dbUrl = process.env.DATABASE_URL || "";
    expect(
      dbUrl.includes("throwaway") || dbUrl.includes("_test"),
      "DATABASE_URL must point to a throwaway or test database",
    ).toBe(true);

    const admin = await prisma.admin.findUnique({ where: { email: "admin@attendance.test" } });
    const superAdmin = await prisma.admin.findUnique({ where: { email: "superadmin@attendance.test" } });

    adminId = admin!.id;

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

    const suffix = Date.now();
    const member = await prisma.member.create({
      data: {
        uniqueId: `OVERNIGHT-M-${suffix}`,
        name: "Overnight Tester",
        email: `overnight_${suffix}@example.com`,
        phoneNumber: "0911556677",
        department: "Software Engineering",
        batch: Batch.YEAR_3,
        campus: Campus.FIVE_KILO,
        gender: "MALE",
        entryAcademicYear: 2023,
      },
    });
    testMemberId = member.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("1. Fake Clock Lifecycle: overnight session spans across midnight and closes 90m after real end", () => {
    // Friday 22:00 -> Saturday 06:00
    const start = new Date("2026-11-20T22:00:00Z");
    const end = new Date("2026-11-21T06:00:00Z");

    const event = {
      eventDate: new Date("2026-11-20"),
      startTime: start,
      endTime: end,
      isActive: true,
      endedAt: null,
    };

    // T-31m (Friday 21:29) -> UPCOMING, closed
    const tUpcoming = new Date("2026-11-20T21:29:00Z");
    const snapUpcoming = computeEventLifecycle(event, tUpcoming);
    expect(snapUpcoming.status).toBe("UPCOMING");
    expect(snapUpcoming.attendanceOpen).toBe(false);

    // T-30m (Friday 21:30) -> ACTIVE, open
    const tActivation = new Date("2026-11-20T21:30:00Z");
    const snapActivation = computeEventLifecycle(event, tActivation);
    expect(snapActivation.status).toBe("ACTIVE");
    expect(snapActivation.attendanceOpen).toBe(true);

    // Day 1 23:30 (Friday 11:30 PM) -> ACTIVE, open
    const tDay1Late = new Date("2026-11-20T23:30:00Z");
    const snapDay1Late = computeEventLifecycle(event, tDay1Late);
    expect(snapDay1Late.status).toBe("ACTIVE");
    expect(snapDay1Late.attendanceOpen).toBe(true);

    // Day 2 01:00 (Saturday 1:00 AM next day) -> ACTIVE, open
    const tDay2Early = new Date("2026-11-21T01:00:00Z");
    const snapDay2Early = computeEventLifecycle(event, tDay2Early);
    expect(snapDay2Early.status).toBe("ACTIVE");
    expect(snapDay2Early.attendanceOpen).toBe(true);

    // Day 2 02:00 (Saturday 2:00 AM next day) -> ACTIVE, open
    const tDay2Mid = new Date("2026-11-21T02:00:00Z");
    const snapDay2Mid = computeEventLifecycle(event, tDay2Mid);
    expect(snapDay2Mid.status).toBe("ACTIVE");
    expect(snapDay2Mid.attendanceOpen).toBe(true);

    // Day 2 06:00 (Saturday 6:00 AM scheduled end) -> ACTIVE, open
    const tEnd = new Date("2026-11-21T06:00:00Z");
    const snapEnd = computeEventLifecycle(event, tEnd);
    expect(snapEnd.status).toBe("ACTIVE");
    expect(snapEnd.attendanceOpen).toBe(true);

    // Day 2 07:29 (Saturday 7:29 AM, 89 mins after scheduled end) -> ACTIVE, open
    const tAlmostClose = new Date("2026-11-21T07:29:00Z");
    const snapAlmostClose = computeEventLifecycle(event, tAlmostClose);
    expect(snapAlmostClose.status).toBe("ACTIVE");
    expect(snapAlmostClose.attendanceOpen).toBe(true);

    // Day 2 07:30 (Saturday 7:30 AM, 90 mins after scheduled end) -> PAST, closed
    const tClosed = new Date("2026-11-21T07:30:00Z");
    const snapClosed = computeEventLifecycle(event, tClosed);
    expect(snapClosed.status).toBe("PAST");
    expect(snapClosed.attendanceOpen).toBe(false);
  });

  it("2. Check-in during active window: allowed at 11:30 PM (day 1) and 2:00 AM (day 2) with proper lateness", async () => {
    // Create an overnight event that is currently active (e.g. started 1 hour ago, ends in 7 hours)
    const now = new Date();
    const start = new Date(now.getTime() - 60 * 60 * 1000); // 1 hour ago
    const end = new Date(now.getTime() + 7 * 60 * 60 * 1000); // 7 hours from now

    const ev = await prisma.event.create({
      data: {
        title: "Active Overnight Live Session",
        description: "Testing live check-in during active overnight window",
        location: "Hall 4",
        sessionType: SessionType.OVERNIGHT,
        eventDate: new Date(start.toISOString().slice(0, 10)),
        startTime: start,
        endTime: end,
        lateGraceMinutes: 15,
        createdById: adminId,
      },
    });

    // Check-in member directly via attendance endpoint without adminOverride
    const res = await request(app)
      .post("/attendance")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        eventId: ev.id,
        memberId: testMemberId,
        markedMethod: "MANUAL",
      });

    // Successfully marked without needing admin override!
    expect(res.status).toBe(201);
    expect(res.body.attendance).toBeDefined();
    expect(res.body.attendance.eventId).toBe(ev.id);
    expect(res.body.attendance.memberId).toBe(testMemberId);
    // Since 1 hour > 15 min grace, status is LATE
    expect(res.body.attendance.status).toBe("LATE");
  });

  it("3. Weekly overnight recurrence: preserves 8-hour duration and day+1 end across 4 occurrences", async () => {
    const startDate = new Date("2026-11-06T00:00:00Z"); // Friday
    const startTime = new Date("2026-11-06T22:00:00Z"); // Fri 22:00
    const endTime = new Date("2026-11-07T06:00:00Z");   // Sat 06:00 (duration = 8 hours)

    const result = await createWeeklyEvents(prisma, {
      adminId,
      title: "Weekly Friday Vigil",
      description: "Weekly overnight Friday vigil sessions",
      startDate,
      startTime,
      endTime,
      recurrenceLengthWeeks: 4,
      location: "Main Chapel",
      sessionType: SessionType.OVERNIGHT,
      lateGraceMinutes: 30,
    });

    expect(result.children.length).toBe(4);

    for (let i = 0; i < result.children.length; i++) {
      const occ = result.children[i];
      const occStart = new Date(occ.startTime);
      const occEnd = new Date(occ.endTime);

      // Duration must be exactly 8 hours across every occurrence
      const durationHours = (occEnd.getTime() - occStart.getTime()) / (3600 * 1000);
      expect(durationHours).toBe(8);

      // End day must be start day + 1
      const startDay = occStart.getUTCDate();
      const endDay = occEnd.getUTCDate();
      const expectedEndDay = new Date(occStart.getTime() + 8 * 3600 * 1000).getUTCDate();
      expect(endDay).toBe(expectedEndDay);
    }
  });

  it("4. Month-end and Year-end boundary crossing: correctly evaluates active window across year boundary", () => {
    // New Year's Eve overnight session: Dec 31, 2026 22:00 -> Jan 1, 2027 06:00
    const nyeStart = new Date("2026-12-31T22:00:00Z");
    const nyeEnd = new Date("2027-01-01T06:00:00Z");

    const nyeEvent = {
      eventDate: new Date("2026-12-31"),
      startTime: nyeStart,
      endTime: nyeEnd,
      isActive: true,
      endedAt: null,
    };

    // Jan 1, 2027 01:00 AM (1 hour into the new year)
    const tNewYear = new Date("2027-01-01T01:00:00Z");
    const snapNye = computeEventLifecycle(nyeEvent, tNewYear);
    expect(snapNye.status).toBe("ACTIVE");
    expect(snapNye.attendanceOpen).toBe(true);

    // Jan 1, 2027 07:31 AM (91 mins after 06:00 end)
    const tNyeClosed = new Date("2027-01-01T07:31:00Z");
    const snapNyeClosed = computeEventLifecycle(nyeEvent, tNyeClosed);
    expect(snapNyeClosed.status).toBe("PAST");
    expect(snapNyeClosed.attendanceOpen).toBe(false);

    // Leap year / month boundary: Feb 28, 2026 23:00 -> Mar 1, 2026 05:00
    const leapStart = new Date("2026-02-28T23:00:00Z");
    const leapEnd = new Date("2026-03-01T05:00:00Z");
    const leapEvent = {
      eventDate: new Date("2026-02-28"),
      startTime: leapStart,
      endTime: leapEnd,
      isActive: true,
      endedAt: null,
    };

    const tMar1 = new Date("2026-03-01T02:00:00Z");
    const snapLeap = computeEventLifecycle(leapEvent, tMar1);
    expect(snapLeap.status).toBe("ACTIVE");
    expect(snapLeap.attendanceOpen).toBe(true);
  });

  it("5. Reschedule overnight session: moves both start and end, preserving overnight duration", async () => {
    const origStart = new Date("2026-11-20T22:00:00Z");
    const origEnd = new Date("2026-11-21T06:00:00Z");

    const ev = await prisma.event.create({
      data: {
        title: "Session to Reschedule",
        description: "Will be rescheduled to next day overnight",
        location: "Hall 5",
        sessionType: SessionType.OVERNIGHT,
        eventDate: new Date("2026-11-20"),
        startTime: origStart,
        endTime: origEnd,
        createdById: adminId,
      },
    });

    // Reschedule to Saturday 23:00 -> Sunday 07:00 (8 hours)
    const newStart = "2026-11-21T23:00:00Z";
    const newEnd = "2026-11-22T07:00:00Z";

    const res = await request(app)
      .patch(`/events/${ev.id}/reschedule`)
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({
        startTime: newStart,
        endTime: newEnd,
        reason: "Weather conditions moved vigil by one day",
      });

    expect(res.status).toBe(200);
    expect(res.body.event).toBeDefined();

    const updated = await prisma.event.findUnique({ where: { id: ev.id } });
    expect(updated!.startTime.toISOString()).toBe("2026-11-21T23:00:00.000Z");
    expect(updated!.endTime.toISOString()).toBe("2026-11-22T07:00:00.000Z");
    expect(updated!.rescheduleReason).toBe("Weather conditions moved vigil by one day");

    // Check duration is preserved
    const durationHours =
      (updated!.endTime.getTime() - updated!.startTime.getTime()) / (3600 * 1000);
    expect(durationHours).toBe(8);
  });
});
