import { Request, Response } from "express";
import { PrismaClient, Batch, Campus, AttendanceStatus } from "@prisma/client";
import ExcelJS from "exceljs";
import { getNextMezmurId } from "../utils/idGenerator";
import { sendMemberEmail } from "../utils/email.service";
import { generateQrWithLogo } from "../utils/qrCodeGenerator";
import { setExcelDownloadHeaders } from "../utils/excelExport";
import {
  computeBatch,
  deriveEntryAcademicYearForBackfill,
} from "../services/academic.service";
import { CAMPUS_PROGRAM_YEARS } from "../config/academic.config";

const prisma = new PrismaClient();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ETHIOPIAN_PHONE_REGEX = /^(\+251[79]\d{8}|0[79]\d{8})$/;

const validateMemberPayload = (payload: {
  name?: unknown;
  email?: unknown;
  phoneNumber?: unknown;
  department?: unknown;
  batch?: unknown;
  campus?: unknown;
  gender?: unknown;
}) => {
  const name = String(payload.name ?? "").trim();
  const email = String(payload.email ?? "").trim();
  const phoneNumber = String(payload.phoneNumber ?? "").trim();
  const department = String(payload.department ?? "").trim();
  const batch = String(payload.batch ?? "").trim();
  const campus = String(payload.campus ?? "").trim();
  const gender = String(payload.gender ?? "").trim();

  if (!name) {
    return { error: "Name must not be empty." };
  }

  if (!email) {
    return { error: "Email is required." };
  }

  if (!EMAIL_REGEX.test(email)) {
    return { error: "Email must be a valid email address." };
  }

  if (!phoneNumber) {
    return { error: "Phone number is required." };
  }

  if (!ETHIOPIAN_PHONE_REGEX.test(phoneNumber)) {
    return {
      error:
        "Please provide a valid Ethiopian phone number (e.g., 0912345678 or +251912345678).",
    };
  }

  if (!department) {
    return { error: "Department is required." };
  }

  if (!batch || !Object.values(Batch).includes(batch as Batch)) {
    return { error: "Please select a valid batch." };
  }

  if (!campus || !Object.values(Campus).includes(campus as Campus)) {
    return { error: "Please select a valid campus." };
  }

  const campusEnum = campus as Campus;
  const maxYears = CAMPUS_PROGRAM_YEARS[campusEnum] ?? 4;
  if (batch === "YEAR_5" && maxYears < 5) {
    return {
      error: "Year 5 is only available for 5-year campuses (e.g., Five Kilo).",
    };
  }

  if (!gender || (gender !== "MALE" && gender !== "FEMALE")) {
    return { error: "Please select a valid gender." };
  }

  return {
    value: {
      name,
      email,
      phoneNumber,
      department,
      batch: batch as Batch,
      campus: campus as Campus,
      gender: gender as "MALE" | "FEMALE",
    },
  };
};

export const createMember = async (req: Request, res: Response) => {
  try {
    const {
      name,
      email,
      phoneNumber,
      department,
      batch,
      campus,
      isActive,
      gender,
      entryAcademicYear: explicitEntryYear,
      batchOverride,
    } = req.body ?? {};

    const validation = validateMemberPayload({
      name,
      email,
      phoneNumber,
      department,
      batch,
      campus,
      gender,
    });

    if (validation.error) {
      return res.status(400).json({ error: validation.error });
    }

    const validated = validation.value!;

    const existingByEmail = await prisma.member.findUnique({
      where: { email: validated.email },
    });
    if (existingByEmail) {
      return res
        .status(409)
        .json({ error: "A member with that email already exists" });
    }

    const existingByPhone = await prisma.member.findFirst({
      where: { phoneNumber: validated.phoneNumber },
    });
    if (existingByPhone) {
      return res
        .status(409)
        .json({ error: "A member with that phone number already exists" });
    }

    if (
      batchOverride === "YEAR_5" &&
      (CAMPUS_PROGRAM_YEARS[validated.campus] ?? 4) < 5
    ) {
      return res.status(400).json({
        error:
          "Year 5 override is only available for 5-year campuses (e.g., Five Kilo).",
      });
    }

    const currentYear = new Date().getFullYear().toString();
    const existingMembers = await prisma.member.findMany({
      where: { uniqueId: { startsWith: `MEZ-${currentYear}-` } },
      select: { uniqueId: true },
    });
    const uniqueId = getNextMezmurId(existingMembers.map((m) => m.uniqueId));

    const derived = deriveEntryAcademicYearForBackfill(
      { campus: validated.campus, batch: validated.batch },
      new Date(),
    );
    const entryAcademicYear =
      explicitEntryYear !== undefined && explicitEntryYear !== ""
        ? Number(explicitEntryYear)
        : derived.entryAcademicYear;

    const validatedOverride =
      batchOverride && Object.values(Batch).includes(batchOverride as Batch)
        ? (batchOverride as Batch)
        : null;

    const created = await prisma.member.create({
      data: {
        uniqueId,
        name: validated.name,
        email: validated.email,
        phoneNumber: validated.phoneNumber,
        department: validated.department,
        batch: validated.batch,
        campus: validated.campus,
        gender: validated.gender,
        entryAcademicYear,
        batchOverride: validatedOverride,
        isActive: typeof isActive === "boolean" ? isActive : true,
      },
    });

    // Generate QR and send email in background (fire-and-forget)
    (async () => {
      try {
        const qrCode = await generateQrWithLogo(created.uniqueId);
        await sendMemberEmail(
          created.email,
          {
            name: created.name,
            uniqueId: created.uniqueId,
            phoneNumber: created.phoneNumber,
            email: created.email,
            gender: created.gender,
            department: created.department,
            batch: created.batch,
            campus: created.campus,
          },
          qrCode,
        );
      } catch (bgError) {
        console.error(
          `Background task failed for member ${created.id}:`,
          bgError,
        );
      }
    })();

    const effectiveBatch = computeBatch(
      {
        campus: created.campus,
        entryAcademicYear: created.entryAcademicYear ?? 2025,
        batchOverride: created.batchOverride,
      },
      new Date(),
    );

    return res.status(201).json({
      member: {
        ...created,
        effectiveBatch,
        batch: effectiveBatch,
      },
    });
  } catch (err: any) {
    console.error("Error in createMember:", err?.message ?? err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const getAllMembers = async (_req: Request, res: Response) => {
  try {
    const members = await prisma.member.findMany({
      include: {
        _count: {
          select: {
            attendances: { where: { removedAt: null } },
          },
        },
      },
      orderBy: { name: "asc" },
    });

    const now = new Date();
    const mapped = members.map((m) => {
      const entryYear = m.entryAcademicYear ?? 2025;
      const effectiveBatch = computeBatch(
        {
          campus: m.campus,
          entryAcademicYear: entryYear,
          batchOverride: m.batchOverride,
        },
        now,
      );
      return {
        ...m,
        effectiveBatch,
        batch: effectiveBatch,
      };
    });

    return res.status(200).json({ members: mapped });
  } catch (err: any) {
    console.error("Error in getAllMembers:", err?.message ?? err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const getMembersCount = async (_req: Request, res: Response) => {
  try {
    const count = await prisma.member.count();
    return res.status(200).json({ count });
  } catch (err: any) {
    console.error("Error in getMembersCount:", err?.message ?? err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const exportMembersExcel = async (req: Request, res: Response) => {
  try {
    if (!req.admin?.id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const members = await prisma.member.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: {
          select: { attendances: { where: { removedAt: null } } },
        },
      },
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Attendance System";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Members");
    sheet.columns = [
      { header: "Unique ID", key: "uniqueId", width: 18 },
      { header: "Name", key: "name", width: 28 },
      { header: "Email", key: "email", width: 30 },
      { header: "Phone", key: "phoneNumber", width: 18 },
      { header: "Campus", key: "campus", width: 16 },
      { header: "Batch", key: "batch", width: 14 },
      { header: "Department", key: "department", width: 24 },
      { header: "Gender", key: "gender", width: 12 },
      { header: "Status", key: "status", width: 12 },
      { header: "Total Attended", key: "attendedCount", width: 16 },
      { header: "Registered Date", key: "createdAt", width: 20 },
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];

    const now = new Date();
    for (const m of members) {
      const entryYear = m.entryAcademicYear ?? 2025;
      const effectiveBatch = computeBatch(
        {
          campus: m.campus,
          entryAcademicYear: entryYear,
          batchOverride: m.batchOverride,
        },
        now,
      );

      sheet.addRow({
        uniqueId: m.uniqueId,
        name: m.name,
        email: m.email,
        phoneNumber: m.phoneNumber,
        campus: m.campus,
        batch: effectiveBatch,
        department: m.department,
        gender: m.gender,
        status: m.isActive ? "Active" : "Inactive",
        attendedCount: m._count.attendances,
        createdAt: new Date(m.createdAt).toLocaleDateString(),
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    setExcelDownloadHeaders(res, "members_list");
    return res.status(200).send(Buffer.from(buffer));
  } catch (err: any) {
    console.error("Error in exportMembersExcel:", err?.message ?? err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const getMemberById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const idStr = Array.isArray(id) ? id[0] : id;
    if (!idStr) return res.status(400).json({ error: "Member id is required" });

    const member = await prisma.member.findUnique({
      where: { id: idStr },
      include: {
        _count: {
          select: { attendances: { where: { removedAt: null } } },
        },
      },
    });
    if (!member) return res.status(404).json({ error: "Member not found" });

    const now = new Date();
    const entryYear = member.entryAcademicYear ?? 2025;
    const effectiveBatch = computeBatch(
      {
        campus: member.campus,
        entryAcademicYear: entryYear,
        batchOverride: member.batchOverride,
      },
      now,
    );

    const totalAttended = member._count?.attendances ?? 0;

    const totalPastEvents = await prisma.event.count({
      where: {
        cancelledAt: null,
        OR: [
          { endedAt: { lte: now } },
          { endTime: { lte: now } },
          { eventDate: { lt: now } },
        ],
      },
    });

    const totalMissed = Math.max(0, totalPastEvents - totalAttended);
    const percentage =
      totalPastEvents > 0
        ? Math.round((totalAttended / totalPastEvents) * 100)
        : 0;

    // Recent attendance records
    const recentAttendances = await prisma.attendance.findMany({
      where: { memberId: idStr, removedAt: null },
      include: { event: { select: { title: true, startTime: true } } },
      orderBy: { markedAt: "desc" },
      take: 10,
    });

    const recentRecords = recentAttendances.map((a) => {
      let statusStr = "Present";
      if (a.status === "LATE") statusStr = "Late";
      else if (a.status === "EXCUSED") statusStr = "Excused";

      return {
        id: a.id,
        eventId: a.eventId,
        eventName: a.event?.title ?? "Unknown Event",
        markedAt: a.markedAt,
        status: statusStr,
      };
    });

    // Participation per study (e.g. "Epiphany 2027: 6/8")
    const studies = await prisma.study.findMany({
      include: {
        events: {
          where: { cancelledAt: null },
          select: { id: true, title: true, startTime: true, endTime: true },
        },
      },
      orderBy: { startDate: "desc" },
    });

    const memberAttendances = await prisma.attendance.findMany({
      where: { memberId: idStr, removedAt: null },
      select: { eventId: true, status: true },
    });
    const attendedEventIdMap = new Map<string, string>();
    for (const a of memberAttendances) {
      attendedEventIdMap.set(a.eventId, a.status);
    }

    const studyParticipation = studies.map((study) => {
      const totalSessions = study.events.length;
      let attendedSessions = 0;
      let lateSessions = 0;
      let excusedSessions = 0;

      for (const ev of study.events) {
        const attStatus = attendedEventIdMap.get(ev.id);
        if (attStatus === "PRESENT") attendedSessions++;
        else if (attStatus === "LATE") {
          attendedSessions++;
          lateSessions++;
        } else if (attStatus === "EXCUSED") {
          excusedSessions++;
        }
      }

      const denominator = totalSessions - excusedSessions;
      const rate =
        denominator > 0
          ? Math.round((attendedSessions / denominator) * 100)
          : null;

      return {
        studyId: study.id,
        studyName: study.name,
        attendedSessions,
        lateSessions,
        excusedSessions,
        totalSessions,
        attendanceRate: rate,
        summary: `${study.name}: ${attendedSessions}/${totalSessions}`,
        isCompleted:
          study.requiredSessions !== null
            ? attendedSessions >= study.requiredSessions
            : attendedSessions === totalSessions && totalSessions > 0,
      };
    });

    const memberForResponse = {
      ...member,
      effectiveBatch,
      batch: effectiveBatch,
      studyParticipation,
      attendanceData: {
        totalAttended,
        totalMissed,
        percentage,
        recentRecords,
        studyParticipation,
      },
    };

    return res.status(200).json({ member: memberForResponse });
  } catch (err: any) {
    console.error("Error in getMemberById:", err?.message ?? err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const getMemberAttendanceDetails = async (
  req: Request,
  res: Response,
) => {
  try {
    const { id } = req.params;
    const idStr = Array.isArray(id) ? id[0] : id;
    if (!idStr) {
      return res.status(400).json({ error: "Member id is required" });
    }

    const member = await prisma.member.findUnique({
      where: { id: idStr },
      select: { id: true, isActive: true },
    });

    if (!member) {
      return res.status(404).json({ error: "Member not found" });
    }

    const now = new Date();

    const attendances = await prisma.attendance.findMany({
      where: {
        memberId: idStr,
        removedAt: null,
        event: {
          cancelledAt: null,
          OR: [{ endedAt: { lte: now } }, { endTime: { lte: now } }],
        },
      },
      select: {
        id: true,
        markedAt: true,
        status: true,
        excuseReason: true,
        event: {
          select: {
            id: true,
            title: true,
            eventDate: true,
            startTime: true,
            endTime: true,
            recurrenceIndex: true,
            sessionType: true,
            study: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { markedAt: "desc" },
    });

    const missedEvents = await prisma.event.findMany({
      where: {
        cancelledAt: null,
        OR: [{ endedAt: { lte: now } }, { endTime: { lte: now } }],
        attendances: {
          none: {
            memberId: idStr,
            removedAt: null,
          },
        },
      },
      select: {
        id: true,
        title: true,
        eventDate: true,
        startTime: true,
        endTime: true,
        recurrenceIndex: true,
        sessionType: true,
        study: { select: { id: true, name: true } },
      },
      orderBy: { eventDate: "desc" },
      take: 50,
    });

    return res.status(200).json({
      attended: attendances.map((a) => ({
        attendanceId: a.id,
        markedAt: a.markedAt,
        status: a.status,
        excuseReason: a.excuseReason,
        event: a.event,
      })),
      missed: missedEvents,
    });
  } catch (err: any) {
    console.error("Error in getMemberAttendanceDetails:", err?.message ?? err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const updateMember = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const idStr = Array.isArray(id) ? id[0] : id;
    if (!idStr) {
      return res.status(400).json({ error: "Member id is required" });
    }

    const {
      name,
      email,
      phoneNumber,
      department,
      batch,
      campus,
      isActive,
      gender,
      entryAcademicYear,
      batchOverride,
    } = req.body ?? {};

    const validation = validateMemberPayload({
      name,
      email,
      phoneNumber,
      department,
      batch,
      campus,
      gender,
    });

    if (validation.error) {
      return res.status(400).json({ error: validation.error });
    }

    const validated = validation.value!;

    const existingMember = await prisma.member.findUnique({
      where: { id: idStr },
    });

    if (!existingMember) {
      return res.status(404).json({ error: "Member not found" });
    }

    const duplicateByEmail = await prisma.member.findFirst({
      where: {
        email: validated.email,
        NOT: { id: idStr },
      },
    });

    if (duplicateByEmail) {
      return res
        .status(409)
        .json({ error: "Another member with that email already exists" });
    }

    const duplicateByPhone = await prisma.member.findFirst({
      where: {
        phoneNumber: validated.phoneNumber,
        NOT: { id: idStr },
      },
    });

    if (duplicateByPhone) {
      return res
        .status(409)
        .json({ error: "Another member with that phone number already exists" });
    }

    const targetCampus = (validated.campus || existingMember.campus) as Campus;
    if (
      batchOverride === "YEAR_5" &&
      (CAMPUS_PROGRAM_YEARS[targetCampus] ?? 4) < 5
    ) {
      return res.status(400).json({
        error:
          "Year 5 override is only available for 5-year campuses (e.g., Five Kilo).",
      });
    }

    const validatedOverride =
      batchOverride === null || batchOverride === ""
        ? null
        : Object.values(Batch).includes(batchOverride as Batch)
          ? (batchOverride as Batch)
          : existingMember.batchOverride;

    const updatedMember = await prisma.member.update({
      where: { id: idStr },
      data: {
        name: validated.name,
        email: validated.email,
        phoneNumber: validated.phoneNumber,
        department: validated.department,
        batch: validated.batch,
        campus: validated.campus,
        gender: validated.gender,
        entryAcademicYear:
          entryAcademicYear !== undefined && entryAcademicYear !== ""
            ? Number(entryAcademicYear)
            : existingMember.entryAcademicYear,
        batchOverride: validatedOverride,
        isActive:
          typeof isActive === "boolean" ? isActive : existingMember.isActive,
      },
    });

    const effectiveBatch = computeBatch(
      {
        campus: updatedMember.campus,
        entryAcademicYear: updatedMember.entryAcademicYear ?? 2025,
        batchOverride: updatedMember.batchOverride,
      },
      new Date(),
    );

    return res.status(200).json({
      member: {
        ...updatedMember,
        effectiveBatch,
        batch: effectiveBatch,
      },
    });
  } catch (err: any) {
    console.error("Error in updateMember:", err?.message ?? err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const deactivateMember = async (req: Request, res: Response) => {
  try {
    if (!req.admin?.id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { id } = req.params;
    const idStr = Array.isArray(id) ? id[0] : id;
    if (!idStr) return res.status(400).json({ error: "Member id is required" });

    const existing = await prisma.member.findUnique({ where: { id: idStr } });
    if (!existing) return res.status(404).json({ error: "Member not found" });

    const updated = await prisma.member.update({
      where: { id: idStr },
      data: {
        isActive: false,
        deactivatedAt: new Date(),
      },
    });

    return res.status(200).json({ member: updated });
  } catch (err: any) {
    console.error("Error in deactivateMember:", err?.message ?? err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const activateMember = async (req: Request, res: Response) => {
  try {
    if (!req.admin?.id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { id } = req.params;
    const idStr = Array.isArray(id) ? id[0] : id;
    if (!idStr) return res.status(400).json({ error: "Member id is required" });

    const existing = await prisma.member.findUnique({ where: { id: idStr } });
    if (!existing) return res.status(404).json({ error: "Member not found" });

    const updated = await prisma.member.update({
      where: { id: idStr },
      data: {
        isActive: true,
        deactivatedAt: null,
      },
    });

    return res.status(200).json({ member: updated });
  } catch (err: any) {
    console.error("Error in activateMember:", err?.message ?? err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const resendMemberQr = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const idStr = Array.isArray(id) ? id[0] : id;
    if (!idStr) return res.status(400).json({ error: "Member id is required" });

    const member = await prisma.member.findUnique({
      where: { id: idStr },
    });
    if (!member) return res.status(404).json({ error: "Member not found" });
    if (!member.isActive) {
      return res
        .status(400)
        .json({ error: "Cannot resend QR code for a deactivated member." });
    }

    const LIMIT = 3;
    const WINDOW_MINUTES = 60;
    const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000);

    const recentCount = await (prisma as any).resendLog.count({
      where: {
        memberId: idStr,
        createdAt: { gte: windowStart },
      },
    });

    if (recentCount >= LIMIT) {
      return res.status(429).json({
        error: `Resend limit reached (${LIMIT} per ${WINDOW_MINUTES} minutes). Please try again later.`,
      });
    }

    try {
      const qrCode = await generateQrWithLogo(member.uniqueId);
      await sendMemberEmail(
        member.email,
        {
          name: member.name,
          uniqueId: member.uniqueId,
          phoneNumber: member.phoneNumber,
          email: member.email,
          gender: member.gender,
          department: member.department,
          batch: computeBatch(
            {
              campus: member.campus,
              entryAcademicYear: member.entryAcademicYear ?? 2025,
              batchOverride: member.batchOverride,
            },
            new Date(),
          ),
          campus: member.campus,
        },
        qrCode,
      );

      await (prisma as any).resendLog.create({
        data: { memberId: idStr, type: "QR_EMAIL" },
      });

      const remaining = Math.max(0, LIMIT - (recentCount + 1));
      return res.status(200).json({ message: "QR resent", remaining });
    } catch (sendErr: any) {
      console.error("Failed to resend QR email:", sendErr?.message ?? sendErr);
      return res.status(500).json({ error: "Failed to send QR email" });
    }
  } catch (err: any) {
    console.error("Error in resendMemberQr:", err?.message ?? err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const searchMembers = async (req: Request, res: Response) => {
  try {
    const q = (req.query.q as string) ?? "";
    if (!q)
      return res.status(400).json({ error: "query param 'q' is required" });

    const members = await prisma.member.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { uniqueId: { contains: q, mode: "insensitive" } },
          { phoneNumber: { contains: q, mode: "insensitive" } },
        ],
      },
    });

    const now = new Date();
    const mapped = members.map((m) => {
      const entryYear = m.entryAcademicYear ?? 2025;
      const effectiveBatch = computeBatch(
        {
          campus: m.campus,
          entryAcademicYear: entryYear,
          batchOverride: m.batchOverride,
        },
        now,
      );
      return {
        ...m,
        effectiveBatch,
        batch: effectiveBatch,
      };
    });

    return res.status(200).json({ members: mapped });
  } catch (err: any) {
    console.error("Error in searchMembers:", err?.message ?? err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * GET /api/members/promote-preview
 * SUPER_ADMIN preview of members whose batch changes or who graduate this academic year.
 */
export const getPromotePreview = async (_req: Request, res: Response) => {
  try {
    const members = await prisma.member.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        uniqueId: true,
        campus: true,
        batch: true,
        entryAcademicYear: true,
        batchOverride: true,
      },
      orderBy: { name: "asc" },
    });

    const now = new Date();
    // Academic year runs startMonth to startMonth.
    // Next academic year date: 1 year ahead
    const nextAcademicDate = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());

    const preview = members.map((m) => {
      const entryYear = m.entryAcademicYear ?? 2025;
      const currentBatch = computeBatch(
        {
          campus: m.campus,
          entryAcademicYear: entryYear,
          batchOverride: m.batchOverride,
        },
        now,
      );
      const nextBatch = computeBatch(
        {
          campus: m.campus,
          entryAcademicYear: entryYear,
          batchOverride: m.batchOverride,
        },
        nextAcademicDate,
      );

      return {
        id: m.id,
        name: m.name,
        uniqueId: m.uniqueId,
        campus: m.campus,
        currentBatch,
        nextBatch,
        isPromoting: currentBatch !== nextBatch && nextBatch !== Batch.GRADUATE,
        isGraduating:
          currentBatch !== Batch.GRADUATE && nextBatch === Batch.GRADUATE,
        hasOverride: Boolean(m.batchOverride),
      };
    });

    const graduatingMembers = preview.filter((p) => p.isGraduating);
    const promotingMembers = preview.filter((p) => p.isPromoting);

    return res.status(200).json({
      preview,
      summary: {
        totalActive: members.length,
        graduatingCount: graduatingMembers.length,
        promotingCount: promotingMembers.length,
      },
    });
  } catch (err: any) {
    console.error("Error in getPromotePreview:", err?.message ?? err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export default {
  createMember,
  getAllMembers,
  getMembersCount,
  exportMembersExcel,
  getMemberById,
  getMemberAttendanceDetails,
  updateMember,
  deactivateMember,
  activateMember,
  resendMemberQr,
  searchMembers,
  getPromotePreview,
};
