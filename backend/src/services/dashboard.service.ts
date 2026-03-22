import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export class DashboardService {
  async getDashboardData() {
    const now = new Date();
    const activeStartThreshold = new Date(now.getTime() + 30 * 60000); // 30 mins before
    const activeEndThreshold = new Date(now.getTime() - 90 * 60000); // 1.5h after

    // 1. Summary Metrics
    const [
      totalMembers,
      activeMembers,
      totalEvents,
      activeEvents,
      totalAttendances,
    ] = await Promise.all([
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
      prisma.attendance.count(),
    ]);

    const attendanceRate =
      totalMembers && totalEvents
        ? totalAttendances / (totalMembers * totalEvents)
        : 0;

    // 2. Alerts System
    // Fetch last 3 past events
    const last3Events = await prisma.event.findMany({
      where: { endTime: { lt: now } },
      orderBy: { eventDate: "desc" },
      take: 3,
      select: { id: true, title: true, eventDate: true },
    });

    const last3EventIds = last3Events.map((e) => e.id);

    let absentAlerts: any[] = [];
    if (last3EventIds.length > 0) {
      // Find members who missed the last 2 or 3 events
      const recentAttendances = await prisma.attendance.groupBy({
        by: ["memberId"],
        where: { eventId: { in: last3EventIds } },
        _count: { eventId: true },
      });

      const attendedMemberIds = recentAttendances.map((a) => a.memberId);

      const missingMembers = await prisma.member.findMany({
        where: { id: { notIn: attendedMemberIds }, isActive: true },
        select: { id: true, name: true, email: true },
      });

      absentAlerts = missingMembers.map((m) => ({
        ...m,
        consecutiveAbsences: last3EventIds.length,
        status: last3EventIds.length >= 3 ? "Critical" : "Warning",
      }));
    }

    // Low Attendance Events
    const lowAttendanceEvents = await prisma.event
      .findMany({
        where: { endTime: { lt: now } },
        include: { _count: { select: { attendances: true } } },
        orderBy: { eventDate: "desc" },
        take: 10,
      })
      .then((events) =>
        events
          .map((e) => ({
            ...e,
            rate: totalMembers ? e._count.attendances / totalMembers : 0,
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
