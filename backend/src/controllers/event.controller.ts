import { Request, Response } from "express";
import { PrismaClient, EventType } from "@prisma/client";

const prisma = new PrismaClient();

type EventStatus = "UPCOMING" | "ACTIVE" | "PAST" | "DEACTIVATED";

const buildEventClassificationDate = (
  eventDate: Date,
  startTime?: Date | null,
) => {
  const baseEventDate = new Date(eventDate);

  if (startTime) {
    const normalizedStartTime = new Date(startTime);
    baseEventDate.setHours(
      normalizedStartTime.getHours(),
      normalizedStartTime.getMinutes(),
      normalizedStartTime.getSeconds(),
      normalizedStartTime.getMilliseconds(),
    );
  }

  return baseEventDate;
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

    // role enforced by requireRole middleware

    const { title, description, eventDate, startTime, endTime, type } =
      req.body ?? {};

    if (!title || !eventDate || !startTime || !endTime) {
      return res.status(400).json({
        error: "title, eventDate, startTime and endTime are required",
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

    const created = await prisma.event.create({
      data: {
        title,
        description: description ?? null,
        eventDate: parsedEventDate,
        startTime: parsedStartTime,
        endTime: parsedEndTime,
        type: eventType,
        createdById: req.admin.id,
      },
    });

    return res.status(201).json({ event: created });
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
          isActive: true,
          startTime: { gt: now },
        },
        orderBy: [{ startTime: "asc" }, { eventDate: "asc" }],
        include: { _count: { select: { attendances: true } } },
      }),
      // active candidates: startTime <= now (or eventDate <= now) and active
      prisma.event.findMany({
        where: {
          isActive: true,
          startTime: { lte: now },
        },
        orderBy: [{ startTime: "asc" }, { eventDate: "asc" }],
        include: { _count: { select: { attendances: true } } },
      }),
      // deactivated: explicit isActive === false
      prisma.event.findMany({
        where: { isActive: false },
        orderBy: [{ eventDate: "asc" }, { startTime: "asc" }],
        include: { _count: { select: { attendances: true } } },
      }),
      // past candidates: endTime < now or (no endTime && eventDate < now)
      prisma.event.findMany({
        where: {
          isActive: true,
          endTime: { lt: now },
        },
        orderBy: [{ endTime: "desc" }, { eventDate: "desc" }],
        include: { _count: { select: { attendances: true } } },
      }),
      prisma.event.count(),
    ]);

    // Build ordered list following desired sequence using the candidate buckets:
    // 1) UPCOMING (start in future and isActive)
    // 2) ACTIVE (now between start and end and isActive)
    // 3) DEACTIVATED (isActive === false)
    // 4) PAST (endTime in past)

    const idSeen = new Set<string>();
    const ordered: Array<any> = [];

    const toISO = (d?: Date | null) => (d ? new Date(d).toISOString() : null);
    const assumeEndTime = (start?: Date | null) => {
      if (!start) return null;
      const s = new Date(start);
      s.setHours(s.getHours() + 2);
      return s;
    };

    const classifyAndPush = (
      evs: any[],
      classifier: (e: any) => EventStatus,
    ) => {
      for (const e of evs) {
        if (idSeen.has(e.id)) continue;
        idSeen.add(e.id);

        const start = e.startTime
          ? new Date(e.startTime)
          : new Date(e.eventDate);
        const end = e.endTime ? new Date(e.endTime) : assumeEndTime(start);

        const status = !e.isActive
          ? ("DEACTIVATED" as EventStatus)
          : classifier({ start, end, now });

        ordered.push({
          ...e,
          startTime: toISO(start),
          endTime: toISO(end),
          createdAt: toISO(e.createdAt),
          updatedAt: toISO(e.updatedAt),
          status,
        });
      }
    };

    const upcomingClassifier = ({ start }: { start: Date }) =>
      start > now ? ("UPCOMING" as EventStatus) : ("ACTIVE" as EventStatus);
    const activeClassifier = ({
      start,
      end,
      now: n,
    }: {
      start: Date;
      end: Date | null;
      now: Date;
    }) => {
      if (end && start <= n && n <= end) return "ACTIVE" as EventStatus;
      if (!end && start <= n && assumeEndTime(start)! >= n)
        return "ACTIVE" as EventStatus;
      return start > n ? ("UPCOMING" as EventStatus) : ("PAST" as EventStatus);
    };
    const pastClassifier = ({
      start,
      end,
      now: n,
    }: {
      start: Date;
      end: Date | null;
      now: Date;
    }) => {
      if (end && end < n) return "PAST" as EventStatus;
      if (!end && start < n) return "PAST" as EventStatus;
      return start > n
        ? ("UPCOMING" as EventStatus)
        : ("ACTIVE" as EventStatus);
    };

    classifyAndPush(upcomingCandidates, upcomingClassifier);
    classifyAndPush(activeCandidates, activeClassifier);
    classifyAndPush(deactivatedEvents, () => "DEACTIVATED");
    classifyAndPush(pastCandidates, pastClassifier);

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

    const event = await prisma.event.findUnique({ where: { id: idStr } });
    if (!event) return res.status(404).json({ error: "Event not found" });

    return res.status(200).json({ event });
  } catch (err: any) {
    console.error("Error in getEventById:", err?.message ?? err);
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
    });

    return res.status(200).json({ event: updated });
  } catch (err: any) {
    console.error("Error in deactivateEvent:", err?.message ?? err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export default { createEvent, getAllEvents, getEventById, deactivateEvent };
