import { Request, Response } from "express";
import { PrismaClient, EventType } from "@prisma/client";
import {
  computeEventLifecycle,
  serializeEventForResponse,
  type EventStatus,
} from "../services/event-lifecycle.service";

const prisma = new PrismaClient();

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

    const {
      title,
      description,
      eventDate,
      startTime,
      endTime,
      type,
      location,
    } = req.body ?? {};

    if (!title || !eventDate || !startTime || !endTime || !location) {
      return res.status(400).json({
        error: "title, eventDate, startTime, endTime and location are required",
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

    const created = await prisma.event.create({
      data: {
        title,
        description: description ?? null,
        eventDate: parsedEventDate,
        startTime: parsedStartTime,
        endTime: parsedEndTime,
        type: eventType,
        location: location.trim(),
        createdById: req.admin.id,
      },
      include: { _count: { select: { attendances: true } } },
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
          isActive: true,
          AND: [{ startTime: { gt: now } }],
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
      include: { _count: { select: { attendances: true } } },
    });
    if (!event) return res.status(404).json({ error: "Event not found" });

    return res.status(200).json({ event: serializeEventForResponse(event) });
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

export default {
  createEvent,
  getAllEvents,
  getEventById,
  deactivateEvent,
  closeEvent,
};
