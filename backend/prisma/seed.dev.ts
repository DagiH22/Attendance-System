import { PrismaClient, Campus, Batch, Gender, AdminRole, SessionType, AudienceType, AttendanceStatus } from "@prisma/client";
import bcrypt from "bcrypt";
import dotenv from "dotenv";
import path from "path";

// Force load backend/.env.test to use throwaway test database
dotenv.config({ path: path.resolve(__dirname, "../.env.test"), override: true });

const prisma = new PrismaClient();

async function main() {
  const dbUrlStr = process.env.DATABASE_URL || "";
  let host = "unknown";
  let dbName = "unknown";

  try {
    const parsed = new URL(dbUrlStr);
    host = parsed.host;
    dbName = parsed.pathname.replace(/^\//, "");
  } catch {
    console.error("Could not parse DATABASE_URL:", dbUrlStr);
  }

  console.log(`[SEED] Checking safety: Host="${host}", Database="${dbName}"`);

  // STRICT SAFETY CHECK: Refuse to seed if not matching throwaway or _test
  const isThrowaway =
    dbName.includes("throwaway") ||
    dbName.includes("_test") ||
    dbName.includes("test");

  if (!isThrowaway) {
    console.error("❌ CRITICAL SAFETY CHECK FAILED: DATABASE_URL does not match throwaway/test pattern!");
    console.error(`Refusing to run seed on "${dbName}".`);
    process.exit(1);
  }

  console.log("✅ Verified throwaway/test database. Proceeding with idempotent seed...\n");

  const passwordHash = await bcrypt.hash("AdminPass123!", 10);

  // 1. Seed Admins
  const adminUser = await prisma.admin.upsert({
    where: { email: "admin@attendance.test" },
    update: {},
    create: {
      name: "Standard Admin",
      email: "admin@attendance.test",
      password: passwordHash,
      role: AdminRole.ADMIN,
    },
  });

  const superAdminUser = await prisma.admin.upsert({
    where: { email: "superadmin@attendance.test" },
    update: {},
    create: {
      name: "Super Administrator",
      email: "superadmin@attendance.test",
      password: passwordHash,
      role: AdminRole.SUPER_ADMIN,
    },
  });

  console.log(`- Admins seeded: ${adminUser.email}, ${superAdminUser.email}`);

  // 2. Seed Members across all 4 campuses and varied entry years
  const memberDefinitions = [
    // FOUR_KILO (4-year program: 2026=Freshman, 2025=Y2, 2024=Y3, 2023=Y4 Final, 2022=Graduate)
    {
      uniqueId: "4K-FR-001",
      name: "Abebe Bikila",
      email: "abebe.4k@example.com",
      phoneNumber: "+251911000001",
      campus: Campus.FOUR_KILO,
      batch: Batch.FRESHMAN,
      entryAcademicYear: 2026,
      department: "Computer Science",
      gender: Gender.MALE,
    },
    {
      uniqueId: "4K-Y2-002",
      name: "Bethlehem Tadesse",
      email: "bethlehem.4k@example.com",
      phoneNumber: "+251911000002",
      campus: Campus.FOUR_KILO,
      batch: Batch.YEAR_2,
      entryAcademicYear: 2025,
      department: "Information Systems",
      gender: Gender.FEMALE,
    },
    {
      uniqueId: "4K-Y4-003",
      name: "Chala Dejene (Final Year)",
      email: "chala.4k@example.com",
      phoneNumber: "+251911000003",
      campus: Campus.FOUR_KILO,
      batch: Batch.YEAR_4,
      entryAcademicYear: 2023, // Final year for 4K
      department: "Physics",
      gender: Gender.MALE,
    },
    {
      uniqueId: "4K-REP-004",
      name: "Daniel Kebede (Repeater Override)",
      email: "daniel.4k@example.com",
      phoneNumber: "+251911000004",
      campus: Campus.FOUR_KILO,
      batch: Batch.YEAR_3,
      entryAcademicYear: 2023, // Would be Year 4, but override to Year 3
      batchOverride: Batch.YEAR_3,
      department: "Mathematics",
      gender: Gender.MALE,
    },
    {
      uniqueId: "4K-INACT-005",
      name: "Eden Girma (Deactivated)",
      email: "eden.4k@example.com",
      phoneNumber: "+251911000005",
      campus: Campus.FOUR_KILO,
      batch: Batch.YEAR_2,
      entryAcademicYear: 2025,
      department: "Chemistry",
      gender: Gender.FEMALE,
      isActive: false,
      deactivatedAt: new Date("2026-09-15T00:00:00Z"),
    },

    // FIVE_KILO (5-year program: 2026=Freshman, 2023=Y4, 2022=Y5 Final, 2021=Graduate)
    {
      uniqueId: "5K-Y4-006",
      name: "Fasika Assefa (5K 4th Year - not final)",
      email: "fasika.5k@example.com",
      phoneNumber: "+251912000006",
      campus: Campus.FIVE_KILO,
      batch: Batch.YEAR_4,
      entryAcademicYear: 2023, // Year 4 of 5 = NOT final
      department: "Electrical Engineering",
      gender: Gender.FEMALE,
    },
    {
      uniqueId: "5K-Y5-007",
      name: "Getachew Mengistu (5K Final Year)",
      email: "getachew.5k@example.com",
      phoneNumber: "+251912000007",
      campus: Campus.FIVE_KILO,
      batch: Batch.YEAR_5,
      entryAcademicYear: 2022, // Year 5 of 5 = FINAL YEAR
      department: "Mechanical Engineering",
      gender: Gender.MALE,
    },

    // SIX_KILO (4-year program: 2023=Final Year)
    {
      uniqueId: "6K-Y4-008",
      name: "Hiwot Tesfaye (6K Final Year)",
      email: "hiwot.6k@example.com",
      phoneNumber: "+251913000008",
      campus: Campus.SIX_KILO,
      batch: Batch.YEAR_4,
      entryAcademicYear: 2023, // Final year
      department: "Health Sciences",
      gender: Gender.FEMALE,
    },
    {
      uniqueId: "6K-Y2-009",
      name: "Israel Zewdu",
      email: "israel.6k@example.com",
      phoneNumber: "+251913000009",
      campus: Campus.SIX_KILO,
      batch: Batch.YEAR_2,
      entryAcademicYear: 2025,
      department: "Pharmacy",
      gender: Gender.MALE,
    },

    // ART (4-year program)
    {
      uniqueId: "ART-Y3-010",
      name: "Jerusalem Hailu",
      email: "jerusalem.art@example.com",
      phoneNumber: "+251914000010",
      campus: Campus.ART,
      batch: Batch.YEAR_3,
      entryAcademicYear: 2024,
      department: "Visual Arts",
      gender: Gender.FEMALE,
    },
    {
      uniqueId: "ART-Y4-011",
      name: "Kalkidan Solomon (Art Final Year)",
      email: "kalkidan.art@example.com",
      phoneNumber: "+251914000011",
      campus: Campus.ART,
      batch: Batch.YEAR_4,
      entryAcademicYear: 2023, // Final year
      department: "Music and Theatre",
      gender: Gender.FEMALE,
    },
  ];

  const seededMembers = [];
  for (const def of memberDefinitions) {
    const member = await prisma.member.upsert({
      where: { uniqueId: def.uniqueId },
      update: {
        entryAcademicYear: def.entryAcademicYear,
        batchOverride: def.batchOverride || null,
        isActive: def.isActive !== undefined ? def.isActive : true,
        deactivatedAt: def.deactivatedAt || null,
      },
      create: {
        uniqueId: def.uniqueId,
        name: def.name,
        email: def.email,
        phoneNumber: def.phoneNumber,
        campus: def.campus,
        batch: def.batch,
        entryAcademicYear: def.entryAcademicYear,
        batchOverride: def.batchOverride,
        department: def.department,
        gender: def.gender,
        isActive: def.isActive !== undefined ? def.isActive : true,
        deactivatedAt: def.deactivatedAt,
      },
    });
    seededMembers.push(member);
  }
  console.log(`- Seeded ${seededMembers.length} members across all campuses.`);

  // 3. Seed Three Studies:
  // - Study 1: Holy Mary Feast Study (8 sessions, 2 overnight, 1 rescheduled, 1 cancelled, audience ALL)
  // - Study 2: Epiphany Mezmur Preparation (Overlapping in time, audience ALL)
  // - Study 3: Graduating Class Hymn Special Study (Audience FINAL_YEAR)

  const study1 = await prisma.study.upsert({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000001",
      name: "Holy Mary Feast Study 2026",
      description: "Annual intensive 8-session liturgical hymn preparation for Holy Mary feast",
      startDate: new Date("2026-10-01T00:00:00Z"),
      endDate: new Date("2026-11-25T00:00:00Z"),
      audienceType: AudienceType.ALL,
      requiredSessions: 6,
      defaultLateGraceMinutes: 15,
      isActive: true,
    },
  });

  const study2 = await prisma.study.upsert({
    where: { id: "00000000-0000-0000-0000-000000000002" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000002",
      name: "Epiphany Mezmur Preparation 2026",
      description: "Overlapping spiritual hymn study running in parallel for Timket preparation",
      startDate: new Date("2026-10-15T00:00:00Z"),
      endDate: new Date("2026-12-10T00:00:00Z"),
      audienceType: AudienceType.ALL,
      requiredSessions: 4,
      defaultLateGraceMinutes: 20,
      isActive: true,
    },
  });

  const study3 = await prisma.study.upsert({
    where: { id: "00000000-0000-0000-0000-000000000003" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000003",
      name: "Graduating Class Hymn Special Study 2026",
      description: "Dedicated preparation and blessing hymns for final-year students only",
      startDate: new Date("2026-10-20T00:00:00Z"),
      endDate: new Date("2026-11-30T00:00:00Z"),
      audienceType: AudienceType.FINAL_YEAR,
      requiredSessions: 3,
      defaultLateGraceMinutes: 10,
      isActive: true,
    },
  });

  console.log(`- Seeded studies: "${study1.name}", "${study2.name}", "${study3.name}"`);

  // 4. Seed Sessions for Study 1 (8 sessions, 2 overnight, 1 moved/rescheduled, 1 cancelled)
  const study1Sessions = [
    {
      id: "00000000-0000-0000-0001-000000000001",
      title: "Study 1: Introduction & Degwa Foundations",
      sessionType: SessionType.EVENING,
      startTime: new Date("2026-10-02T17:00:00Z"),
      endTime: new Date("2026-10-02T19:30:00Z"),
      recurrenceIndex: 1,
    },
    {
      id: "00000000-0000-0000-0001-000000000002",
      title: "Study 2: Mary Hymns Part I",
      sessionType: SessionType.EVENING,
      startTime: new Date("2026-10-09T17:00:00Z"),
      endTime: new Date("2026-10-09T19:30:00Z"),
      recurrenceIndex: 2,
    },
    {
      id: "00000000-0000-0000-0001-000000000003",
      title: "Study 3: First Overnight Vigils & Chanting",
      sessionType: SessionType.OVERNIGHT,
      startTime: new Date("2026-10-16T21:00:00Z"),
      endTime: new Date("2026-10-17T06:00:00Z"),
      recurrenceIndex: 3,
    },
    {
      id: "00000000-0000-0000-0001-000000000004",
      title: "Study 4: Mahlet Hymn Mastery (Rescheduled)",
      sessionType: SessionType.EVENING,
      plannedStartTime: new Date("2026-10-23T17:00:00Z"),
      startTime: new Date("2026-10-24T17:00:00Z"), // Moved to Saturday
      endTime: new Date("2026-10-24T19:30:00Z"),
      rescheduledAt: new Date("2026-10-21T10:00:00Z"),
      rescheduleReason: "University hall booked for faculty academic conference",
      recurrenceIndex: 4,
    },
    {
      id: "00000000-0000-0000-0001-000000000005",
      title: "Study 5: Mid-Study Review (Cancelled)",
      sessionType: SessionType.EVENING,
      startTime: new Date("2026-10-30T17:00:00Z"),
      endTime: new Date("2026-10-30T19:30:00Z"),
      cancelledAt: new Date("2026-10-29T14:00:00Z"),
      cancelReason: "Campus curfew and heavy storm",
      recurrenceIndex: 5,
    },
    {
      id: "00000000-0000-0000-0001-000000000006",
      title: "Study 6: Second Overnight Full Rehearsal",
      sessionType: SessionType.OVERNIGHT,
      startTime: new Date("2026-11-06T21:00:00Z"),
      endTime: new Date("2026-11-07T06:00:00Z"),
      recurrenceIndex: 6,
    },
    {
      id: "00000000-0000-0000-0001-000000000007",
      title: "Study 7: Chime and Rhythm Practice",
      sessionType: SessionType.EVENING,
      startTime: new Date("2026-11-13T17:00:00Z"),
      endTime: new Date("2026-11-13T19:30:00Z"),
      recurrenceIndex: 7,
    },
    {
      id: "00000000-0000-0000-0001-000000000008",
      title: "Study 8: Final Feast Rehearsal & Blessing",
      sessionType: SessionType.EVENING,
      startTime: new Date("2026-11-20T17:00:00Z"),
      endTime: new Date("2026-11-20T19:30:00Z"),
      recurrenceIndex: 8,
    },
  ];

  for (const s of study1Sessions) {
    await prisma.event.upsert({
      where: { id: s.id },
      update: {
        startTime: s.startTime,
        endTime: s.endTime,
        plannedStartTime: s.plannedStartTime || s.startTime,
        rescheduledAt: s.rescheduledAt || null,
        rescheduleReason: s.rescheduleReason || null,
        cancelledAt: s.cancelledAt || null,
        cancelReason: s.cancelReason || null,
      },
      create: {
        id: s.id,
        title: s.title,
        description: s.title,
        eventDate: s.startTime,
        location: "St. Mary Hall",
        sessionType: s.sessionType,
        startTime: s.startTime,
        endTime: s.endTime,
        plannedStartTime: s.plannedStartTime || s.startTime,
        rescheduledAt: s.rescheduledAt || null,
        rescheduleReason: s.rescheduleReason || null,
        cancelledAt: s.cancelledAt || null,
        cancelReason: s.cancelReason || null,
        studyId: study1.id,
        createdById: adminUser.id,
        recurrenceIndex: s.recurrenceIndex,
        recurrenceLengthWeeks: 8,
      },
    });
  }
  console.log(`- Seeded ${study1Sessions.length} sessions for Study 1 (including 2 overnight, 1 moved, 1 cancelled).`);

  // 5. Seed Sessions for Study 2 (Epiphany, 2 sessions)
  const study2Sessions = [
    {
      id: "00000000-0000-0000-0002-000000000001",
      title: "Epiphany Session 1: Water Blessings Chants",
      sessionType: SessionType.EVENING,
      startTime: new Date("2026-10-18T16:30:00Z"),
      endTime: new Date("2026-10-18T18:30:00Z"),
      studyId: study2.id,
      recurrenceIndex: 1,
    },
    {
      id: "00000000-0000-0000-0002-000000000002",
      title: "Epiphany Session 2: Processional Hymns",
      sessionType: SessionType.EVENING,
      startTime: new Date("2026-10-25T16:30:00Z"),
      endTime: new Date("2026-10-25T18:30:00Z"),
      studyId: study2.id,
      recurrenceIndex: 2,
    },
  ];

  for (const s of study2Sessions) {
    await prisma.event.upsert({
      where: { id: s.id },
      update: {},
      create: {
        id: s.id,
        title: s.title,
        description: s.title,
        eventDate: s.startTime,
        location: "Epiphany Center",
        sessionType: s.sessionType,
        startTime: s.startTime,
        endTime: s.endTime,
        plannedStartTime: s.startTime,
        studyId: s.studyId,
        createdById: adminUser.id,
        recurrenceIndex: s.recurrenceIndex,
      },
    });
  }

  // 6. Seed Sessions for Study 3 (FINAL_YEAR audience, 2 sessions)
  const study3Sessions = [
    {
      id: "00000000-0000-0000-0003-000000000001",
      title: "Graduating Class Study 1: Senior Leadership Hymns",
      sessionType: SessionType.EVENING,
      startTime: new Date("2026-10-22T18:00:00Z"),
      endTime: new Date("2026-10-22T20:00:00Z"),
      studyId: study3.id,
    },
    {
      id: "00000000-0000-0000-0003-000000000002",
      title: "Graduating Class Study 2: Commissioning & Farewell Hymns",
      sessionType: SessionType.EVENING,
      startTime: new Date("2026-10-29T18:00:00Z"),
      endTime: new Date("2026-10-29T20:00:00Z"),
      studyId: study3.id,
    },
  ];

  for (const s of study3Sessions) {
    await prisma.event.upsert({
      where: { id: s.id },
      update: {},
      create: {
        id: s.id,
        title: s.title,
        description: s.title,
        eventDate: s.startTime,
        location: "Graduate Hall",
        sessionType: s.sessionType,
        startTime: s.startTime,
        endTime: s.endTime,
        plannedStartTime: s.startTime,
        studyId: s.studyId,
        createdById: superAdminUser.id,
      },
    });
  }

  // 7. Seed Attendance records for Study 1 Session 1 (past session on Oct 2)
  // Demonstrating: PRESENT, LATE, EXCUSED, and soft-delete undo
  const s1Id = "00000000-0000-0000-0001-000000000001";
  const m1 = seededMembers[0]; // Abebe (Present)
  const m2 = seededMembers[1]; // Bethlehem (Late)
  const m3 = seededMembers[2]; // Chala (Excused)
  const m4 = seededMembers[3]; // Daniel (Soft removed)

  if (m1) {
    await prisma.attendance.upsert({
      where: { memberId_eventId_unique: { memberId: m1.id, eventId: s1Id } },
      update: { status: AttendanceStatus.PRESENT, removedAt: null },
      create: {
        memberId: m1.id,
        eventId: s1Id,
        markedById: adminUser.id,
        markedMethod: "MANUAL",
        status: AttendanceStatus.PRESENT,
        markedAt: new Date("2026-10-02T17:05:00Z"),
      },
    });
  }

  if (m2) {
    await prisma.attendance.upsert({
      where: { memberId_eventId_unique: { memberId: m2.id, eventId: s1Id } },
      update: { status: AttendanceStatus.LATE, removedAt: null },
      create: {
        memberId: m2.id,
        eventId: s1Id,
        markedById: adminUser.id,
        markedMethod: "QR",
        status: AttendanceStatus.LATE,
        markedAt: new Date("2026-10-02T17:25:00Z"), // 25 mins after 17:00 (grace is 15)
      },
    });
  }

  if (m3) {
    await prisma.attendance.upsert({
      where: { memberId_eventId_unique: { memberId: m3.id, eventId: s1Id } },
      update: { status: AttendanceStatus.EXCUSED, excuseReason: "Laboratory practical exam", removedAt: null },
      create: {
        memberId: m3.id,
        eventId: s1Id,
        markedById: adminUser.id,
        markedMethod: "MANUAL",
        status: AttendanceStatus.EXCUSED,
        excuseReason: "Laboratory practical exam",
        markedAt: new Date("2026-10-02T16:00:00Z"),
      },
    });
  }

  if (m4) {
    await prisma.attendance.upsert({
      where: { memberId_eventId_unique: { memberId: m4.id, eventId: s1Id } },
      update: {
        status: AttendanceStatus.PRESENT,
        removedAt: new Date("2026-10-02T18:00:00Z"),
        removedById: adminUser.id,
        removeReason: "Accidental manual check-in of wrong member",
      },
      create: {
        memberId: m4.id,
        eventId: s1Id,
        markedById: adminUser.id,
        markedMethod: "MANUAL",
        status: AttendanceStatus.PRESENT,
        markedAt: new Date("2026-10-02T17:00:00Z"),
        removedAt: new Date("2026-10-02T18:00:00Z"),
        removedById: adminUser.id,
        removeReason: "Accidental manual check-in of wrong member",
      },
    });
  }

  console.log("✅ Seed completed successfully with idempotent data!");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed with error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
