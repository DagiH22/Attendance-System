import { Request, Response } from "express";
import { PrismaClient, EventType } from "@prisma/client";

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

// GET /api/events

export const getAllEvents = async (_req: Request, res: Response) => {
  try {
    const events = await prisma.event.findMany({
      orderBy: [{ eventDate: "desc" }, { startTime: "desc" }],
    });
    return res.status(200).json({ events });
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
