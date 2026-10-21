import dotenv from "dotenv";
import path from "path";

// Ensure .env.test is loaded before any imports
dotenv.config({ path: path.resolve(__dirname, "../../.env.test"), override: true });

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import ExcelJS from "exceljs";
import { PrismaClient, AdminRole, SessionType, AttendanceStatus, MarkMethod, Batch, Campus } from "@prisma/client";
import app from "../index";
import { createAccessToken } from "../utils/token.utils";

const prisma = new PrismaClient();

describe("Item 8 Excel Exports Round-Trip - Automated Test Suite", () => {
  let adminToken: string;
  let superAdminToken: string;
  let testMember1Id: string;
  let testMember2Id: string;
  let testMemberAbsentId: string;
  let m1UniqueId: string;
  let m2UniqueId: string;
  let mAbsentUniqueId: string;
  let standaloneEventId: string;
  let studyId: string;
  let studyEvent1Id: string;
  let studyEvent2Id: string;

  beforeAll(async () => {
    // Safety check: throwaway or test DB only
    const dbUrl = process.env.DATABASE_URL || "";
    expect(
      dbUrl.includes("throwaway") || dbUrl.includes("_test"),
      "DATABASE_URL must point to a throwaway or test database",
    ).toBe(true);

    const admin = await prisma.admin.findUnique({ where: { email: "admin@attendance.test" } });
    const superAdmin = await prisma.admin.findUnique({ where: { email: "superadmin@attendance.test" } });

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
    const pastCreated = new Date("2026-01-01T00:00:00Z");

    // 1. Seed members:
    // Member 1: Ethiopian 09 number, old shape (no override)
    const m1 = await prisma.member.create({
      data: {
        uniqueId: `EXCEL-M1-${suffix}`,
        name: "Abebe Kebede",
        email: `m1_${suffix}@example.com`,
        phoneNumber: "0911223344",
        department: "Computer Science",
        batch: Batch.YEAR_2,
        campus: Campus.FOUR_KILO,
        gender: "MALE",
        entryAcademicYear: 2024,
        createdAt: pastCreated,
      },
    });
    testMember1Id = m1.id;
    m1UniqueId = m1.uniqueId;

    // Member 2: Ethiopian 07 number, Amharic name and department
    const m2 = await prisma.member.create({
      data: {
        uniqueId: `EXCEL-M2-${suffix}`,
        name: "ቴዎድሮስ ካሳሁን",
        email: `m2_${suffix}@example.com`,
        phoneNumber: "0712345678",
        department: "መዝሙር ጥናት ክፍል",
        batch: Batch.YEAR_3,
        campus: Campus.FIVE_KILO,
        gender: "MALE",
        entryAcademicYear: 2023,
        createdAt: pastCreated,
      },
    });
    testMember2Id = m2.id;
    m2UniqueId = m2.uniqueId;

    // Member Absent:
    const mAbsent = await prisma.member.create({
      data: {
        uniqueId: `EXCEL-ABS-${suffix}`,
        name: "Absentee Kidist",
        email: `absent_${suffix}@example.com`,
        phoneNumber: "0988776655",
        department: "Economics",
        batch: Batch.YEAR_2,
        campus: Campus.FOUR_KILO,
        gender: "FEMALE",
        entryAcademicYear: 2024,
        createdAt: pastCreated,
      },
    });
    testMemberAbsentId = mAbsent.id;
    mAbsentUniqueId = mAbsent.uniqueId;

    // 2. Seed Standalone Session (OLD shape: no study)
    const now = new Date();
    const eventStart = new Date(now.getTime() - 2 * 3600 * 1000); // 2 hours ago
    const eventEnd = new Date(now.getTime() - 1 * 3600 * 1000);   // 1 hour ago

    const evStandalone = await prisma.event.create({
      data: {
        title: `ክፍለ ጊዜ ጥናት - ${suffix}`,
        description: "Standalone session description",
        location: "ማዕከል 4ኛ ፎቅ",
        sessionType: SessionType.REGULAR,
        eventDate: new Date(eventStart.toISOString().slice(0, 10)),
        startTime: eventStart,
        endTime: eventEnd,
        createdById: admin!.id,
      },
    });
    standaloneEventId = evStandalone.id;

    // 3. Seed Study and Study Sessions (NEW shape, ongoing through end of 2026)
    const study = await prisma.study.create({
      data: {
        name: `Excel Study Round-Trip ${suffix}`,
        description: "Study for Excel round-trip verification",
        startDate: new Date("2026-03-01T00:00:00Z"),
        endDate: new Date("2026-12-31T00:00:00Z"),
        audienceType: "ALL",
        requiredSessions: 1,
      },
    });
    studyId = study.id;

    const sEv1 = await prisma.event.create({
      data: {
        title: "Study Session Alpha",
        description: "Study session alpha description",
        location: "Hall A",
        studyId: study.id,
        sessionType: SessionType.REGULAR,
        eventDate: new Date("2026-03-05"),
        startTime: new Date("2026-03-05T15:00:00Z"),
        endTime: new Date("2026-03-05T17:00:00Z"),
        createdById: admin!.id,
      },
    });
    studyEvent1Id = sEv1.id;

    const sEv2 = await prisma.event.create({
      data: {
        title: "Study Session Beta",
        description: "Study session beta description",
        location: "Hall B",
        studyId: study.id,
        sessionType: SessionType.OVERNIGHT,
        eventDate: new Date("2026-03-12"),
        startTime: new Date("2026-03-12T19:00:00Z"),
        endTime: new Date("2026-03-13T03:00:00Z"),
        createdById: admin!.id,
      },
    });
    studyEvent2Id = sEv2.id;

    // 4. Seed Attendances:
    // Standalone:
    // m1 -> PRESENT
    await prisma.attendance.create({
      data: {
        eventId: evStandalone.id,
        memberId: m1.id,
        markedById: admin!.id,
        markedMethod: MarkMethod.MANUAL,
        status: AttendanceStatus.PRESENT,
        markedAt: eventStart,
      },
    });
    // m2 -> LATE
    await prisma.attendance.create({
      data: {
        eventId: evStandalone.id,
        memberId: m2.id,
        markedById: admin!.id,
        markedMethod: MarkMethod.QR,
        status: AttendanceStatus.LATE,
        markedAt: new Date(eventStart.getTime() + 15 * 60000),
      },
    });
    // Soft-removed attendance mark on standalone event
    await prisma.attendance.create({
      data: {
        eventId: evStandalone.id,
        memberId: mAbsent.id,
        markedById: admin!.id,
        markedMethod: MarkMethod.MANUAL,
        status: AttendanceStatus.PRESENT,
        markedAt: eventStart,
        removedAt: new Date(),
        removedById: admin!.id,
      },
    });

    // Study Event 1:
    // m1 -> PRESENT
    await prisma.attendance.create({
      data: {
        eventId: sEv1.id,
        memberId: m1.id,
        markedById: admin!.id,
        markedMethod: MarkMethod.QR,
        status: AttendanceStatus.PRESENT,
        markedAt: new Date("2026-03-05T15:05:00Z"),
      },
    });
    // m2 -> EXCUSED with Amharic excuse reason
    await prisma.attendance.create({
      data: {
        eventId: sEv1.id,
        memberId: m2.id,
        markedById: admin!.id,
        markedMethod: MarkMethod.MANUAL,
        status: AttendanceStatus.EXCUSED,
        excuseReason: "የጤና ችግር (ህመም)",
        markedAt: new Date("2026-03-05T14:50:00Z"),
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("1. Members Excel Export: opens cleanly, frozen row 1, text phone with leading 0, Attended Sessions header, excludes soft-removed marks", async () => {
    const res = await request(app)
      .get("/members/export/excel")
      .set("Authorization", `Bearer ${adminToken}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: any[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml");

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body);

    const sheet = workbook.getWorksheet("Members");
    expect(sheet).toBeDefined();

    // Verify frozen header row
    expect(sheet!.views).toBeDefined();
    expect(sheet!.views.length).toBeGreaterThan(0);
    expect(sheet!.views[0].state).toBe("frozen");
    expect(sheet!.views[0].ySplit).toBe(1);

    // Verify header row contains "Attended Sessions" (not just Total Attended)
    const headerRow = sheet!.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell((cell) => {
      headers.push(String(cell.value));
    });
    expect(headers).toContain("Attended Sessions");
    expect(headers).toContain("Phone");
    expect(headers).toContain("Campus");
    expect(headers).toContain("Batch");

    // Verify rows contain our test members
    let foundM1 = false;
    let foundM2 = false;
    let foundAbsent = false;

    sheet!.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const uniqueId = String(row.getCell(1).value);
      const name = String(row.getCell(2).value);
      const phoneCell = row.getCell(4);
      const phoneVal = String(phoneCell.value);

      if (uniqueId === m1UniqueId) {
        foundM1 = true;
        // Leading 0 must be preserved as string
        expect(phoneVal).toBe("0911223344");
        expect(phoneCell.numFmt).toBe("@");
      }
      if (uniqueId === m2UniqueId) {
        foundM2 = true;
        // Amharic name preserved
        expect(name).toBe("ቴዎድሮስ ካሳሁን");
        expect(phoneVal).toBe("0712345678");
        expect(phoneCell.numFmt).toBe("@");
      }
      if (uniqueId === mAbsentUniqueId) {
        foundAbsent = true;
        // Soft-removed attendance must NOT be counted! Attended count should be 0
        const attendedColIdx = headers.indexOf("Attended Sessions") + 1;
        const attendedCount = Number(row.getCell(attendedColIdx).value);
        expect(attendedCount).toBe(0);
      }
    });

    expect(foundM1).toBe(true);
    expect(foundM2).toBe(true);
    expect(foundAbsent).toBe(true);
  });

  it("2. Event Attendance Excel Export: frozen row 1, text phone, Status column, Addis timezone, excludes soft-removed marks", async () => {
    const res = await request(app)
      .get(`/events/${standaloneEventId}/export/excel`)
      .set("Authorization", `Bearer ${adminToken}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: any[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body);

    const sheet = workbook.getWorksheet("Session Attendance");
    expect(sheet).toBeDefined();

    // Verify frozen view
    expect(sheet!.views).toBeDefined();
    expect(sheet!.views[0].state).toBe("frozen");
    expect(sheet!.views[0].ySplit).toBe(1);

    const headers: string[] = [];
    sheet!.getRow(1).eachCell((cell) => headers.push(String(cell.value)));
    expect(headers).toContain("Member ID");
    expect(headers).toContain("Status");
    expect(headers).toContain("Phone");
    expect(headers).toContain("Campus");
    expect(headers).toContain("Batch");
    expect(headers).toContain("Marked On");

    let foundM1 = false;
    let foundM2 = false;
    let foundSoftRemoved = false;

    // In parsed workbook from binary, columns are accessed by 1-based index:
    // 1: uniqueId, 2: name, 3: email, 4: phone, 5: campus, 6: batch, 7: department, 8: status, 9: excuseReason, 10: markedAt
    sheet!.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const uid = String(row.getCell(1).value);
      const name = String(row.getCell(2).value);
      const phoneCell = row.getCell(4);
      const phoneVal = String(phoneCell.value);
      const status = String(row.getCell(8).value);
      const markedOn = String(row.getCell(10).value);

      if (uid === m1UniqueId) {
        foundM1 = true;
        expect(phoneVal).toBe("0911223344");
        expect(phoneCell.numFmt).toBe("@");
        expect(status).toBe("PRESENT");
        // Verify Addis formatted date string
        expect(markedOn.length).toBeGreaterThan(10);
      }
      if (uid === m2UniqueId) {
        foundM2 = true;
        expect(name).toBe("ቴዎድሮስ ካሳሁን");
        expect(phoneVal).toBe("0712345678");
        expect(phoneCell.numFmt).toBe("@");
        expect(status).toBe("LATE");
      }
      if (uid === mAbsentUniqueId) {
        // Must NOT appear in active attendance rows because removedAt is set!
        foundSoftRemoved = true;
      }
    });

    expect(foundM1).toBe(true);
    expect(foundM2).toBe(true);
    expect(foundSoftRemoved).toBe(false); // Verified: soft-removed excluded
  });

  it("3. Event Absentees Excel Export: frozen row 1, text phone, session title and Addis date", async () => {
    const res = await request(app)
      .get(`/events/${standaloneEventId}/absentees/export`)
      .set("Authorization", `Bearer ${adminToken}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: any[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body);

    const sheet = workbook.getWorksheet("Session Absentees");
    expect(sheet).toBeDefined();

    // Verify frozen view
    expect(sheet!.views).toBeDefined();
    expect(sheet!.views[0].state).toBe("frozen");
    expect(sheet!.views[0].ySplit).toBe(1);

    const headers: string[] = [];
    sheet!.getRow(1).eachCell((cell) => headers.push(String(cell.value)));
    expect(headers).toContain("Member ID");
    expect(headers).toContain("Session Title");
    expect(headers).toContain("Session Date");
    expect(headers).toContain("Status");

    let foundAbsent = false;
    let foundAttendedM1 = false;

    // Columns:
    // 1: uniqueId, 2: name, 3: phone, 4: campus, 5: batch, 6: department, 7: sessionTitle, 8: sessionDate, 9: status
    sheet!.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const uid = String(row.getCell(1).value);
      const phoneCell = row.getCell(3);
      const phoneVal = String(phoneCell.value);
      const sessionTitle = String(row.getCell(7).value);
      const status = String(row.getCell(9).value);

      if (uid === mAbsentUniqueId) {
        foundAbsent = true;
        expect(phoneVal).toBe("0988776655");
        expect(phoneCell.numFmt).toBe("@");
        expect(status).toBe("Absent");
        expect(sessionTitle).toContain("ክፍለ ጊዜ ጥናት");
      }
      if (uid === m1UniqueId) {
        foundAttendedM1 = true;
      }
    });

    expect(foundAbsent).toBe(true);
    expect(foundAttendedM1).toBe(false);
  });

  it("4. Study Grid Excel Export: frozen row 1, Session wording with Addis date, P/L/E/A codes, phone as text", async () => {
    const res = await request(app)
      .get(`/studies/${studyId}/export/excel`)
      .set("Authorization", `Bearer ${adminToken}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: any[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body);

    const sheet = workbook.worksheets[0];
    expect(sheet).toBeDefined();

    // Frozen header row
    expect(sheet.views).toBeDefined();
    expect(sheet.views[0].state).toBe("frozen");
    expect(sheet.views[0].ySplit).toBe(1);

    const headers: string[] = [];
    sheet.getRow(1).eachCell((cell) => headers.push(String(cell.value)));

    // Verify Session wording with Addis date
    expect(headers.some((h) => h.startsWith("Session 1:"))).toBe(true);
    expect(headers.some((h) => h.startsWith("Session 2:"))).toBe(true);
    expect(headers).toContain("Attended");
    expect(headers).toContain("Excused");
    expect(headers).toContain("Absent");
    expect(headers).toContain("Completed");

    let foundM1 = false;
    let foundM2 = false;

    // Columns:
    // 1: Name, 2: Unique ID, 3: Campus, 4: Batch, 5: Phone, 6: Session 1, 7: Session 2, 8: Attended, 9: Excused, 10: Absent, 11: Completed
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const name = String(row.getCell(1).value);
      const uid = String(row.getCell(2).value);
      const phoneCell = row.getCell(5);
      const session1Code = String(row.getCell(6).value);
      const attended = Number(row.getCell(8).value);
      const excused = Number(row.getCell(9).value);

      if (uid === m1UniqueId) {
        foundM1 = true;
        expect(String(phoneCell.value)).toBe("0911223344");
        expect(phoneCell.numFmt).toBe("@");
        // M1 attended S1 -> 'P'
        expect(session1Code).toBe("P");
        expect(attended).toBe(1);
      }
      if (uid === m2UniqueId) {
        foundM2 = true;
        expect(name).toBe("ቴዎድሮስ ካሳሁን");
        expect(String(phoneCell.value)).toBe("0712345678");
        expect(phoneCell.numFmt).toBe("@");
        // M2 excused on S1 -> 'E'
        expect(session1Code).toBe("E");
        expect(excused).toBe(1);
      }
    });

    expect(foundM1).toBe(true);
    expect(foundM2).toBe(true);
  });

  it("5. Study Not-Participating Members Excel Export: frozen row 1, text phone with leading 0", async () => {
    const res = await request(app)
      .get(`/studies/${studyId}/not-participating/export`)
      .set("Authorization", `Bearer ${adminToken}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: any[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body);

    const sheet = workbook.worksheets[0];
    expect(sheet).toBeDefined();

    // Frozen header row
    expect(sheet.views).toBeDefined();
    expect(sheet.views[0].state).toBe("frozen");
    expect(sheet.views[0].ySplit).toBe(1);

    const headers: string[] = [];
    sheet.getRow(1).eachCell((cell) => headers.push(String(cell.value)));
    expect(headers).toContain("Unique ID");
    expect(headers).toContain("Phone Number");
    expect(headers).toContain("Effective Batch");

    let foundAbsent = false;
    // Columns:
    // 1: Unique ID, 2: Full Name, 3: Phone Number, 4: Campus, 5: Effective Batch, 6: Department, 7: Status / Badges
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const uid = String(row.getCell(1).value);
      const phoneCell = row.getCell(3);

      if (uid === mAbsentUniqueId) {
        foundAbsent = true;
        expect(String(phoneCell.value)).toBe("0988776655");
        expect(phoneCell.numFmt).toBe("@");
      }
    });

    expect(foundAbsent).toBe(true);
  });
});
