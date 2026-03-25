import { Request, Response } from "express";
import { PrismaClient, EventType } from "@prisma/client";
import {
  computeEventLifecycle,
  serializeEventForResponse,
  type EventStatus,
} from "../services/event-lifecycle.service";
import recurrenceService from "../services/recurrence.service";

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
        type: eventType,
        location: validated.location,
        createdById: adminId,
      },
      include: {
        _count: { select: { attendances: true } },
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

    const now = new Date();

    const [
      upcomingCandidates,
      activeCandidates,
      deactivatedEvents,
      pastCandidates,
      totalEvents,
    ] = await Promise.all([
      // upcoming: future startTime (or eventDate) and active
      prisma.event.findMany({
        where: {
          // exclude parent recurring-event rows (type=WEEKLY with null recurrenceIndex)
          NOT: { AND: [{ type: EventType.WEEKLY }, { recurrenceIndex: null }] },
          isActive: true,
          AND: [{ startTime: { gt: now } }],
        },
        orderBy: [{ startTime: "asc" }, { eventDate: "asc" }],
        include: {
          _count: { select: { attendances: true } },
          cluster: {
            select: { id: true, title: true, startDate: true, endDate: true },
          },
        } as any,
      }),
      // active candidates: startTime <= now (or eventDate <= now) and active
      prisma.event.findMany({
        where: {
          NOT: { AND: [{ type: EventType.WEEKLY }, { recurrenceIndex: null }] },
          isActive: true,
          startTime: { lte: now },
        },
        orderBy: [{ startTime: "asc" }, { eventDate: "asc" }],
        include: {
          _count: { select: { attendances: true } },
          cluster: {
            select: { id: true, title: true, startDate: true, endDate: true },
          },
        } as any,
      }),
      // deactivated: explicit isActive === false
      prisma.event.findMany({
        where: {
          NOT: { AND: [{ type: EventType.WEEKLY }, { recurrenceIndex: null }] },
          isActive: false,
        },
        orderBy: [{ eventDate: "asc" }, { startTime: "asc" }],
        include: {
          _count: { select: { attendances: true } },
          cluster: {
            select: { id: true, title: true, startDate: true, endDate: true },
          },
        } as any,
      }),
      // past candidates: endTime < now or (no endTime && eventDate < now)
      prisma.event.findMany({
        where: {
          NOT: { AND: [{ type: EventType.WEEKLY }, { recurrenceIndex: null }] },
          isActive: true,
          endTime: { lt: now },
        },
        orderBy: [{ endTime: "desc" }, { eventDate: "desc" }],
        include: {
          _count: { select: { attendances: true } },
          cluster: {
            select: { id: true, title: true, startDate: true, endDate: true },
          },
        } as any,
      }),
      prisma.event.count({
        where: {
          NOT: { AND: [{ type: EventType.WEEKLY }, { recurrenceIndex: null }] },
        },
      }),
    ]);

    // Build ordered list following desired sequence using the candidate buckets:
    // 1) UPCOMING (start in future and isActive)
    // 2) ACTIVE (now between start and end and isActive)
    // 3) DEACTIVATED (isActive === false)
    // 4) PAST (endTime in past)

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

    // Priority order: ACTIVE events should appear before UPCOMING ones
    // First include events that are already ACTIVE (startTime <= now)
    classifyAndPush(activeCandidates, ["ACTIVE"]);

    // upcomingCandidates may include events whose startTime is in the future
    // but whose activationTime (startTime - PRE_ACTIVE_WINDOW) has already
    // passed — these should be treated as ACTIVE. Allow upcomingCandidates
    // to contribute both ACTIVE and UPCOMING statuses so pre-active events
    // are not accidentally omitted.
    classifyAndPush(upcomingCandidates, ["ACTIVE", "UPCOMING"]);
    classifyAndPush(deactivatedEvents, ["DEACTIVATED"]);
    classifyAndPush(pastCandidates, ["PAST"]);

    const events = ordered.slice(offset, offset + limit);

    return res.status(200).json({ events, totalEvents, offset, limit });
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

    const event = await prisma.event.findUnique({
      where: { id: idStr },
      include: {
        _count: { select: { attendances: true } },
        cluster: {
          select: { id: true, title: true, startDate: true, endDate: true },
        },
      } as any,
    });
    if (!event) return res.status(404).json({ error: "Event not found" });

    return res.status(200).json({ event: serializeEventForResponse(event) });
  } catch (err: any) {
    console.error("Error in getEventById:", err?.message ?? err);
    return res.status(500).json({ error: "Internal server error" });
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
        where: { eventId: normalizedEventId },
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
        where: { eventId: normalizedEventId },
      }),
    ]);

    const totalPages = totalCount === 0 ? 1 : Math.ceil(totalCount / limit);

    return res.status(200).json({
      data: attendanceRecords.map((record) => ({
        memberId: record.memberId,
        name: record.member.name,
        email: record.member.email,
        phone: record.member.phoneNumber,
        uniqueId: record.member.uniqueId,
        markedAt: record.markedAt,
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
// Only SUPER_ADMIN. Editing is blocked once the event has started.
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
    if (existing.startTime <= now) {
      return res
        .status(403)
        .json({ error: "Event has already started; editing is disabled" });
    }

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
      if (parsedStartTime <= now) {
        return res
          .status(400)
          .json({ error: "startTime must be in the future" });
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

    const updated = await prisma.event.update({
      where: { id: idStr },
      data: updateData,
      include: {
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
// Only SUPER_ADMIN. Event must still be upcoming.
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

    if (existing.startTime <= new Date()) {
      return res
        .status(403)
        .json({ error: "Cannot delete an event that has already started" });
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
  getPresentMembersForEvent,
  deactivateEvent,
  closeEvent,
  updateEvent,
  updateEventCluster,
  deleteEvent,
};
