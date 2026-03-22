import { Request, Response } from "express";
import { PrismaClient, MarkMethod } from "@prisma/client";
import { computeEventLifecycle } from "../services/event-lifecycle.service";

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

    const { memberUniqueId, memberId, eventId, markedMethod, method } =
      req.body ?? {};

    const normalizedMemberIdentifier =
      typeof memberUniqueId === "string" && memberUniqueId.trim() !== ""
        ? memberUniqueId.trim()
        : typeof memberId === "string" && memberId.trim() !== ""
          ? memberId.trim()
          : "";
    const normalizedMethod = markedMethod ?? method;

    if (!normalizedMemberIdentifier || !eventId || !normalizedMethod) {
      return res.status(400).json({
        error:
          "memberUniqueId or memberId, eventId and markedMethod or method are required",
      });
    }

    if (!Object.values(MarkMethod).includes(normalizedMethod)) {
      return res
        .status(400)
        .json({ error: "markedMethod or method must be 'QR' or 'MANUAL'" });
    }

    // Is the identifier a valid UUID?
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const isUuid = uuidRegex.test(normalizedMemberIdentifier);

    // 1. Find member by UUID id or public uniqueId
    const member = await prisma.member.findFirst({
      where: isUuid
        ? {
            OR: [
              { id: normalizedMemberIdentifier },
              { uniqueId: normalizedMemberIdentifier },
            ],
          }
        : { uniqueId: normalizedMemberIdentifier },
    });

    if (!member) {
      return res.status(404).json({ error: "Member not found" });
    }

    // 1b. Prevent marking attendance for deactivated members
    if (!member.isActive) {
      return res.status(403).json({ error: "Member is deactivated" });
    }

    // 2. Ensure event exists and attendance is currently open
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }
    const lifecycle = computeEventLifecycle(event);
    if (!lifecycle.attendanceOpen) {
      return res.status(400).json({
        error:
          lifecycle.status === "DEACTIVATED"
            ? "Event is deactivated"
            : "Attendance is only allowed while the event is ACTIVE",
      });
    }

    // 3. Create attendance
    const created = await prisma.attendance.create({
      data: {
        memberId: member.id,
        eventId: event.id,
        markedById: req.admin.id,
        markedMethod: normalizedMethod,
      },
    });

    return res.status(201).json({
      message: "Attendance marked successfully",
      attendance: created,
      member: {
        id: member.id,
        uniqueId: member.uniqueId,
        name: member.name,
        phoneNumber: member.phoneNumber,
      },
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
