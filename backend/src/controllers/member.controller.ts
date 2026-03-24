import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { getNextMezmurId } from "../utils/idGenerator";
import { sendMemberEmail } from "../utils/email.service";
import { generateQrWithLogo } from "../utils/qrCodeGenerator";

const prisma = new PrismaClient();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ETHIOPIAN_PHONE_REGEX = /^\+?[0-9]{10,13}$/;

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

  if (!campus) {
    return { error: "Campus must be selected." };
  }

  if (!department) {
    return { error: "Department must be selected." };
  }

  if (!batch) {
    return { error: "Batch must be selected." };
  }

  if (!ETHIOPIAN_PHONE_REGEX.test(phoneNumber)) {
    return {
      error:
        "Phone number must contain only digits or '+' and match 0912345678 or +251912345678.",
    };
  }

  if (!(phoneNumber.length === 10 || phoneNumber.length === 13)) {
    return {
      error:
        "Phone number must be 10 digits for local numbers or 13 characters with +251.",
    };
  }

  if (!gender) {
    return { error: "Gender is required." };
  }

  if (gender !== "MALE" && gender !== "FEMALE") {
    return { error: "Gender must be either MALE or FEMALE." };
  }

  return {
    value: {
      name,
      email,
      phoneNumber,
      department,
      batch,
      campus,
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

    // Optionally ensure email uniqueness
    const existingByEmail = await prisma.member.findUnique({
      where: { email: validated.email },
    });
    if (existingByEmail) {
      return res
        .status(409)
        .json({ error: "A member with that email already exists" });
    }

    const currentYear = new Date().getFullYear().toString();
    const existingMembers = await prisma.member.findMany({
      where: { uniqueId: { startsWith: `MEZ-${currentYear}-` } },
      select: { uniqueId: true },
    });
    const uniqueId = getNextMezmurId(existingMembers.map((m) => m.uniqueId));

    const created = await prisma.member.create({
      data: {
        uniqueId,
        name: validated.name,
        email: validated.email,
        phoneNumber: validated.phoneNumber,
        department: validated.department as any,
        batch: validated.batch as any,
        campus: validated.campus as any,
        gender: validated.gender as any,
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

    // Member model doesn't contain sensitive fields by design; return created record
    return res.status(201).json({ member: created });
  } catch (err: any) {
    console.error("Error in createMember:", err?.message ?? err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const getAllMembers = async (_req: Request, res: Response) => {
  try {
    // include attendance counts so frontend can show attendance numbers
    const members = await prisma.member.findMany({
      include: { _count: { select: { attendances: true } } },
    });
    return res.status(200).json({ members });
  } catch (err: any) {
    console.error("Error in getAllMembers:", err?.message ?? err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const getMemberById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const idStr = Array.isArray(id) ? id[0] : id;
    if (!idStr) return res.status(400).json({ error: "Member id is required" });

    // Fetch member and include attendance count
    const member = await prisma.member.findUnique({
      where: { id: idStr },
      include: {
        _count: { select: { attendances: true } },
      },
    });
    if (!member) return res.status(404).json({ error: "Member not found" });

    // Compute attendance aggregates and recent records for frontend convenience
    const totalAttended = member._count?.attendances ?? 0;

    // Count only past events (ended) to derive missed count/percentage
    const now = new Date();
    const totalPastEvents = await prisma.event.count({
      where: {
        OR: [
          // explicitly manually closed events
          { endedAt: { lte: now } },
          // events with an endTime that already passed
          { endTime: { lte: now } },
          // events whose eventDate is in the past (fallback)
          { eventDate: { lt: now } },
        ],
      },
    });

    const totalMissed = Math.max(0, totalPastEvents - totalAttended);
    const percentage =
      totalPastEvents > 0
        ? Math.round((totalAttended / totalPastEvents) * 100)
        : 0;

    // Recent attendance records (last 5) with event title and markedAt
    const recentAttendances = await prisma.attendance.findMany({
      where: { memberId: idStr },
      include: { event: { select: { title: true } } },
      orderBy: { markedAt: "desc" },
      take: 5,
    });

    const recentRecords = recentAttendances.map((a) => ({
      id: a.id,
      eventId: a.eventId,
      eventName: a.event?.title ?? "Unknown Event",
      markedAt: a.markedAt,
      status: "Present",
    }));

    const memberForResponse = {
      ...member,
      attendanceData: {
        totalAttended,
        totalMissed,
        percentage,
        recentRecords,
      },
    };

    return res.status(200).json({ member: memberForResponse });
  } catch (err: any) {
    console.error("Error in getMemberById:", err?.message ?? err);
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

    const updatedMember = await prisma.member.update({
      where: { id: idStr },
      data: {
        name: validated.name,
        email: validated.email,
        phoneNumber: validated.phoneNumber,
        department: validated.department as any,
        batch: validated.batch as any,
        campus: validated.campus as any,
        gender: validated.gender as any,
        isActive:
          typeof isActive === "boolean" ? isActive : existingMember.isActive,
      },
    });

    return res.status(200).json({ member: updatedMember });
  } catch (err: any) {
    console.error("Error in updateMember:", err?.message ?? err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// PATCH /api/members/:id/deactivate
// Sets isActive false for the member. Only SUPER_ADMIN can perform this action (enforced in route middleware).
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
      data: { isActive: false },
    });

    return res.status(200).json({ member: updated });
  } catch (err: any) {
    console.error("Error in deactivateMember:", err?.message ?? err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// PATCH /api/members/:id/activate
// Sets isActive true for the member. Only SUPER_ADMIN can perform this action (enforced in route middleware).
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
      data: { isActive: true },
    });

    return res.status(200).json({ member: updated });
  } catch (err: any) {
    console.error("Error in activateMember:", err?.message ?? err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// POST /api/members/:id/resend-qr
// Generates a fresh QR and emails it to the member. Enforces a weekly limit per member.
export const resendMemberQr = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const idStr = Array.isArray(id) ? id[0] : id;
    if (!idStr) return res.status(400).json({ error: "Member id is required" });

    const member = await prisma.member.findUnique({ where: { id: idStr } });
    if (!member) return res.status(404).json({ error: "Member not found" });

    // Rate limit: max 3 resends per 7-day window
    const WINDOW_DAYS = 7;
    const LIMIT = 3;
    const windowStart = new Date(
      Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );

    const recentCount = await (prisma as any).resendLog.count({
      where: {
        memberId: idStr,
        createdAt: { gte: windowStart },
        type: "QR_EMAIL",
      },
    });

    if (recentCount >= LIMIT) {
      return res.status(429).json({
        error: "Resend limit reached",
        limit: LIMIT,
        windowDays: WINDOW_DAYS,
      });
    }

    // Generate QR and send email (same format as createMember)
    try {
      const qrBase64 = await generateQrWithLogo(member.uniqueId);
      await sendMemberEmail(
        member.email,
        {
          name: member.name,
          uniqueId: member.uniqueId,
          phoneNumber: member.phoneNumber,
        },
        qrBase64,
      );

      // log the resend
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

    return res.status(200).json({ members });
  } catch (err: any) {
    console.error("Error in searchMembers:", err?.message ?? err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export default {
  createMember,
  getAllMembers,
  getMemberById,
  updateMember,
  deactivateMember,
  activateMember,
  resendMemberQr,
  searchMembers,
};
