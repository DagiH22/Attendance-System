import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export class DashboardService {
  async getDashboardData() {
    const now = new Date();
    const activeStartThreshold = new Date(now.getTime() + 30 * 60000); // 30 mins before
    const activeEndThreshold = new Date(now.getTime() - 90 * 60000); // 1.5h after

    // 1. Summary Metrics
    const [totalMembers, activeMembers, totalEvents, activeEvents] =
      await Promise.all([
        prisma.member.count(),
        prisma.member.count({ where: { isActive: true } }),
        prisma.event.count({ where: { isActive: true } }),
        prisma.event.findMany({
          where: {
            startTime: { lte: activeStartThreshold },
            endTime: { gte: activeEndThreshold },
          },
          include: { _count: { select: { attendances: true } } },
        }),
      ]);

    // Avg attendance: use the most recent completed events so the metric reflects recent reality.
    // Computes: (avg attendees per event) / activeMembers
    const recentEventsForAverage = await prisma.event.findMany({
      where: {
        endTime: { lt: now },
        // For WEEKLY recurrence, only count occurrences (recurrenceIndex set).
        NOT: { AND: [{ type: "WEEKLY" as any }, { recurrenceIndex: null }] },
      },
      orderBy: { eventDate: "desc" },
      take: 10,
      include: { _count: { select: { attendances: true } } },
    });

    const avgAttendeesPerEvent = recentEventsForAverage.length
      ? recentEventsForAverage.reduce(
          (sum, e) => sum + e._count.attendances,
          0,
        ) / recentEventsForAverage.length
      : 0;

    const attendanceRate = activeMembers
      ? avgAttendeesPerEvent / activeMembers
      : 0;

    // 2. Alerts System
    // Fetch last 3 past events
    const last3Events = await prisma.event.findMany({
      where: {
        endTime: { lt: now },
        NOT: { AND: [{ type: "WEEKLY" as any }, { recurrenceIndex: null }] },
      },
      orderBy: { eventDate: "desc" },
      take: 3,
      select: { id: true, title: true, eventDate: true },
    });

    const last3EventIds = last3Events.map((e) => e.id);

    let absentAlerts: any[] = [];
    if (last3EventIds.length > 0) {
      // Mark which members attended each of the last events.
      const recentAttendances = await prisma.attendance.findMany({
        where: { eventId: { in: last3EventIds } },
        select: { memberId: true, eventId: true },
      });

      const attendedByEvent = new Map<string, Set<string>>();
      for (const eventId of last3EventIds) {
        attendedByEvent.set(eventId, new Set());
      }
      for (const row of recentAttendances) {
        attendedByEvent.get(row.eventId)?.add(row.memberId);
      }

      const activeMemberList = await prisma.member.findMany({
        where: { isActive: true },
        select: { id: true, name: true, email: true },
      });

      // Count consecutive absences starting from the most recent event.
      absentAlerts = activeMemberList
        .map((m) => {
          let consecutiveAbsences = 0;
          for (const eventId of last3EventIds) {
            const attended = attendedByEvent.get(eventId)?.has(m.id);
            if (attended) {
              break;
            }
            consecutiveAbsences += 1;
          }

          const status =
            consecutiveAbsences >= 3
              ? "Critical"
              : consecutiveAbsences >= 2
                ? "Warning"
                : "OK";

          return {
            ...m,
            consecutiveAbsences,
            status,
          };
        })
        .filter((a) => a.status !== "OK");
    }

    // Low Attendance Events
    const lowAttendanceEvents = await prisma.event
      .findMany({
        where: {
          endTime: { lt: now },
          NOT: { AND: [{ type: "WEEKLY" as any }, { recurrenceIndex: null }] },
        },
        include: { _count: { select: { attendances: true } } },
        orderBy: { eventDate: "desc" },
        take: 10,
      })
      .then((events) =>
        events
          .map((e) => ({
            ...e,
            rate: activeMembers ? e._count.attendances / activeMembers : 0,
          }))
          .filter((e) => e.rate < 0.5),
      );

    // 3. Analytics & Insights
    const attendanceByBatch = await prisma.member.groupBy({
      by: ["batch"],
      _count: { id: true },
    });

    const topAttendees = await prisma.member.findMany({
      select: {
        id: true,
        name: true,
        _count: { select: { attendances: true } },
      },
      orderBy: { attendances: { _count: "desc" } },
      take: 5,
    });

    return {
      summary: {
        totalMembers,
        activeMembers,
        totalEvents,
        activeEventsCount: activeEvents.length,
        attendanceRate,
      },
      alerts: {
        absentAlerts,
        lowAttendanceEvents,
        activeEvents: activeEvents.map((e) => ({
          id: e.id,
          title: e.title,
          attendancesCount: e._count.attendances,
        })),
      },
      analytics: {
        attendanceByBatch,
        topAttendees,
      },
    };
  }
}

export const dashboardService = new DashboardService();
