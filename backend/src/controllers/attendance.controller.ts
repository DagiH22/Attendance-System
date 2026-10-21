import { Request, Response } from "express";
import { PrismaClient, MarkMethod, AttendanceStatus } from "@prisma/client";
import { computeEventLifecycle } from "../services/event-lifecycle.service";
import {
  computeLatenessStatus,
  resolveLateGraceMinutes,
} from "../services/academic.service";

const prisma = new PrismaClient();

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/attendance
 * Body: { memberUniqueId?: string, memberId?: string, eventId: string, markedMethod?: 'QR'|'MANUAL', method?: 'QR'|'MANUAL', status?: AttendanceStatus, excuseReason?: string, allowOverride?: boolean }
 */
export const markAttendance = async (req: Request, res: Response) => {
  try {
    if (!req.admin?.id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const {
      memberUniqueId,
      memberId,
      code,
      eventId,
      markedMethod,
      method,
      status: explicitStatus,
      excuseReason,
      allowOverride,
    } = req.body ?? {};

    const rawIdentifier = memberUniqueId ?? memberId ?? code;
    const normalizedMemberIdentifier =
      typeof rawIdentifier === "string" ? rawIdentifier.trim() : "";

    const inferredMethod = code ? "QR" : "MANUAL";
    const normalizedMethod = (markedMethod ?? method ?? inferredMethod) as MarkMethod;

    if (!normalizedMemberIdentifier || !eventId) {
      return res.status(400).json({
        error:
          "memberUniqueId or memberId or code, and eventId are required",
      });
    }

    if (!Object.values(MarkMethod).includes(normalizedMethod)) {
      return res
        .status(400)
        .json({ error: "markedMethod or method must be 'QR' or 'MANUAL'" });
    }

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
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: { study: true },
    });
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    if (event.cancelledAt) {
      return res
        .status(400)
        .json({ error: "Cannot mark attendance on a cancelled session" });
    }

    const lifecycle = computeEventLifecycle(event);
    const isOverrideRequested = allowOverride === true;
    const isAdminOverrideAllowed =
      req.admin?.role === "ADMIN" || req.admin?.role === "SUPER_ADMIN";

    if (
      !lifecycle.attendanceOpen &&
      !(isOverrideRequested && isAdminOverrideAllowed)
    ) {
      return res.status(400).json({
        error:
          lifecycle.status === "CANCELLED"
            ? "Event is cancelled"
            : lifecycle.status === "DEACTIVATED"
              ? "Event is deactivated"
              : "Attendance is only allowed while the event is ACTIVE",
      });
    }

    if (isOverrideRequested && !isAdminOverrideAllowed) {
      return res.status(403).json({
        error: "Only admins can override attendance restrictions",
      });
    }

    // 3. Determine status (PRESENT, LATE, EXCUSED)
    let finalStatus: AttendanceStatus;
    if (
      explicitStatus &&
      Object.values(AttendanceStatus).includes(explicitStatus)
    ) {
      finalStatus = explicitStatus;
    } else {
      const grace = resolveLateGraceMinutes(event, event.study);
      const now = new Date();
      finalStatus = computeLatenessStatus(event.startTime, now, grace);
    }

    // 4. Check if record already exists (support revival of soft-deleted records)
    const existing = await prisma.attendance.findUnique({
      where: {
        memberId_eventId_unique: {
          memberId: member.id,
          eventId: event.id,
        },
      },
    });

    if (existing) {
      if (existing.removedAt !== null) {
        // Revive soft-removed record
        const revived = await prisma.attendance.update({
          where: { id: existing.id },
          data: {
            markedById: req.admin.id,
            markedMethod: normalizedMethod,
            markedAt: new Date(),
            status: finalStatus,
            excuseReason: excuseReason || null,
            removedAt: null,
            removedById: null,
            removeReason: null,
          },
        });

        return res.status(200).json({
          message: "Attendance recorded successfully",
          attendance: revived,
          member: {
            id: member.id,
            uniqueId: member.uniqueId,
            name: member.name,
            phoneNumber: member.phoneNumber,
          },
        });
      }

      // Record is already active
      return res.status(409).json({ error: "Member already marked present" });
    }

    // 5. Create new attendance
    const created = await prisma.attendance.create({
      data: {
        memberId: member.id,
        eventId: event.id,
        markedById: req.admin.id,
        markedMethod: normalizedMethod,
        status: finalStatus,
        excuseReason: excuseReason || null,
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
    if (err?.code === "P2002") {
      return res.status(409).json({ error: "Member already marked present" });
    }

    console.error("Error in markAttendance:", err?.message ?? err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * POST /api/attendance/excuse
 * Body: { memberId: string, eventId: string, reason: string }
 * Mark a member EXCUSED for an event, even if they never checked in.
 */
export const excuseMember = async (req: Request, res: Response) => {
  try {
    if (!req.admin?.id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { memberId, eventId, reason } = req.body ?? {};
    if (!memberId || !eventId) {
      return res.status(400).json({ error: "memberId and eventId are required" });
    }

    const isUuid = uuidRegex.test(memberId);
    const member = await prisma.member.findFirst({
      where: isUuid
        ? { OR: [{ id: memberId }, { uniqueId: memberId }] }
        : { uniqueId: memberId },
    });

    if (!member) {
      return res.status(404).json({ error: "Member not found" });
    }

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    const existing = await prisma.attendance.findUnique({
      where: {
        memberId_eventId_unique: {
          memberId: member.id,
          eventId: event.id,
        },
      },
    });

    let record;
    if (existing) {
      record = await prisma.attendance.update({
        where: { id: existing.id },
        data: {
          status: AttendanceStatus.EXCUSED,
          excuseReason: reason ? String(reason).trim() : "Excused by admin",
          markedById: req.admin.id,
          markedMethod: MarkMethod.MANUAL,
          markedAt: new Date(),
          removedAt: null,
          removedById: null,
          removeReason: null,
        },
      });
    } else {
      record = await prisma.attendance.create({
        data: {
          memberId: member.id,
          eventId: event.id,
          markedById: req.admin.id,
          markedMethod: MarkMethod.MANUAL,
          status: AttendanceStatus.EXCUSED,
          excuseReason: reason ? String(reason).trim() : "Excused by admin",
        },
      });
    }

    return res.status(200).json({
      message: "Member marked as excused successfully",
      attendance: record,
      member: {
        id: member.id,
        name: member.name,
        uniqueId: member.uniqueId,
      },
    });
  } catch (err: any) {
    console.error("Error in excuseMember:", err?.message ?? err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
};

/**
 * PATCH /api/attendance/:id/undo (or DELETE /api/attendance/:id)
 * Body: { reason?: string }
 * Soft deletes a mistaken attendance record.
 */
export const undoAttendance = async (req: Request, res: Response) => {
  try {
    if (!req.admin?.id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { id } = req.params;
    const idStr = Array.isArray(id) ? id[0] : id;
    if (!idStr) {
      return res.status(400).json({ error: "Attendance id is required" });
    }
    const { reason } = req.body ?? {};

    const existing = await prisma.attendance.findUnique({ where: { id: idStr } });
    if (!existing) {
      return res.status(404).json({ error: "Attendance record not found" });
    }

    const updated = await prisma.attendance.update({
      where: { id: idStr },
      data: {
        removedAt: new Date(),
        removedById: req.admin.id,
        removeReason: reason ? String(reason).trim() : "Undone by admin",
      },
    });

    return res.status(200).json({
      message: "Attendance mark undone successfully",
      attendance: updated,
    });
  } catch (err: any) {
    console.error("Error in undoAttendance:", err?.message ?? err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
};

/**
 * PATCH /api/attendance/:id/status
 * Body: { status: 'PRESENT'|'LATE'|'EXCUSED', excuseReason?: string }
 */
export const updateAttendanceStatus = async (req: Request, res: Response) => {
  try {
    if (!req.admin?.id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { id } = req.params;
    const idStr = Array.isArray(id) ? id[0] : id;
    if (!idStr) {
      return res.status(400).json({ error: "Attendance id is required" });
    }
    const { status, excuseReason } = req.body ?? {};

    if (!status || !Object.values(AttendanceStatus).includes(status)) {
      return res.status(400).json({
        error: "Valid status (PRESENT, LATE, EXCUSED) is required",
      });
    }

    const existing = await prisma.attendance.findUnique({ where: { id: idStr } });
    if (!existing) {
      return res.status(404).json({ error: "Attendance record not found" });
    }

    const updated = await prisma.attendance.update({
      where: { id: idStr },
      data: {
        status,
        excuseReason: status === "EXCUSED" ? (excuseReason || existing.excuseReason || "Excused") : null,
      },
    });

    return res.status(200).json({
      message: "Attendance status updated successfully",
      attendance: updated,
    });
  } catch (err: any) {
    console.error("Error in updateAttendanceStatus:", err?.message ?? err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
};

export default {
  markAttendance,
  excuseMember,
  undoAttendance,
  updateAttendanceStatus,
};
