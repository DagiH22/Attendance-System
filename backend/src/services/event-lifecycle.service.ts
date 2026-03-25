import { PrismaClient, type Event } from "@prisma/client";

export type EventStatus = "UPCOMING" | "ACTIVE" | "PAST" | "DEACTIVATED";

const PRE_ACTIVE_WINDOW_MINUTES = 30;
const AUTO_CLOSE_WINDOW_MINUTES = 90;
const DEFAULT_EVENT_DURATION_HOURS = 2;
const SCHEDULER_INTERVAL_MS = 60_000;
const QUERY_LOOKBACK_HOURS = 2;
const QUERY_LOOKAHEAD_HOURS = 2;

let schedulerHandle: NodeJS.Timeout | null = null;

type EventLifecycleInput = Pick<
  Event,
  "eventDate" | "startTime" | "endTime" | "isActive" | "endedAt"
> & {
  manuallyClosedAt?: Date | null;
};

type SerializableEvent = Event & {
  manuallyClosedAt?: Date | null;
  _count?: { attendances?: number };
  cluster?: {
    id: string;
    title: string;
    startDate: Date;
    endDate: Date;
  } | null;
  clusterLabel?: string | null;
};

export type EventLifecycleSnapshot = {
  status: EventStatus;
  attendanceOpen: boolean;
  startTime: Date;
  endTime: Date;
  activationTime: Date;
  autoCloseTime: Date;
  manuallyClosedAt: Date | null;
};

const cloneDate = (value: Date) => new Date(value.getTime());

export const resolveEventStartTime = (
  event: Pick<Event, "eventDate" | "startTime">,
) => {
  if (event.startTime) {
    return new Date(event.startTime);
  }

  const fallback = new Date(event.eventDate);
  return fallback;
};

export const resolveEventEndTime = (
  event: Pick<Event, "eventDate" | "startTime" | "endTime">,
) => {
  if (event.endTime) {
    return new Date(event.endTime);
  }

  const fallback = resolveEventStartTime(event);
  fallback.setHours(fallback.getHours() + DEFAULT_EVENT_DURATION_HOURS);
  return fallback;
};

export const computeEventLifecycle = (
  event: EventLifecycleInput,
  referenceTime: Date = new Date(),
): EventLifecycleSnapshot => {
  const now = cloneDate(referenceTime);
  const startTime = resolveEventStartTime(event);
  const endTime = resolveEventEndTime(event);
  const manuallyClosedAt = event.manuallyClosedAt
    ? new Date(event.manuallyClosedAt)
    : null;
  const activationTime = new Date(
    startTime.getTime() - PRE_ACTIVE_WINDOW_MINUTES * 60 * 1000,
  );
  const autoCloseTime = new Date(
    endTime.getTime() + AUTO_CLOSE_WINDOW_MINUTES * 60 * 1000,
  );

  if (!event.isActive) {
    return {
      status: "DEACTIVATED",
      attendanceOpen: false,
      startTime,
      endTime,
      activationTime,
      autoCloseTime,
      manuallyClosedAt,
    };
  }

  if (manuallyClosedAt || event.endedAt || now >= autoCloseTime) {
    return {
      status: "PAST",
      attendanceOpen: false,
      startTime,
      endTime,
      activationTime,
      autoCloseTime,
      manuallyClosedAt,
    };
  }

  if (now >= activationTime) {
    return {
      status: "ACTIVE",
      attendanceOpen: true,
      startTime,
      endTime,
      activationTime,
      autoCloseTime,
      manuallyClosedAt,
    };
  }

  return {
    status: "UPCOMING",
    attendanceOpen: false,
    startTime,
    endTime,
    activationTime,
    autoCloseTime,
    manuallyClosedAt,
  };
};

export const serializeEventForResponse = (
  event: SerializableEvent,
  referenceTime: Date = new Date(),
) => {
  const lifecycle = computeEventLifecycle(event, referenceTime);
  const cluster = event.cluster
    ? {
        ...event.cluster,
        startDate: event.cluster.startDate.toISOString(),
        endDate: event.cluster.endDate.toISOString(),
      }
    : (event.cluster ?? null);

  return {
    ...event,
    startTime: lifecycle.startTime.toISOString(),
    endTime: lifecycle.endTime.toISOString(),
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
    endedAt: event.endedAt ? event.endedAt.toISOString() : null,
    manuallyClosedAt: event.manuallyClosedAt
      ? event.manuallyClosedAt.toISOString()
      : null,
    cluster,
    status: lifecycle.status,
    attendanceOpen: lifecycle.attendanceOpen,
  };
};

export const runEventLifecycleSweep = async (prisma: PrismaClient) => {
  const now = new Date();
  const lowerBound = new Date(
    now.getTime() - QUERY_LOOKBACK_HOURS * 60 * 60 * 1000,
  );
  const upperBound = new Date(
    now.getTime() + QUERY_LOOKAHEAD_HOURS * 60 * 60 * 1000,
  );

  const candidates = await prisma.event.findMany({
    where: {
      isActive: true,
      endedAt: null,
      OR: [
        {
          startTime: {
            gte: lowerBound,
            lte: upperBound,
          },
        },
        {
          endTime: {
            gte: lowerBound,
            lte: upperBound,
          },
        },
      ],
    },
  });

  const eventsToClose = candidates.filter((event) => {
    const lifecycle = computeEventLifecycle(event, now);
    return lifecycle.status === "PAST" && !event.endedAt;
  });

  if (eventsToClose.length === 0) {
    return { checked: candidates.length, autoClosed: 0 };
  }

  await prisma.$transaction(
    eventsToClose.map((event) =>
      prisma.event.update({
        where: { id: event.id },
        data: { endedAt: now },
      }),
    ),
  );

  return { checked: candidates.length, autoClosed: eventsToClose.length };
};

export const startEventLifecycleScheduler = (prisma: PrismaClient) => {
  if (schedulerHandle) {
    return schedulerHandle;
  }

  const runSweep = async () => {
    try {
      await runEventLifecycleSweep(prisma);
    } catch (error) {
      console.error("Error while running event lifecycle sweep:", error);
    }
  };

  void runSweep();
  schedulerHandle = setInterval(() => {
    void runSweep();
  }, SCHEDULER_INTERVAL_MS);

  return schedulerHandle;
};

export const stopEventLifecycleScheduler = () => {
  if (schedulerHandle) {
    clearInterval(schedulerHandle);
    schedulerHandle = null;
  }
};
