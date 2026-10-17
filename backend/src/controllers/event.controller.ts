import { Request, Response } from "express";
import { PrismaClient, EventType, SessionType } from "@prisma/client";
import ExcelJS from "exceljs";
import { setExcelDownloadHeaders } from "../utils/excelExport";
import {
  computeEventLifecycle,
  serializeEventForResponse,
  type EventStatus,
} from "../services/event-lifecycle.service";
import recurrenceService, { normalizeToDateOnly } from "../services/recurrence.service";
import {
  getEligibleMembers,
  getEventStats,
  computeBatch,
} from "../services/academic.service";

const prisma = new PrismaClient() as PrismaClient & { eventCluster: any };

type ClusterEventInput = {
  eventDate: Date;
  startTime: Date;
  endTime: Date;
  label?: string | null;
};

const validateEventPayload = (payload: {
  title?: unknown;
  description?: unknown;
  eventDate?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  location?: unknown;
}) => {
  const title = String(payload.title ?? "").trim();
  const description = String(payload.description ?? "").trim();
  const location = String(payload.location ?? "").trim();

  if (!title) {
    return { error: "Event title is required" };
  }

  if (!description) {
    return { error: "Event description is required" };
  }

  if (!payload.eventDate) {
    return { error: "Event date is required" };
  }

  if (!payload.startTime) {
    return { error: "Event start time is required" };
  }

  if (!payload.endTime) {
    return { error: "Event end time is required" };
  }

  if (!location) {
    return { error: "Event location is required" };
  }

  return {
    value: {
      title,
      description,
      location,
    },
  };
};

const validateClusterPayload = (payload: {
  title?: unknown;
  description?: unknown;
  location?: unknown;
}) => {
  const title = String(payload.title ?? "").trim();
  const description = String(payload.description ?? "").trim();
  const location = String(payload.location ?? "").trim();

  if (!title) {
    return { error: "Event title is required" };
  }

  if (!description) {
    return { error: "Event description is required" };
  }

  if (!location) {
    return { error: "Event location is required" };
  }

  return {
    value: {
      title,
      description,
      location,
    },
  };
};

const parseClusterEvents = (clusterEvents: unknown) => {
  if (!Array.isArray(clusterEvents) || clusterEvents.length === 0) {
    return { error: "At least one cluster event is required" };
  }

  const parsed: ClusterEventInput[] = [];

  for (const [index, rawEvent] of clusterEvents.entries()) {
    const eventDateValue = (rawEvent as any)?.eventDate;
    const startTimeValue = (rawEvent as any)?.startTime;
    const endTimeValue = (rawEvent as any)?.endTime;
    const labelValue = (rawEvent as any)?.label;

    const eventDate = new Date(eventDateValue);
    const startTime = new Date(startTimeValue);
    const endTime = new Date(endTimeValue);

    if (
      Number.isNaN(eventDate.getTime()) ||
      Number.isNaN(startTime.getTime()) ||
      Number.isNaN(endTime.getTime())
    ) {
      return { error: `Invalid date/time for cluster event #${index + 1}` };
    }

    if (endTime <= startTime) {
      return {
        error: `End time must be after start time for cluster event #${index + 1}`,
      };
    }

    parsed.push({
      eventDate,
      startTime,
      endTime,
      label:
        typeof labelValue === "string" && labelValue.trim() !== ""
          ? labelValue.trim()
          : null,
    });
  }

  return { value: parsed };
};

// Role checks are enforced with requireRole middleware at the route level

/**
 * POST /api/events
 * Body: { title: string, description?: string, eventDate: string|Date, startTime: string|Date, endTime: string|Date, type?: EventType }
 * Only SUPER_ADMIN
 */
export const createEvent = async (req: Request, res: Response) => {
  try {
    if (!req.admin?.id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const adminId = req.admin.id;

    // role enforced by requireRole middleware

    const {
      title,
      description,
      eventDate,
      startTime,
      endTime,
      type,
      location,
      clusterEvents,
    } = req.body ?? {};

    const isClusterRequest =
      Array.isArray(clusterEvents) && clusterEvents.length > 0;

    const validation = isClusterRequest
      ? validateClusterPayload({ title, description, location })
      : validateEventPayload({
          title,
          description,
          eventDate,
          startTime,
          endTime,
          location,
        });

    if (validation.error) {
      return res.status(400).json({ error: validation.error });
    }

    const validated = validation.value!;

    if (isClusterRequest) {
      const parsedClusterEvents = parseClusterEvents(clusterEvents);
      if (parsedClusterEvents.error) {
        return res.status(400).json({ error: parsedClusterEvents.error });
      }

      const clusterEventValues = parsedClusterEvents.value!;
      const sortedByDate = [...clusterEventValues].sort(
        (a, b) => a.eventDate.getTime() - b.eventDate.getTime(),
      );
      const clusterStartDate = sortedByDate[0].eventDate;
      const clusterEndDate = sortedByDate[sortedByDate.length - 1].eventDate;

      const cluster = await prisma.eventCluster.create({
        data: {
          title: validated.title,
          description: validated.description,
          location: validated.location,
          startDate: clusterStartDate,
          endDate: clusterEndDate,
          createdById: adminId,
          events: {
            create: clusterEventValues.map((entry) => ({
              title: validated.title,
              description: validated.description,
              location: validated.location,
              eventDate: entry.eventDate,
              startTime: entry.startTime,
              endTime: entry.endTime,
              clusterLabel: entry.label,
              type: EventType.ONE_TIME,
              createdById: adminId,
            })) as any,
          },
        },
        include: {
          events: {
            include: { _count: { select: { attendances: true } } },
          },
        },
      });

      return res.status(201).json({
        cluster: {
          ...cluster,
          startDate: cluster.startDate.toISOString(),
          endDate: cluster.endDate.toISOString(),
        },
        events: cluster.events.map((event: any) =>
          serializeEventForResponse({
            ...event,
            cluster: {
              id: cluster.id,
              title: cluster.title,
              startDate: cluster.startDate,
              endDate: cluster.endDate,
            },
          }),
        ),
      });
    }

    const parsedEventDate = new Date(eventDate);
    const parsedStartTime = new Date(startTime);
    const parsedEndTime = new Date(endTime);

    if (
      Number.isNaN(parsedEventDate.getTime()) ||
      Number.isNaN(parsedStartTime.getTime()) ||
      Number.isNaN(parsedEndTime.getTime())
    ) {
      return res.status(400).json({ error: "Invalid date/time format" });
    }

    const eventType: EventType =
      type && Object.values(EventType).includes(type)
        ? type
        : EventType.ONE_TIME;

    // validate location string
    if (typeof location !== "string" || location.trim() === "") {
      return res
        .status(400)
        .json({ error: "location must be a non-empty string" });
    }

    const studyId = req.body.studyId || null;
    const sessionType = req.body.sessionType || SessionType.EVENING;
    const lateGraceMinutes = req.body.lateGraceMinutes ? Number(req.body.lateGraceMinutes) : null;

    if (eventType === EventType.WEEKLY) {
      // create a parent recurring event and child occurrences
      const recurrenceLengthWeeks =
        Number(req.body.recurrenceLengthWeeks ?? 4) || 4;

      const weeklyEndDateRaw = req.body.endDate;
      const parsedWeeklyEndDate = weeklyEndDateRaw
        ? new Date(weeklyEndDateRaw)
        : undefined;
      if (parsedWeeklyEndDate && Number.isNaN(parsedWeeklyEndDate.getTime())) {
        return res.status(400).json({ error: "Invalid endDate format" });
      }

      const { parent, children } = await recurrenceService.createWeeklyEvents(
        prisma,
        {
          adminId,
          title: validated.title,
          description: validated.description,
          startDate: parsedEventDate,
          startTime: parsedStartTime,
          endTime: parsedEndTime,
          endDate: parsedWeeklyEndDate,
          recurrenceLengthWeeks,
          location: validated.location,
          studyId,
          sessionType,
          lateGraceMinutes,
        },
      );

      return res.status(201).json({
        parent: serializeEventForResponse(parent),
        occurrences: children.map((c: any) => serializeEventForResponse(c)),
      });
    }

    const created = await prisma.event.create({
      data: {
        title: validated.title,
        description: validated.description,
        eventDate: parsedEventDate,
        startTime: parsedStartTime,
        endTime: parsedEndTime,
        plannedStartTime: parsedStartTime,
        type: eventType,
        sessionType,
        lateGraceMinutes,
        studyId,
        location: validated.location,
        createdById: adminId,
      },
      include: {
        _count: { select: { attendances: true } },
        study: {
          select: { id: true, name: true, startDate: true, endDate: true },
        },
        cluster: {
          select: { id: true, title: true, startDate: true, endDate: true },
        },
      } as any,
    });

    return res.status(201).json({ event: serializeEventForResponse(created) });
  } catch (err: any) {
    console.error("Error in createEvent:", err?.message ?? err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// GET /api/events?offset=0&limit=30

export const getAllEvents = async (req: Request, res: Response) => {
  try {
    const rawOffset = Number(req.query.offset ?? 0);
    const rawLimit = Number(req.query.limit ?? 30);

    const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
    const limit =
      Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 30;

    const requestedStudyId =
      typeof req.query.studyId === "string" ? req.query.studyId.trim() : undefined;
    const requestedSessionType =
      typeof req.query.sessionType === "string"
        ? req.query.sessionType.trim()
        : undefined;
    const requestedStatus =
      typeof req.query.status === "string" ? req.query.status.trim() : undefined;

    const filterWhere: any = {};
    if (requestedStudyId) {
      if (requestedStudyId.toLowerCase() === "standalone") {
        filterWhere.studyId = null;
      } else {
        filterWhere.studyId = requestedStudyId;
      }
    }
    if (
      requestedSessionType &&
      Object.values(SessionType).includes(requestedSessionType as any)
    ) {
      filterWhere.sessionType = requestedSessionType as SessionType;
    }

    const now = new Date();

    const eventInclude = {
      _count: {
        select: { attendances: { where: { removedAt: null } } },
      },
      study: {
        select: {
          id: true,
          name: true,
          startDate: true,
          endDate: true,
          audienceType: true,
          requiredSessions: true,
        },
      },
      cluster: {
        select: { id: true, title: true, startDate: true, endDate: true },
      },
    };

    const [
      upcomingCandidates,
      activeCandidates,
      deactivatedEvents,
      pastCandidates,
      cancelledCandidates,
    ] = await Promise.all([
      // upcoming: future startTime, active, not cancelled
      prisma.event.findMany({
        where: {
          NOT: { AND: [{ type: EventType.WEEKLY }, { recurrenceIndex: null }] },
          isActive: true,
          cancelledAt: null,
          startTime: { gt: now },
          ...filterWhere,
        },
        orderBy: [{ startTime: "asc" }, { eventDate: "asc" }],
        include: eventInclude as any,
      }),
      // active candidates: startTime <= now, active, not cancelled
      prisma.event.findMany({
        where: {
          NOT: { AND: [{ type: EventType.WEEKLY }, { recurrenceIndex: null }] },
          isActive: true,
          cancelledAt: null,
          startTime: { lte: now },
          ...filterWhere,
        },
        orderBy: [{ startTime: "asc" }, { eventDate: "asc" }],
        include: eventInclude as any,
      }),
      // deactivated: explicit isActive === false, not cancelled
      prisma.event.findMany({
        where: {
          NOT: { AND: [{ type: EventType.WEEKLY }, { recurrenceIndex: null }] },
          isActive: false,
          cancelledAt: null,
          ...filterWhere,
        },
        orderBy: [{ eventDate: "asc" }, { startTime: "asc" }],
        include: eventInclude as any,
      }),
      // past candidates: endTime < now, active, not cancelled
      prisma.event.findMany({
        where: {
          NOT: { AND: [{ type: EventType.WEEKLY }, { recurrenceIndex: null }] },
          isActive: true,
          cancelledAt: null,
          endTime: { lt: now },
          ...filterWhere,
        },
        orderBy: [{ endTime: "desc" }, { eventDate: "desc" }],
        include: eventInclude as any,
      }),
      // cancelled candidates
      prisma.event.findMany({
        where: {
          NOT: { AND: [{ type: EventType.WEEKLY }, { recurrenceIndex: null }] },
          cancelledAt: { not: null },
          ...filterWhere,
        },
        orderBy: [{ cancelledAt: "desc" }, { startTime: "desc" }],
        include: eventInclude as any,
      }),
    ]);

    const idSeen = new Set<string>();
    const ordered: Array<any> = [];

    const classifyAndPush = (evs: any[], expectedStatuses: EventStatus[]) => {
      for (const event of evs) {
        if (idSeen.has(event.id)) continue;

        const lifecycle = computeEventLifecycle(event, now);
        if (!expectedStatuses.includes(lifecycle.status)) {
          continue;
        }

        idSeen.add(event.id);
        ordered.push(serializeEventForResponse(event, now));
      }
    };

    classifyAndPush(activeCandidates, ["ACTIVE"]);
    classifyAndPush(upcomingCandidates, ["ACTIVE", "UPCOMING"]);
    classifyAndPush(pastCandidates, ["PAST"]);
    classifyAndPush(deactivatedEvents, ["DEACTIVATED"]);
    classifyAndPush(cancelledCandidates, ["CANCELLED"]);

    let finalEvents = ordered;
    if (requestedStatus) {
      finalEvents = ordered.filter(
        (e) => e.status.toUpperCase() === requestedStatus.toUpperCase(),
      );
    }

    const totalEvents = finalEvents.length;
    const paginatedEvents = finalEvents.slice(offset, offset + limit);

    return res.status(200).json({
      events: paginatedEvents,
      totalEvents,
      offset,
      limit,
    });
  } catch (err: any) {
    console.error("Error in getAllEvents:", err?.message ?? err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// GET /api/events/:id
export const getEventById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const idStr = Array.isArray(id) ? id[0] : id;
    if (!idStr) return res.status(400).json({ error: "Event id is required" });

    const [event, allMembers] = await Promise.all([
      prisma.event.findUnique({
        where: { id: idStr },
        include: {
          _count: {
            select: { attendances: { where: { removedAt: null } } },
          },
          study: true,
          cluster: {
            select: { id: true, title: true, startDate: true, endDate: true },
          },
        } as any,
      }),
      prisma.member.findMany({
        select: {
          id: true,
          name: true,
          uniqueId: true,
          phoneNumber: true,
          campus: true,
          batch: true,
          entryAcademicYear: true,
          batchOverride: true,
          createdAt: true,
          deactivatedAt: true,
        },
      }),
    ]);
    if (!event) return res.status(404).json({ error: "Event not found" });

    const attendances = await prisma.attendance.findMany({
      where: { eventId: idStr, removedAt: null },
      select: {
        id: true,
        memberId: true,
        eventId: true,
        status: true,
        markedAt: true,
        removedAt: true,
      },
    });

    const eligible = getEligibleMembers(
      event,
      allMembers.map((m) => ({
        ...m,
        entryAcademicYear: m.entryAcademicYear ?? 2025,
      })),
      attendances,
      event.startTime,
    );

    const stats = getEventStats(event, eligible, attendances);

    const attendedMemberIds = new Set(attendances.map((a) => a.memberId));
    const absentees = eligible
      .filter((m) => !attendedMemberIds.has(m.id))
      .map((m) => ({
        id: m.id,
        name: m.name,
        uniqueId: m.uniqueId,
        phoneNumber: m.phoneNumber,
        campus: m.campus,
        batch: computeBatch(
          {
            campus: m.campus,
            entryAcademicYear: m.entryAcademicYear ?? 2025,
            batchOverride: m.batchOverride,
          },
          event.startTime,
        ),
      }));

    const serialized = serializeEventForResponse(event);
    return res.status(200).json({
      event: {
        ...serialized,
        totalMembers: eligible.length,
        stats,
        absentees,
      },
      stats,
      absentees,
    });
  } catch (err: any) {
    console.error("Error in getEventById:", err?.message ?? err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// GET /api/events/:id/absentees
export const getEventAbsentees = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const idStr = Array.isArray(id) ? id[0] : id;
    if (!idStr) return res.status(400).json({ error: "Event id is required" });

    const event = await prisma.event.findUnique({
      where: { id: idStr },
      include: { study: true },
    });
    if (!event) return res.status(404).json({ error: "Event not found" });

    const [allMembers, attendances] = await Promise.all([
      prisma.member.findMany({
        select: {
          id: true,
          name: true,
          uniqueId: true,
          phoneNumber: true,
          campus: true,
          batch: true,
          entryAcademicYear: true,
          batchOverride: true,
          createdAt: true,
          deactivatedAt: true,
        },
      }),
      prisma.attendance.findMany({
        where: { eventId: idStr, removedAt: null },
        select: {
          id: true,
          memberId: true,
          eventId: true,
          status: true,
          markedAt: true,
          removedAt: true,
        },
      }),
    ]);

    const eligible = getEligibleMembers(
      event,
      allMembers.map((m) => ({
        ...m,
        entryAcademicYear: m.entryAcademicYear ?? 2025,
      })),
      attendances,
      event.startTime,
    );

    const stats = getEventStats(event, eligible, attendances);
    const attendedMemberIds = new Set(attendances.map((a) => a.memberId));

    const absentees = eligible
      .filter((m) => !attendedMemberIds.has(m.id))
      .map((m) => ({
        id: m.id,
        name: m.name,
        uniqueId: m.uniqueId,
        phoneNumber: m.phoneNumber,
        campus: m.campus,
        batch: computeBatch(
          {
            campus: m.campus,
            entryAcademicYear: m.entryAcademicYear ?? 2025,
            batchOverride: m.batchOverride,
          },
          event.startTime,
        ),
      }));

    return res.status(200).json({
      stats,
      absentees,
      totalEligible: eligible.length,
      totalAbsent: absentees.length,
    });
  } catch (err: any) {
    console.error("Error in getEventAbsentees:", err?.message ?? err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// PATCH /api/events/:id/reschedule (SUPER_ADMIN)
export const rescheduleEvent = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const idStr = Array.isArray(id) ? id[0] : id;
    if (!idStr) return res.status(400).json({ error: "Event id is required" });
    const { startTime, endTime, newStartTime, newEndTime, reason } = req.body ?? {};
    const finalStart = startTime || newStartTime;
    const finalEnd = endTime || newEndTime;

    if (!finalStart || !finalEnd) {
      return res.status(400).json({ error: "startTime and endTime are required" });
    }

    const event = await prisma.event.findUnique({
      where: { id: idStr },
      include: { study: true },
    });
    if (!event) return res.status(404).json({ error: "Event not found" });

    const newStart = new Date(finalStart);
    const newEnd = new Date(finalEnd);
    if (newEnd <= newStart) {
      return res.status(400).json({ error: "endTime must be after startTime" });
    }

    const plannedStartTime = event.plannedStartTime ?? event.startTime;
    const newEventDate = normalizeToDateOnly(newStart);

    const updated = await prisma.event.update({
      where: { id: idStr },
      data: {
        eventDate: newEventDate,
        startTime: newStart,
        endTime: newEnd,
        plannedStartTime,
        rescheduledAt: new Date(),
        rescheduleReason: reason ? String(reason).trim() : null,
        endedAt: newEnd > new Date() ? null : event.endedAt,
        manuallyClosedAt: newEnd > new Date() ? null : event.manuallyClosedAt,
      },
      include: {
        study: true,
        cluster: true,
        _count: {
          select: { attendances: { where: { removedAt: null } } },
        },
      },
    });

    return res.status(200).json({
      message: "Event rescheduled successfully",
      event: serializeEventForResponse(updated),
    });
  } catch (err: any) {
    console.error("Error in rescheduleEvent:", err?.message ?? err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
};

// PATCH /api/events/:id/cancel (SUPER_ADMIN)
export const cancelEvent = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const idStr = Array.isArray(id) ? id[0] : id;
    if (!idStr) return res.status(400).json({ error: "Event id is required" });
    const { reason } = req.body ?? {};

    const event = await prisma.event.findUnique({ where: { id: idStr } });
    if (!event) return res.status(404).json({ error: "Event not found" });

    const updated = await prisma.event.update({
      where: { id: idStr },
      data: {
        cancelledAt: new Date(),
        cancelReason: reason ? String(reason).trim() : null,
      },
      include: {
        study: true,
        cluster: true,
        _count: {
          select: { attendances: { where: { removedAt: null } } },
        },
      },
    });

    return res.status(200).json({
      message: "Event cancelled successfully",
      event: serializeEventForResponse(updated),
    });
  } catch (err: any) {
    console.error("Error in cancelEvent:", err?.message ?? err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
};

// GET /api/events/:eventId/present-members
export const getPresentMembersForEvent = async (
  req: Request,
  res: Response,
) => {
  try {
    if (!req.admin?.id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { eventId } = req.params;
    const normalizedEventId = Array.isArray(eventId) ? eventId[0] : eventId;
    if (!normalizedEventId) {
      return res.status(400).json({ error: "Event id is required" });
    }

    const event = await prisma.event.findUnique({
      where: { id: normalizedEventId },
      select: { id: true },
    });

    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    const attendances = await prisma.attendance.findMany({
      where: { eventId: normalizedEventId },
      select: { memberId: true },
    });

    return res.status(200).json({
      presentMemberIds: attendances.map((attendance) => attendance.memberId),
    });
  } catch (err: any) {
    console.error("Error in getPresentMembersForEvent:", err?.message ?? err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// GET /api/events/cluster/:clusterId
export const getEventClusterById = async (req: Request, res: Response) => {
  try {
    if (!req.admin?.id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { clusterId } = req.params;
    const normalizedId = Array.isArray(clusterId) ? clusterId[0] : clusterId;

    if (!normalizedId) {
      return res.status(400).json({ error: "Cluster id is required" });
    }

    const cluster = await prisma.eventCluster.findUnique({
      where: { id: normalizedId },
      include: {
        events: { include: { _count: { select: { attendances: true } } } },
      },
    });

    if (!cluster) {
      return res.status(404).json({ error: "Event cluster not found" });
    }

    return res.status(200).json({
      cluster: {
        ...cluster,
        startDate: cluster.startDate.toISOString(),
        endDate: cluster.endDate.toISOString(),
      },
      events: cluster.events.map((event: any) =>
        serializeEventForResponse({
          ...event,
          cluster: {
            id: cluster.id,
            title: cluster.title,
            startDate: cluster.startDate,
            endDate: cluster.endDate,
          },
        }),
      ),
    });
  } catch (err: any) {
    console.error("Error in getEventClusterById:", err?.message ?? err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// GET /api/events/:eventId/attendance?page=1&limit=20&sortBy=time|name&order=asc|desc
export const getEventAttendance = async (req: Request, res: Response) => {
  try {
    if (!req.admin?.id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { eventId } = req.params;
    const normalizedEventId = Array.isArray(eventId) ? eventId[0] : eventId;

    if (!normalizedEventId) {
      return res.status(400).json({ error: "Event id is required" });
    }

    const rawPage = Number(req.query.page ?? 1);
    const rawLimit = Number(req.query.limit ?? 20);
    const sortBy = req.query.sortBy === "name" ? "name" : "time";
    const order = req.query.order === "desc" ? "desc" : "asc";

    const currentPage = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
    const limit =
      Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 20;
    const skip = (currentPage - 1) * limit;

    const event = await prisma.event.findUnique({
      where: { id: normalizedEventId },
      select: { id: true },
    });

    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    const orderBy =
      sortBy === "name"
        ? [{ member: { name: order } as const }, { markedAt: "asc" as const }]
        : [
            { markedAt: order as "asc" | "desc" },
            { member: { name: "asc" as const } },
          ];

    const [attendanceRecords, totalCount] = await Promise.all([
      prisma.attendance.findMany({
        where: { eventId: normalizedEventId, removedAt: null },
        skip,
        take: limit,
        orderBy,
        include: {
          member: {
            select: {
              id: true,
              name: true,
              email: true,
              phoneNumber: true,
              uniqueId: true,
              isActive: true,
            },
          },
        },
      }),
      prisma.attendance.count({
        where: { eventId: normalizedEventId, removedAt: null },
      }),
    ]);

    const totalPages = totalCount === 0 ? 1 : Math.ceil(totalCount / limit);

    return res.status(200).json({
      data: attendanceRecords.map((record) => ({
        attendanceId: record.id,
        memberId: record.memberId,
        name: record.member.name,
        email: record.member.email,
        phone: record.member.phoneNumber,
        uniqueId: record.member.uniqueId,
        markedAt: record.markedAt,
        status: record.status,
        excuseReason: record.excuseReason,
        markedMethod: record.markedMethod,
        isActive: record.member.isActive,
      })),
      totalCount,
      totalPages,
      currentPage,
    });
  } catch (err: any) {
    console.error("Error in getEventAttendance:", err?.message ?? err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// GET /api/events/:eventId/attendance/export/excel?sortBy=time|name&order=asc|desc
export const exportEventAttendanceExcel = async (
  req: Request,
  res: Response,
) => {
  try {
    if (!req.admin?.id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { eventId } = req.params;
    const normalizedEventId = Array.isArray(eventId) ? eventId[0] : eventId;

    if (!normalizedEventId) {
      return res.status(400).json({ error: "Event id is required" });
    }

    const sortBy = req.query.sortBy === "name" ? "name" : "time";
    const order = req.query.order === "desc" ? "desc" : "asc";

    const event = await prisma.event.findUnique({
      where: { id: normalizedEventId },
      select: { id: true, title: true, startTime: true, endTime: true },
    });

    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    const orderBy =
      sortBy === "name"
        ? [{ member: { name: order } as const }, { markedAt: "asc" as const }]
        : [
            { markedAt: order as "asc" | "desc" },
            { member: { name: "asc" as const } },
          ];

    const attendanceRecords = await prisma.attendance.findMany({
      where: { eventId: normalizedEventId, removedAt: null },
      orderBy,
      include: {
        member: {
          select: {
            uniqueId: true,
            name: true,
            email: true,
            phoneNumber: true,
            isActive: true,
          },
        },
      },
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Attendance System";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Attended Members");
    sheet.columns = [
      { header: "Member ID", key: "uniqueId", width: 20 },
      { header: "Name", key: "name", width: 28 },
      { header: "Email", key: "email", width: 30 },
      { header: "Phone", key: "phone", width: 18 },
      { header: "Status", key: "status", width: 14 },
      { header: "Excuse Reason", key: "excuseReason", width: 24 },
      { header: "Marked On", key: "markedAt", width: 28 },
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];

    for (const record of attendanceRecords) {
      const markedDate = new Date(record.markedAt);
      const markedFriendly = markedDate.toLocaleString(undefined, {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

      sheet.addRow({
        uniqueId: record.member.uniqueId,
        name: record.member.name,
        email: record.member.email,
        phone: record.member.phoneNumber ?? "",
        status: record.status,
        excuseReason: record.excuseReason ?? "",
        markedAt: markedFriendly,
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    setExcelDownloadHeaders(res, event.title, "event-attendance");
    return res.status(200).send(Buffer.from(buffer));
  } catch (err: any) {
    console.error("Error in exportEventAttendanceExcel:", err?.message ?? err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// PATCH /api/events/:id/deactivate
// Sets isActive false, but doesn't delete the record. Only SUPER_ADMIN can perform this action.
export const deactivateEvent = async (req: Request, res: Response) => {
  try {
    if (!req.admin?.id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // role enforced by requireRole middleware

    const { id } = req.params;
    const idStr = Array.isArray(id) ? id[0] : id;
    if (!idStr) return res.status(400).json({ error: "Event id is required" });

    const existing = await prisma.event.findUnique({ where: { id: idStr } });
    if (!existing) return res.status(404).json({ error: "Event not found" });

    const updated = await prisma.event.update({
      where: { id: idStr },
      data: { isActive: false },
      include: { _count: { select: { attendances: true } } },
    });

    return res.status(200).json({ event: serializeEventForResponse(updated) });
  } catch (err: any) {
    console.error("Error in deactivateEvent:", err?.message ?? err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const closeEvent = async (req: Request, res: Response) => {
  try {
    if (!req.admin?.id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { id } = req.params;
    const idStr = Array.isArray(id) ? id[0] : id;
    if (!idStr) return res.status(400).json({ error: "Event id is required" });

    const existing = await prisma.event.findUnique({ where: { id: idStr } });
    if (!existing) return res.status(404).json({ error: "Event not found" });
    if (!existing.isActive) {
      return res
        .status(400)
        .json({ error: "Deactivated events cannot be manually closed" });
    }

    const updated = await prisma.event.update({
      where: { id: idStr },
      data: { endedAt: existing.endedAt ?? new Date() },
      include: { _count: { select: { attendances: true } } },
    });

    return res.status(200).json({ event: serializeEventForResponse(updated) });
  } catch (err: any) {
    console.error("Error in closeEvent:", err?.message ?? err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// PATCH /api/events/:id
// Only SUPER_ADMIN.
export const updateEvent = async (req: Request, res: Response) => {
  try {
    if (!req.admin?.id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { id } = req.params;
    const idStr = Array.isArray(id) ? id[0] : id;
    if (!idStr) {
      return res.status(400).json({ error: "Event id is required" });
    }

    const existing = await prisma.event.findUnique({ where: { id: idStr } });
    if (!existing) {
      return res.status(404).json({ error: "Event not found" });
    }

    const now = new Date();

    const { title, description, status, startTime, endTime, location } =
      req.body ?? {};

    const updateData: {
      title?: string;
      description?: string;
      startTime?: Date;
      endTime?: Date;
      location?: string;
      isActive?: boolean;
      endedAt?: Date | null;
    } = {};

    if (title !== undefined) {
      if (typeof title !== "string" || title.trim() === "") {
        return res
          .status(400)
          .json({ error: "title must be a non-empty string" });
      }
      updateData.title = title.trim();
    }

    if (description !== undefined) {
      if (typeof description !== "string" || description.trim() === "") {
        return res.status(400).json({ error: "Event description is required" });
      }
      updateData.description = description.trim();
    }

    if (location !== undefined) {
      if (typeof location !== "string" || location.trim() === "") {
        return res
          .status(400)
          .json({ error: "location must be a non-empty string" });
      }
      updateData.location = location.trim();
    }

    if (startTime !== undefined) {
      const parsedStartTime = new Date(startTime);
      if (Number.isNaN(parsedStartTime.getTime())) {
        return res.status(400).json({ error: "Invalid startTime" });
      }
      updateData.startTime = parsedStartTime;
    }

    if (endTime !== undefined) {
      const parsedEndTime = new Date(endTime);
      if (Number.isNaN(parsedEndTime.getTime())) {
        return res.status(400).json({ error: "Invalid endTime" });
      }
      updateData.endTime = parsedEndTime;
    }

    const nextStartTime = updateData.startTime ?? existing.startTime;
    const nextEndTime = updateData.endTime ?? existing.endTime;
    if (nextEndTime <= nextStartTime) {
      return res.status(400).json({ error: "endTime must be after startTime" });
    }

    if (status !== undefined) {
      if (
        status !== "UPCOMING" &&
        status !== "ACTIVE" &&
        status !== "PAST" &&
        status !== "DEACTIVATED"
      ) {
        return res.status(400).json({ error: "Invalid status" });
      }

      if (status === "DEACTIVATED") {
        updateData.isActive = false;
      } else {
        updateData.isActive = true;
        if (status === "PAST") {
          updateData.endedAt = existing.endedAt ?? new Date();
        }
        if (status === "UPCOMING" || status === "ACTIVE") {
          updateData.endedAt = null;
        }
      }
    }

    const extraData: any = {};
    if (req.body.studyId !== undefined) {
      extraData.studyId = req.body.studyId ? String(req.body.studyId) : null;
    }
    if (req.body.sessionType !== undefined) {
      extraData.sessionType = req.body.sessionType;
    }
    if (req.body.lateGraceMinutes !== undefined) {
      extraData.lateGraceMinutes =
        req.body.lateGraceMinutes !== null && req.body.lateGraceMinutes !== ""
          ? Number(req.body.lateGraceMinutes)
          : null;
    }

    const updated = await prisma.event.update({
      where: { id: idStr },
      data: {
        ...updateData,
        ...extraData,
      },
      include: {
        study: true,
        _count: { select: { attendances: true } },
        cluster: {
          select: { id: true, title: true, startDate: true, endDate: true },
        },
      } as any,
    });

    return res.status(200).json({ event: serializeEventForResponse(updated) });
  } catch (err: any) {
    console.error("Error in updateEvent:", err?.message ?? err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// PATCH /api/events/cluster/:clusterId
// Update an event cluster and its events. Only SUPER_ADMIN.
export const updateEventCluster = async (req: Request, res: Response) => {
  try {
    if (!req.admin?.id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { clusterId } = req.params;
    const normalizedId = Array.isArray(clusterId) ? clusterId[0] : clusterId;

    if (!normalizedId) {
      return res.status(400).json({ error: "Cluster id is required" });
    }

    const existingCluster = await prisma.eventCluster.findUnique({
      where: { id: normalizedId },
      include: { events: true },
    });

    if (!existingCluster) {
      return res.status(404).json({ error: "Event cluster not found" });
    }

    const { title, description, location, events } = req.body ?? {};

    if (!Array.isArray(events) || events.length === 0) {
      return res
        .status(400)
        .json({ error: "At least one cluster event is required" });
    }

    const parsedEvents = parseClusterEvents(events);
    if (parsedEvents.error) {
      return res.status(400).json({ error: parsedEvents.error });
    }

    const normalizedTitle =
      typeof title === "string" && title.trim() !== ""
        ? title.trim()
        : existingCluster.title;
    const normalizedDescription =
      typeof description === "string" && description.trim() !== ""
        ? description.trim()
        : existingCluster.description;
    const normalizedLocation =
      typeof location === "string" && location.trim() !== ""
        ? location.trim()
        : existingCluster.location;

    const parsedClusterEvents = parsedEvents.value!;
    const sortedByDate = [...parsedClusterEvents].sort(
      (a, b) => a.eventDate.getTime() - b.eventDate.getTime(),
    );
    const clusterStartDate = sortedByDate[0].eventDate;
    const clusterEndDate = sortedByDate[sortedByDate.length - 1].eventDate;

    const existingEventIds = new Set(
      existingCluster.events.map((entry: { id: string }) => entry.id),
    );
    const incomingIds = new Set<string>();
    const toCreate: ClusterEventInput[] = [];

    parsedClusterEvents.forEach((entry, index) => {
      const incomingId = (events[index] as any)?.id;
      if (typeof incomingId === "string" && incomingId.trim() !== "") {
        if (!existingEventIds.has(incomingId)) {
          return;
        }
        incomingIds.add(incomingId);
      } else {
        toCreate.push(entry);
      }
    });

    const invalidIncomingIds = parsedClusterEvents
      .map((_, index) => (events[index] as any)?.id)
      .filter(
        (incomingId: any) =>
          typeof incomingId === "string" &&
          incomingId.trim() !== "" &&
          !existingEventIds.has(incomingId),
      );

    if (invalidIncomingIds.length > 0) {
      return res
        .status(400)
        .json({ error: "One or more cluster events are invalid." });
    }

    const updateOperations = parsedClusterEvents
      .map((entry, index) => {
        const incomingId = (events[index] as any)?.id;
        if (typeof incomingId === "string" && incomingId.trim() !== "") {
          return prisma.event.update({
            where: { id: incomingId },
            data: {
              title: normalizedTitle,
              description: normalizedDescription,
              location: normalizedLocation,
              eventDate: entry.eventDate,
              startTime: entry.startTime,
              endTime: entry.endTime,
              clusterLabel: entry.label,
            } as any,
          });
        }
        return null;
      })
      .filter(Boolean) as Array<ReturnType<typeof prisma.event.update>>;

    const deleteOperations = existingCluster.events
      .filter((event: { id: string }) => !incomingIds.has(event.id))
      .map((event: { id: string }) =>
        prisma.event.delete({ where: { id: event.id } }),
      );

    const createOperations = toCreate.map((entry) =>
      prisma.event.create({
        data: {
          title: normalizedTitle,
          description: normalizedDescription,
          location: normalizedLocation,
          eventDate: entry.eventDate,
          startTime: entry.startTime,
          endTime: entry.endTime,
          clusterLabel: entry.label,
          type: EventType.ONE_TIME,
          createdById: existingCluster.createdById,
          clusterId: normalizedId,
        } as any,
      }),
    );

    await prisma.$transaction([
      prisma.eventCluster.update({
        where: { id: normalizedId },
        data: {
          title: normalizedTitle,
          description: normalizedDescription,
          location: normalizedLocation,
          startDate: clusterStartDate,
          endDate: clusterEndDate,
        },
      }),
      ...updateOperations,
      ...deleteOperations,
      ...createOperations,
    ]);

    const refreshedCluster = await prisma.eventCluster.findUnique({
      where: { id: normalizedId },
      include: {
        events: { include: { _count: { select: { attendances: true } } } },
      },
    });

    if (!refreshedCluster) {
      return res.status(404).json({ error: "Event cluster not found" });
    }

    return res.status(200).json({
      cluster: {
        ...refreshedCluster,
        startDate: refreshedCluster.startDate.toISOString(),
        endDate: refreshedCluster.endDate.toISOString(),
      },
      events: refreshedCluster.events.map((event: any) =>
        serializeEventForResponse({
          ...event,
          cluster: {
            id: refreshedCluster.id,
            title: refreshedCluster.title,
            startDate: refreshedCluster.startDate,
            endDate: refreshedCluster.endDate,
          },
        }),
      ),
    });
  } catch (err: any) {
    console.error("Error in updateEventCluster:", err?.message ?? err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// DELETE /api/events/:id
// Only SUPER_ADMIN.
export const deleteEvent = async (req: Request, res: Response) => {
  try {
    if (!req.admin?.id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { id } = req.params;
    const idStr = Array.isArray(id) ? id[0] : id;
    if (!idStr) {
      return res.status(400).json({ error: "Event id is required" });
    }

    const existing = await prisma.event.findUnique({ where: { id: idStr } });
    if (!existing) {
      return res.status(404).json({ error: "Event not found" });
    }

    await prisma.event.delete({ where: { id: idStr } });

    return res.status(200).json({ deleted: true, id: idStr });
  } catch (err: any) {
    console.error("Error in deleteEvent:", err?.message ?? err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export default {
  createEvent,
  getAllEvents,
  getEventById,
  getEventClusterById,
  getEventAttendance,
  exportEventAttendanceExcel,
  getPresentMembersForEvent,
  deactivateEvent,
  closeEvent,
  updateEvent,
  updateEventCluster,
  deleteEvent,
};
