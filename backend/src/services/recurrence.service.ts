import { PrismaClient, EventType } from "@prisma/client";

export const setTimeOnDate = (date: Date, timeSource: Date) => {
  const d = new Date(date);
  d.setHours(
    timeSource.getHours(),
    timeSource.getMinutes(),
    timeSource.getSeconds(),
    timeSource.getMilliseconds(),
  );
  return d;
};

export const addDays = (date: Date, days: number) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

export const normalizeToDateOnly = (date: Date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

export const createWeeklyEvents = async (
  prisma: PrismaClient,
  input: {
    adminId: string;
    title: string;
    description: string;
    startDate: Date; // date-only for first occurrence
    startTime: Date; // time (hours/minutes) will be applied to each occurrence
    endTime: Date;
    endDate?: Date; // optional endDate (date-only) to generate occurrences through
    recurrenceLengthWeeks?: number;
    location: string;
  },
) => {
  const startDateOnly = normalizeToDateOnly(input.startDate);

  const endDateOnly = input.endDate
    ? normalizeToDateOnly(input.endDate)
    : undefined;

  const fallbackLength =
    input.recurrenceLengthWeeks && input.recurrenceLengthWeeks >= 1
      ? Math.floor(input.recurrenceLengthWeeks)
      : 4;

  const length = (() => {
    if (!endDateOnly) return fallbackLength;
    if (endDateOnly.getTime() < startDateOnly.getTime()) {
      throw new Error("endDate cannot be before startDate");
    }
    const diffDays = Math.floor(
      (endDateOnly.getTime() - startDateOnly.getTime()) / (1000 * 60 * 60 * 24),
    );
    // inclusive weeks count: start date is week 1
    return Math.floor(diffDays / 7) + 1;
  })();

  // IMPORTANT: Do NOT create a separate parent/original row.
  // We'll create only week occurrences. For grouping, we set parentEventId
  // to the Week 1 occurrence id.
  const week1Date = startDateOnly;
  const week1Start = setTimeOnDate(week1Date, input.startTime);
  const week1End = setTimeOnDate(week1Date, input.endTime);

  const week1 = await prisma.event.create({
    data: {
      title: `${input.title} - Week 1`,
      description: input.description,
      eventDate: week1Date,
      startTime: week1Start,
      endTime: week1End,
      type: EventType.WEEKLY,
      location: input.location,
      parentEventId: null,
      recurrenceIndex: 1,
      recurrenceLengthWeeks: length,
      createdById: input.adminId,
    },
  });

  const creates = [] as any[];
  for (let i = 1; i < length; i++) {
    const occurrenceDate = addDays(startDateOnly, i * 7);
    const occurrenceStart = setTimeOnDate(occurrenceDate, input.startTime);
    const occurrenceEnd = setTimeOnDate(occurrenceDate, input.endTime);

    creates.push(
      prisma.event.create({
        data: {
          title: `${input.title} - Week ${i + 1}`,
          description: input.description,
          eventDate: occurrenceDate,
          startTime: occurrenceStart,
          endTime: occurrenceEnd,
          type: EventType.WEEKLY,
          location: input.location,
          parentEventId: week1.id,
          recurrenceIndex: i + 1,
          recurrenceLengthWeeks: length,
          createdById: input.adminId,
        },
      }),
    );
  }

  const rest = creates.length > 0 ? await prisma.$transaction(creates) : [];
  const children = [week1, ...rest];

  // For backwards compatibility with callers that expect { parent, children },
  // we expose "parent" as the grouping root (week 1 occurrence).
  return { parent: week1, children };
};

export const updateWeeklyEvents = async (
  prisma: PrismaClient,
  parentEventId: string,
  input: {
    newRecurrenceLength?: number;
    newStartDate?: Date;
  },
) => {
  const parent = await prisma.event.findUnique({
    where: { id: parentEventId },
    include: { childrenEvents: true },
  });

  if (!parent) throw new Error("parent event not found");
  if (parent.type !== EventType.WEEKLY) {
    throw new Error("event is not a weekly recurring event");
  }

  const today = normalizeToDateOnly(new Date());
  const children = (parent.childrenEvents ?? []).slice().sort((a, b) => {
    const ai = a.recurrenceIndex ?? 0;
    const bi = b.recurrenceIndex ?? 0;
    return ai - bi;
  });

  const currentLength = parent.recurrenceLengthWeeks ?? children.length;
  const targetLength =
    input.newRecurrenceLength && input.newRecurrenceLength >= 1
      ? Math.floor(input.newRecurrenceLength)
      : currentLength;

  // If start date is changing, ensure first occurrence hasn't already happened
  if (input.newStartDate) {
    const firstOccurrence = children[0];
    if (firstOccurrence) {
      const firstDate = normalizeToDateOnly(firstOccurrence.eventDate);
      if (firstDate.getTime() < today.getTime()) {
        throw new Error(
          "Cannot change start date after the first occurrence has happened",
        );
      }
    }
  }

  // Begin transaction to update parent and children
  const updates: Array<Promise<any>> = [];

  // handle start date change
  if (input.newStartDate) {
    const newStart = normalizeToDateOnly(input.newStartDate);
    // update parent eventDate / startTime / endTime
    updates.push(
      prisma.event.update({
        where: { id: parentEventId },
        data: {
          eventDate: newStart,
          startTime: setTimeOnDate(newStart, parent.startTime),
          endTime: setTimeOnDate(newStart, parent.endTime),
          recurrenceLengthWeeks: targetLength,
        },
      }),
    );

    // update all children dates (none should have happened because we checked)
    for (let i = 0; i < targetLength; i++) {
      const occurrenceDate = addDays(newStart, i * 7);
      const start = setTimeOnDate(occurrenceDate, parent.startTime);
      const end = setTimeOnDate(occurrenceDate, parent.endTime);

      updates.push(
        prisma.event.upsert({
          where: {
            // use a compound of parentEventId and recurrenceIndex is not unique in schema,
            // so fallback to finding by parentEventId + recurrenceIndex using raw filter via updateMany
            id: children[i]?.id ?? "__MISSING__",
          },
          create: {
            title: `${parent.title} - Week ${i + 1}`,
            description: parent.description,
            eventDate: occurrenceDate,
            startTime: start,
            endTime: end,
            type: EventType.WEEKLY,
            location: parent.location,
            parentEventId: parentEventId,
            recurrenceIndex: i + 1,
            recurrenceLengthWeeks: targetLength,
            createdById: parent.createdById,
          },
          update: {
            eventDate: occurrenceDate,
            startTime: start,
            endTime: end,
            recurrenceLengthWeeks: targetLength,
          },
        }),
      );
    }
  } else {
    // no start date change, but recurrence length may change
    updates.push(
      prisma.event.update({
        where: { id: parentEventId },
        data: { recurrenceLengthWeeks: targetLength },
      }),
    );

    if (targetLength > currentLength) {
      // create additional occurrences after the last existing recurrenceIndex
      const lastIndex =
        children.length > 0
          ? (children[children.length - 1].recurrenceIndex ?? 0)
          : 0;
      for (let i = lastIndex; i < targetLength; i++) {
        const occurrenceDate = addDays(parent.eventDate, i * 7);
        const start = setTimeOnDate(occurrenceDate, parent.startTime);
        const end = setTimeOnDate(occurrenceDate, parent.endTime);

        updates.push(
          prisma.event.create({
            data: {
              title: `${parent.title} - Week ${i + 1}`,
              description: parent.description,
              eventDate: occurrenceDate,
              startTime: start,
              endTime: end,
              type: EventType.WEEKLY,
              location: parent.location,
              parentEventId: parentEventId,
              recurrenceIndex: i + 1,
              recurrenceLengthWeeks: targetLength,
              createdById: parent.createdById,
            },
          }),
        );
      }
    }

    if (targetLength < currentLength) {
      // delete occurrences with recurrenceIndex > targetLength but do not delete past occurrences
      const toDelete = children.filter(
        (c) => (c.recurrenceIndex ?? 0) > targetLength,
      );
      const pastDeletes = toDelete.filter(
        (c) => normalizeToDateOnly(c.eventDate).getTime() < today.getTime(),
      );
      if (pastDeletes.length > 0) {
        throw new Error("Cannot remove past occurrences");
      }

      updates.push(
        prisma.event.deleteMany({
          where: {
            parentEventId: parentEventId,
            recurrenceIndex: { gt: targetLength },
          },
        }),
      );
    }
  }

  await prisma.$transaction(updates as any);

  // return updated parent and children
  const refreshed = await prisma.event.findUnique({
    where: { id: parentEventId },
    include: { childrenEvents: true },
  });

  return refreshed;
};

export default {
  createWeeklyEvents,
  updateWeeklyEvents,
};
