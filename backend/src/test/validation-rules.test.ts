import dotenv from "dotenv";
import path from "path";

// Ensure .env.test is loaded before any imports
dotenv.config({ path: path.resolve(__dirname, "../../.env.test"), override: true });

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { PrismaClient, AdminRole, SessionType, AttendanceStatus, Batch, Campus } from "@prisma/client";
import app from "../index";
import { createAccessToken } from "../utils/token.utils";

const prisma = new PrismaClient();

describe("Item 7 Validation Rules - Comprehensive Automated Test Suite", () => {
  let adminToken: string;
  let superAdminToken: string;
  let adminId: string;
  let superAdminId: string;
  let activeMemberId: string;
  let deactivatedMemberId: string;

  beforeAll(async () => {
    // Safety check
    const dbUrl = process.env.DATABASE_URL || "";
    expect(
      dbUrl.includes("throwaway") || dbUrl.includes("_test"),
      "DATABASE_URL must point to a throwaway or test database",
    ).toBe(true);

    const admin = await prisma.admin.findUnique({ where: { email: "admin@attendance.test" } });
    const superAdmin = await prisma.admin.findUnique({ where: { email: "superadmin@attendance.test" } });

    adminId = admin!.id;
    superAdminId = superAdmin!.id;

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

    // Create an active member and an inactive member for attendance tests
    const activeMember = await prisma.member.create({
      data: {
        uniqueId: `VAL-TEST-ACT-${Date.now()}`,
        name: "Active Test Member",
        email: `active_${Date.now()}@example.com`,
        phoneNumber: `09${Math.floor(10000000 + Math.random() * 90000000)}`,
        department: "Computer Science",
        batch: Batch.YEAR_2,
        campus: Campus.FOUR_KILO,
        gender: "MALE",
        entryAcademicYear: 2024,
        isActive: true,
      },
    });
    activeMemberId = activeMember.id;

    const deactivatedMember = await prisma.member.create({
      data: {
        uniqueId: `VAL-TEST-DEACT-${Date.now()}`,
        name: "Deactivated Test Member",
        email: `deact_${Date.now()}@example.com`,
        phoneNumber: `09${Math.floor(10000000 + Math.random() * 90000000)}`,
        department: "Computer Science",
        batch: Batch.YEAR_2,
        campus: Campus.FOUR_KILO,
        gender: "FEMALE",
        entryAcademicYear: 2024,
        isActive: false,
      },
    });
    deactivatedMemberId = deactivatedMember.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ==========================================
  // 1. SESSION VALIDATION RULES
  // ==========================================
  describe("1. Session Validations", () => {
    it("rejects session without a title (400)", async () => {
      const res = await request(app)
        .post("/events")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          title: "   ",
          description: "No title",
          eventDate: "2026-11-01",
          startTime: "2026-11-01T10:00:00Z",
          endTime: "2026-11-01T12:00:00Z",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/title is required/i);
    });

    it("rejects session without a startTime (400)", async () => {
      const res = await request(app)
        .post("/events")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          title: "Missing Start",
          description: "Valid description",
          eventDate: "2026-11-01",
          endTime: "2026-11-01T12:00:00Z",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/start time is required/i);
    });

    it("rejects session when end time is before or equal to start time (400)", async () => {
      const res = await request(app)
        .post("/events")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          title: "Inverted Time Session",
          description: "End before start",
          eventDate: "2026-11-01",
          startTime: "2026-11-01T12:00:00Z",
          endTime: "2026-11-01T10:00:00Z",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/end time must be after start time/i);
    });

    it("rejects session duration exceeding 24 hours (400)", async () => {
      const res = await request(app)
        .post("/events")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          title: "Too Long Session",
          description: "Duration 25 hours",
          eventDate: "2026-11-01",
          startTime: "2026-11-01T10:00:00Z",
          endTime: "2026-11-02T11:00:00Z",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/duration cannot exceed 24 hours/i);
    });

    it("rejects negative lateness grace period (400)", async () => {
      const res = await request(app)
        .post("/events")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          title: "Negative Grace Session",
          description: "Grace -10",
          eventDate: "2026-11-01",
          startTime: "2026-11-01T10:00:00Z",
          endTime: "2026-11-01T12:00:00Z",
          lateGraceMinutes: -10,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/grace period cannot be negative/i);
    });

    it("rejects lateness grace period greater than or equal to session duration (400)", async () => {
      const res = await request(app)
        .post("/events")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          title: "Excessive Grace Session",
          description: "Duration 60m, grace 60m",
          eventDate: "2026-11-01",
          startTime: "2026-11-01T10:00:00Z",
          endTime: "2026-11-01T11:00:00Z", // 60 minutes
          lateGraceMinutes: 60,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/shorter than the session duration/i);
    });

    it("accepts valid boundary session inputs: duration 24h and grace = duration - 1m (201)", async () => {
      const res = await request(app)
        .post("/events")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          title: "Valid 24h Boundary Session",
          description: "Exactly 24 hours with boundary grace",
          eventDate: "2026-11-01",
          startTime: "2026-11-01T10:00:00Z",
          endTime: "2026-11-02T10:00:00Z", // Exactly 24 hours
          lateGraceMinutes: 1439, // 24*60 - 1 = 1439 minutes
        });

      expect(res.status).toBe(201);
      expect(res.body.event).toBeDefined();
      expect(res.body.event.title).toBe("Valid 24h Boundary Session");
    });

    it("reschedule: rejects newEnd <= newStart and duration > 24h (400)", async () => {
      // First create a session to reschedule
      const createRes = await request(app)
        .post("/events")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          title: "Session To Reschedule",
          description: "Testing reschedule validation",
          eventDate: "2026-11-05",
          startTime: "2026-11-05T10:00:00Z",
          endTime: "2026-11-05T12:00:00Z",
          lateGraceMinutes: 30,
        });
      expect(createRes.status).toBe(201);
      const eventId = createRes.body.event.id;

      // Inverted
      const invRes = await request(app)
        .patch(`/events/${eventId}/reschedule`)
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          startTime: "2026-11-06T12:00:00Z",
          endTime: "2026-11-06T10:00:00Z",
        });
      expect(invRes.status).toBe(400);
      expect(invRes.body.error).toMatch(/endTime must be after startTime/i);

      // Duration > 24h
      const longRes = await request(app)
        .patch(`/events/${eventId}/reschedule`)
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          startTime: "2026-11-06T10:00:00Z",
          endTime: "2026-11-07T11:00:00Z",
        });
      expect(longRes.status).toBe(400);
      expect(longRes.body.error).toMatch(/duration cannot exceed 24 hours/i);

      // Grace >= new duration (grace is 30m, new duration 20m)
      const graceRes = await request(app)
        .patch(`/events/${eventId}/reschedule`)
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          startTime: "2026-11-06T10:00:00Z",
          endTime: "2026-11-06T10:20:00Z",
        });
      expect(graceRes.status).toBe(400);
      expect(graceRes.body.error).toMatch(/shorter than the session duration/i);

      // Valid boundary reschedule
      const validRes = await request(app)
        .patch(`/events/${eventId}/reschedule`)
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          startTime: "2026-11-06T14:00:00Z",
          endTime: "2026-11-06T16:00:00Z",
          reason: "Valid room change",
        });
      expect(validRes.status).toBe(200);
      expect(validRes.body.event.startTime).toBe(new Date("2026-11-06T14:00:00Z").toISOString());
    });
  });

  // ==========================================
  // 2. RECURRENCE & CUSTOM MODE RULES
  // ==========================================
  describe("2. Recurrence (Weekly) & Custom Mode Validations", () => {
    it("weekly: rejects endDate before startDate (400)", async () => {
      const res = await request(app)
        .post("/events")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          title: "Weekly Series",
          description: "End before start",
          type: "WEEKLY",
          eventDate: "2026-11-10",
          startTime: "2026-11-10T10:00:00Z",
          endTime: "2026-11-10T12:00:00Z",
          endDate: "2026-11-05", // before start date!
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/end date cannot be before start date/i);
    });

    it("weekly: rejects recurrenceLengthWeeks < 1 and > 52 (400)", async () => {
      const zeroRes = await request(app)
        .post("/events")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          title: "Weekly Series Zero",
          description: "Count 0",
          type: "WEEKLY",
          eventDate: "2026-11-10",
          startTime: "2026-11-10T10:00:00Z",
          endTime: "2026-11-10T12:00:00Z",
          recurrenceLengthWeeks: 0,
        });
      expect(zeroRes.status).toBe(400);
      expect(zeroRes.body.error).toMatch(/at least 1/i);

      const highRes = await request(app)
        .post("/events")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          title: "Weekly Series Too High",
          description: "Count 53",
          type: "WEEKLY",
          eventDate: "2026-11-10",
          startTime: "2026-11-10T10:00:00Z",
          endTime: "2026-11-10T12:00:00Z",
          recurrenceLengthWeeks: 53,
        });
      expect(highRes.status).toBe(400);
      expect(highRes.body.error).toMatch(/cannot exceed 52 weeks/i);
    });

    it("weekly: accepts valid boundary occurrence count 1 (201)", async () => {
      const res = await request(app)
        .post("/events")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          title: "Weekly Boundary Count 1",
          description: "Count 1",
          type: "WEEKLY",
          eventDate: "2026-11-10",
          startTime: "2026-11-10T10:00:00Z",
          endTime: "2026-11-10T12:00:00Z",
          recurrenceLengthWeeks: 1,
        });

      expect(res.status).toBe(201);
      expect(res.body.parent).toBeDefined();
    });

    it("custom mode: rejects duplicate date/time pairs (400)", async () => {
      const res = await request(app)
        .post("/events")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          title: "Custom Duplicate Series",
          description: "Has duplicate start times",
          clusterEvents: [
            {
              eventDate: "2026-11-10",
              startTime: "2026-11-10T10:00:00Z",
              endTime: "2026-11-10T12:00:00Z",
            },
            {
              eventDate: "2026-11-10",
              startTime: "2026-11-10T10:00:00Z", // DUPLICATE start
              endTime: "2026-11-10T13:00:00Z",
            },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/duplicate date\/time pairs are not allowed/i);
    });
  });

  // ==========================================
  // 3. STUDY VALIDATION RULES
  // ==========================================
  describe("3. Study Validations & Warnings", () => {
    it("study: rejects missing name (400)", async () => {
      const res = await request(app)
        .post("/studies")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          name: "   ",
          startDate: "2026-11-01",
          endDate: "2026-11-30",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/study name is required/i);
    });

    it("study: rejects endDate before startDate (400)", async () => {
      const res = await request(app)
        .post("/studies")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          name: "Inverted Study",
          startDate: "2026-11-30",
          endDate: "2026-11-01",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/end date cannot be before start date/i);
    });

    it("study: rejects duplicate name among active studies case-insensitively (400)", async () => {
      const uniqueName = `Unique Study ${Date.now()}`;
      const first = await request(app)
        .post("/studies")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          name: uniqueName,
          startDate: "2026-11-01",
          endDate: "2026-11-30",
        });
      expect(first.status).toBe(201);

      // Attempt second with different casing
      const second = await request(app)
        .post("/studies")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          name: uniqueName.toLowerCase(),
          startDate: "2026-11-01",
          endDate: "2026-11-30",
        });
      expect(second.status).toBe(400);
      expect(second.body.error).toMatch(/already exists/i);
    });

    it("study: rejects BATCHES audience when audienceBatches is empty or invalid (400)", async () => {
      const emptyRes = await request(app)
        .post("/studies")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          name: `Batches Study Empty ${Date.now()}`,
          startDate: "2026-11-01",
          endDate: "2026-11-30",
          audienceType: "BATCHES",
          audienceBatches: [],
        });
      expect(emptyRes.status).toBe(400);
      expect(emptyRes.body.error).toMatch(/audienceBatches cannot be empty/i);

      const invalidRes = await request(app)
        .post("/studies")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          name: `Batches Study Invalid ${Date.now()}`,
          startDate: "2026-11-01",
          endDate: "2026-11-30",
          audienceType: "BATCHES",
          audienceBatches: ["NOT_A_BATCH"],
        });
      expect(invalidRes.status).toBe(400);
      expect(invalidRes.body.error).toMatch(/invalid batch/i);
    });

    it("study: rejects requiredSessions < 1 (400)", async () => {
      const res = await request(app)
        .post("/studies")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          name: `ReqSessions 0 Study ${Date.now()}`,
          startDate: "2026-11-01",
          endDate: "2026-11-30",
          requiredSessions: 0,
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/required sessions must be at least 1/i);
    });

    it("study: warns when requiredSessions > number of generated sessions, but does not block (201)", async () => {
      const res = await request(app)
        .post("/studies")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          name: `ReqSessions Warning Study ${Date.now()}`,
          startDate: "2026-11-01",
          endDate: "2026-11-30",
          requiredSessions: 5,
          sessionsInput: {
            mode: "one-time",
            title: "Single Session",
            startTime: "2026-11-02T10:00:00Z",
            endTime: "2026-11-02T12:00:00Z",
          },
        });
      expect(res.status).toBe(201);
      expect(res.body.warning).toBeDefined();
      expect(res.body.warning).toMatch(/Required sessions \(5\) exceeds the number of sessions \(1\)/i);
    });

    it("sessions linked to study: warns when session date is outside study range (201)", async () => {
      const studyRes = await request(app)
        .post("/studies")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          name: `Date Range Test Study ${Date.now()}`,
          startDate: "2026-11-10",
          endDate: "2026-11-20",
        });
      expect(studyRes.status).toBe(201);
      const studyId = studyRes.body.study.id;

      // Create session on Nov 05 (before Nov 10)
      const res = await request(app)
        .post("/events")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          title: "Out of Range Session",
          description: "Scheduled before study starts",
          studyId,
          eventDate: "2026-11-05",
          startTime: "2026-11-05T10:00:00Z",
          endTime: "2026-11-05T12:00:00Z",
        });

      expect(res.status).toBe(201);
      expect(res.body.warning).toBeDefined();
      expect(res.body.warning).toMatch(/outside the study date range/i);
    });

    it("sessions linked to study: warns when two sessions have the same start time in the same study (201)", async () => {
      const studyRes = await request(app)
        .post("/studies")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          name: `Duplicate Start Test Study ${Date.now()}`,
          startDate: "2026-11-01",
          endDate: "2026-11-30",
        });
      expect(studyRes.status).toBe(201);
      const studyId = studyRes.body.study.id;

      // Session 1
      const res1 = await request(app)
        .post("/events")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          title: "Session 1",
          description: "First session",
          studyId,
          eventDate: "2026-11-15",
          startTime: "2026-11-15T10:00:00Z",
          endTime: "2026-11-15T12:00:00Z",
        });
      expect(res1.status).toBe(201);

      // Session 2 with EXACT SAME startTime in the same study
      const res2 = await request(app)
        .post("/events")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          title: "Session 2",
          description: "Second session with duplicate start",
          studyId,
          eventDate: "2026-11-15",
          startTime: "2026-11-15T10:00:00Z",
          endTime: "2026-11-15T13:00:00Z",
        });

      expect(res2.status).toBe(201);
      expect(res2.body.warning).toBeDefined();
      expect(res2.body.warning).toMatch(/scheduled at the same start time/i);
    });
  });

  // ==========================================
  // 4. MEMBERS VALIDATION RULES
  // ==========================================
  describe("4. Members Validations", () => {
    it("rejects non-Ethiopian phone format (400)", async () => {
      const res = await request(app)
        .post("/members")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: "Invalid Phone Member",
          email: `invalid_phone_${Date.now()}@example.com`,
          phoneNumber: "1234567890", // Not +251 or 09/07
          department: "Computer Science",
          batch: "YEAR_2",
          campus: "FOUR_KILO",
          gender: "MALE",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/valid ethiopian phone number/i);
    });

    it("rejects invalid email format (400)", async () => {
      const res = await request(app)
        .post("/members")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: "Invalid Email Member",
          email: "not-an-email",
          phoneNumber: "0911223344",
          department: "Computer Science",
          batch: "YEAR_2",
          campus: "FOUR_KILO",
          gender: "MALE",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/valid email address/i);
    });

    it("rejects duplicate email with 409", async () => {
      const email = `dup_email_${Date.now()}@example.com`;
      const first = await request(app)
        .post("/members")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: "Member 1",
          email,
          phoneNumber: `09${Math.floor(10000000 + Math.random() * 90000000)}`,
          department: "Computer Science",
          batch: "YEAR_2",
          campus: "FOUR_KILO",
          gender: "MALE",
        });
      expect(first.status).toBe(201);

      const second = await request(app)
        .post("/members")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: "Member 2",
          email,
          phoneNumber: `09${Math.floor(10000000 + Math.random() * 90000000)}`,
          department: "Chemistry",
          batch: "YEAR_3",
          campus: "FOUR_KILO",
          gender: "FEMALE",
        });
      expect(second.status).toBe(409);
      expect(second.body.error).toMatch(/email already exists/i);
    });

    it("rejects duplicate phone number with 409", async () => {
      const phone = `09${Math.floor(10000000 + Math.random() * 90000000)}`;
      const first = await request(app)
        .post("/members")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: "Phone Member 1",
          email: `phone1_${Date.now()}@example.com`,
          phoneNumber: phone,
          department: "Computer Science",
          batch: "YEAR_2",
          campus: "FOUR_KILO",
          gender: "MALE",
        });
      expect(first.status).toBe(201);

      const second = await request(app)
        .post("/members")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: "Phone Member 2",
          email: `phone2_${Date.now()}@example.com`,
          phoneNumber: phone,
          department: "Physics",
          batch: "YEAR_3",
          campus: "FOUR_KILO",
          gender: "FEMALE",
        });
      expect(second.status).toBe(409);
      expect(second.body.error).toMatch(/phone number already exists/i);
    });

    it("rejects YEAR_5 on 4-year campus (FOUR_KILO) with 400", async () => {
      const res = await request(app)
        .post("/members")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: "Illegal Year 5",
          email: `y5_illegal_${Date.now()}@example.com`,
          phoneNumber: `09${Math.floor(10000000 + Math.random() * 90000000)}`,
          department: "Computer Science",
          batch: "YEAR_5",
          campus: "FOUR_KILO", // 4-year campus
          gender: "MALE",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/only available for 5-year campuses/i);
    });

    it("accepts YEAR_5 on 5-year campus (FIVE_KILO) with 201", async () => {
      const res = await request(app)
        .post("/members")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: "Legal Year 5",
          email: `y5_legal_${Date.now()}@example.com`,
          phoneNumber: `09${Math.floor(10000000 + Math.random() * 90000000)}`,
          department: "Electrical Engineering",
          batch: "YEAR_5",
          campus: "FIVE_KILO", // 5-year campus
          gender: "FEMALE",
        });

      expect(res.status).toBe(201);
      expect(res.body.member.batch).toBe("YEAR_5");
      expect(res.body.member.campus).toBe("FIVE_KILO");
    });
  });

  // ==========================================
  // 5. ATTENDANCE VALIDATION RULES
  // ==========================================
  describe("5. Attendance Validations", () => {
    it("cannot mark attendance outside window without admin override (400)", async () => {
      // Create past session
      const pastEvent = await prisma.event.create({
        data: {
          title: "Far Past Session",
          description: "Closed attendance",
          eventDate: new Date("2026-01-01"),
          startTime: new Date("2026-01-01T10:00:00Z"),
          endTime: new Date("2026-01-01T12:00:00Z"),
          endedAt: new Date("2026-01-01T12:00:00Z"),
          location: "Center",
          createdById: superAdminId,
        },
      });

      const res = await request(app)
        .post("/attendance")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          memberId: activeMemberId,
          eventId: pastEvent.id,
          allowOverride: false,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Attendance is only allowed while the event is ACTIVE/i);
    });

    it("can mark attendance outside window WITH admin override (200/201)", async () => {
      // Create past session
      const pastEvent = await prisma.event.create({
        data: {
          title: "Far Past Session with Admin Override",
          description: "Closed attendance override test",
          eventDate: new Date("2026-01-02"),
          startTime: new Date("2026-01-02T10:00:00Z"),
          endTime: new Date("2026-01-02T12:00:00Z"),
          endedAt: new Date("2026-01-02T12:00:00Z"),
          location: "Center",
          createdById: superAdminId,
        },
      });

      const res = await request(app)
        .post("/attendance")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          memberId: activeMemberId,
          eventId: pastEvent.id,
          allowOverride: true,
        });

      expect([200, 201]).toContain(res.status);
      expect(res.body.attendance).toBeDefined();
    });

    it("cannot mark attendance for deactivated members (403)", async () => {
      // Create active session
      const activeEvent = await prisma.event.create({
        data: {
          title: "Active Session For Deactivated Test",
          description: "Active",
          eventDate: new Date(),
          startTime: new Date(Date.now() - 10 * 60 * 1000), // started 10m ago
          endTime: new Date(Date.now() + 50 * 60 * 1000),   // ends in 50m
          location: "Center",
          createdById: superAdminId,
        },
      });

      const res = await request(app)
        .post("/attendance")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          memberId: deactivatedMemberId,
          eventId: activeEvent.id,
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/deactivated/i);
    });

    it("cannot mark attendance on cancelled sessions even with admin override (400)", async () => {
      // Create cancelled session
      const cancelledEvent = await prisma.event.create({
        data: {
          title: "Cancelled Session",
          description: "Cancelled test",
          eventDate: new Date(),
          startTime: new Date(Date.now() - 10 * 60 * 1000),
          endTime: new Date(Date.now() + 50 * 60 * 1000),
          cancelledAt: new Date(),
          cancelReason: "Emergency weather",
          location: "Center",
          createdById: superAdminId,
        },
      });

      const res = await request(app)
        .post("/attendance")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          memberId: activeMemberId,
          eventId: cancelledEvent.id,
          allowOverride: true, // EVEN with admin override
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/cancelled session/i);
    });

    it("duplicate attendance marks return 409", async () => {
      // Active session
      const activeEvent = await prisma.event.create({
        data: {
          title: "Duplicate Check Session",
          description: "Active",
          eventDate: new Date(),
          startTime: new Date(Date.now() - 10 * 60 * 1000),
          endTime: new Date(Date.now() + 50 * 60 * 1000),
          location: "Center",
          createdById: superAdminId,
        },
      });

      // First mark
      const first = await request(app)
        .post("/attendance")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          memberId: activeMemberId,
          eventId: activeEvent.id,
        });
      expect([200, 201]).toContain(first.status);

      // Second mark
      const second = await request(app)
        .post("/attendance")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          memberId: activeMemberId,
          eventId: activeEvent.id,
        });
      expect(second.status).toBe(409);
      expect(second.body.error).toMatch(/already marked/i);
    });
  });
});
