import { Request, Response } from "express";
import { PrismaClient, MarkMethod } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * POST /api/attendance
 * Body: { memberUniqueId: string, eventId: string, markedMethod: 'QR'|'MANUAL' }
 */
export const markAttendance = async (req: Request, res: Response) => {
  try {
    if (!req.admin?.id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { memberUniqueId, eventId, markedMethod } = req.body ?? {};

    if (!memberUniqueId || !eventId || !markedMethod) {
      return res.status(400).json({
        error: "memberUniqueId, eventId and markedMethod are required",
      });
    }

    if (!Object.values(MarkMethod).includes(markedMethod)) {
      return res
        .status(400)
        .json({ error: "markedMethod must be 'QR' or 'MANUAL'" });
    }

    // 1. Find member by uniqueId
    const member = await prisma.member.findUnique({
      where: { uniqueId: memberUniqueId },
    });
    if (!member) {
      return res.status(404).json({ error: "Member not found" });
    }

    // 2. Ensure event exists and is active
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }
    if (!event.isActive) {
      return res.status(400).json({ error: "Event is not active" });
    }

    // 3. Create attendance
    const created = await prisma.attendance.create({
      data: {
        memberId: member.id,
        eventId: event.id,
        markedById: req.admin.id,
        markedMethod,
      },
    });

    return res.status(201).json({
      message: "Attendance marked successfully",
      attendance: created,
    });
  } catch (err: any) {
    // 4. Unique constraint (memberId, eventId)
    // prisma unique constraint error code: P2002
    if (err?.code === "P2002") {
      return res.status(409).json({ error: "Member already marked present" });
    }

    console.error("Error in markAttendance:", err?.message ?? err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export default { markAttendance };
