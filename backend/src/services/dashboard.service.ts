import { PrismaClient, EventType } from "@prisma/client";
import {
  computeBatch,
  getEligibleMembers,
  getEventStats,
} from "./academic.service";

const prisma = new PrismaClient();

export class DashboardService {
  async getDashboardData() {
    const now = new Date();
    const activeStartThreshold = new Date(now.getTime() + 30 * 60000); // 30 mins before
    const activeEndThreshold = new Date(now.getTime() - 90 * 60000); // 1.5h after

    // 1. Summary Metrics
    const [totalMembers, activeMembers, totalEvents, activeEvents, allMembersList] =
      await Promise.all([
        prisma.member.count(),
        prisma.member.count({ where: { isActive: true } }),
        prisma.event.count({ where: { isActive: true, cancelledAt: null } }),
        prisma.event.findMany({
          where: {
            isActive: true,
            cancelledAt: null,
            startTime: { lte: activeStartThreshold },
            endTime: { gte: activeEndThreshold },
          },
          include: {
            study: { select: { id: true, name: true } },
            _count: {
              select: { attendances: { where: { removedAt: null } } },
            },
          },
        }),
        prisma.member.findMany({
          where: { isActive: true },
          select: {
            id: true,
            name: true,
            email: true,
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

    const mappedMembers = allMembersList.map((m) => ({
      ...m,
      entryAcademicYear: m.entryAcademicYear ?? 2025,
    }));

    // Recent completed events (non-cancelled)
    const recentEventsForAverage = await prisma.event.findMany({
      where: {
        cancelledAt: null,
        OR: [{ endedAt: { lte: now } }, { endTime: { lt: now } }],
        NOT: { AND: [{ type: EventType.WEEKLY }, { recurrenceIndex: null }] },
      },
      orderBy: { startTime: "desc" },
      take: 10,
      include: {
        study: true,
        _count: {
          select: { attendances: { where: { removedAt: null } } },
        },
      },
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

    // 2. Latest Completed Session with turnout and absentee count
    const latestEvent = recentEventsForAverage[0] || null;
    let latestCompletedSession: any = null;

    if (latestEvent) {
      const attendances = await prisma.attendance.findMany({
        where: { eventId: latestEvent.id, removedAt: null },
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
        latestEvent,
        mappedMembers,
        attendances,
        latestEvent.startTime,
      );

      const stats = getEventStats(latestEvent, eligible, attendances);

      latestCompletedSession = {
        id: latestEvent.id,
        title: latestEvent.title,
        startTime: latestEvent.startTime,
        endTime: latestEvent.endTime,
        studyId: latestEvent.studyId,
        studyName: latestEvent.study?.name || "Standalone",
        turnout: stats.present + stats.late,
        absenteeCount: stats.absent,
        attendanceRate: stats.attendanceRate,
        eligibleCount: stats.eligible,
      };
    }

    // 3. Studies, their average turnout, and "Needs Attention" sessions
    const activeStudies = await prisma.study.findMany({
      where: { isActive: true },
      include: {
        events: {
          where: {
            cancelledAt: null,
            OR: [{ endedAt: { lte: now } }, { endTime: { lt: now } }],
          },
          orderBy: { startTime: "desc" },
          include: {
            _count: {
              select: { attendances: { where: { removedAt: null } } },
            },
          },
        },
      },
    });

    // Compute average turnout per study
    const studyAverages = new Map<string, number>();
    const studySessionsTurnout = new Map<
      string,
      Array<{
        id: string;
        title: string;
        eventDate: Date;
        startTime: Date;
        rate: number;
        studyName: string;
        studyAvg: number;
      }>
    >();

    for (const study of activeStudies) {
      if (study.events.length === 0) continue;

      const eventRates: number[] = [];
      const sessionList: any[] = [];

      for (const ev of study.events) {
        const attCount = ev._count.attendances;
        const eligible = getEligibleMembers(
          { ...ev, study },
          mappedMembers,
          [],
          ev.startTime,
        );
        const rate = eligible.length > 0 ? attCount / eligible.length : 0;
        eventRates.push(rate);
        sessionList.push({
          id: ev.id,
          title: ev.title,
          eventDate: ev.eventDate,
          startTime: ev.startTime,
          rate,
          studyName: study.name,
        });
      }

      const studyAvg =
        eventRates.reduce((a, b) => a + b, 0) / eventRates.length;
      studyAverages.set(study.id, studyAvg);

      studySessionsTurnout.set(
        study.id,
        sessionList.map((s) => ({ ...s, studyAvg })),
      );
    }

    // "Needs Attention" = sessions whose turnout is well below that study's average (or <50% for standalone)
    const lowAttendanceEvents: any[] = [];

    // Study sessions well below study average
    for (const [, sessions] of studySessionsTurnout) {
      for (const s of sessions) {
        // Condition: rate is at least 15% below study average OR rate < 70% of study average
        if (s.rate < s.studyAvg - 0.15 || s.rate < 0.7 * s.studyAvg) {
          lowAttendanceEvents.push({
            id: s.id,
            title: s.title,
            eventDate: s.eventDate,
            rate: Math.round(s.rate * 1000) / 1000,
            studyName: s.studyName,
            studyAverage: Math.round(s.studyAvg * 1000) / 1000,
            reason: `Turnout (${(s.rate * 100).toFixed(1)}%) is below study average (${(s.studyAvg * 100).toFixed(1)}%)`,
          });
        }
      }
    }

    // Standalone past events < 50%
    const standalonePastEvents = await prisma.event.findMany({
      where: {
        studyId: null,
        cancelledAt: null,
        OR: [{ endedAt: { lte: now } }, { endTime: { lt: now } }],
        NOT: { AND: [{ type: EventType.WEEKLY }, { recurrenceIndex: null }] },
      },
      include: {
        _count: {
          select: { attendances: { where: { removedAt: null } } },
        },
      },
      orderBy: { startTime: "desc" },
      take: 10,
    });

    for (const ev of standalonePastEvents) {
      const rate = activeMembers ? ev._count.attendances / activeMembers : 0;
      if (rate < 0.5) {
        lowAttendanceEvents.push({
          id: ev.id,
          title: ev.title,
          eventDate: ev.eventDate,
          rate: Math.round(rate * 1000) / 1000,
          studyName: "Standalone",
          studyAverage: 0.5,
          reason: `Turnout (${(rate * 100).toFixed(1)}%) is below 50% threshold`,
        });
      }
    }

    // 4. Members at Risk: Missed the last 2 sessions of a given study (scoped per study)
    const membersAtRisk: any[] = [];
    const absentAlerts: any[] = [];

    for (const study of activeStudies) {
      // Last 2 completed sessions of this study
      const last2Sessions = study.events.slice(0, 2);
      if (last2Sessions.length < 2) continue;

      const session1 = last2Sessions[0];
      const session2 = last2Sessions[1];

      const [att1, att2] = await Promise.all([
        prisma.attendance.findMany({
          where: { eventId: session1.id, removedAt: null },
          select: { memberId: true },
        }),
        prisma.attendance.findMany({
          where: { eventId: session2.id, removedAt: null },
          select: { memberId: true },
        }),
      ]);

      const attended1 = new Set(att1.map((a) => a.memberId));
      const attended2 = new Set(att2.map((a) => a.memberId));

      const eligibleForStudy = mappedMembers.filter((m) => {
        const el1 = getEligibleMembers(
          { ...session1, study },
          [m],
          [],
          session1.startTime,
        );
        const el2 = getEligibleMembers(
          { ...session2, study },
          [m],
          [],
          session2.startTime,
        );
        return el1.length > 0 && el2.length > 0;
      });

      for (const m of eligibleForStudy) {
        if (!attended1.has(m.id) && !attended2.has(m.id)) {
          membersAtRisk.push({
            id: m.id,
            name: m.name,
            email: m.email,
            phoneNumber: m.phoneNumber,
            campus: m.campus,
            studyId: study.id,
            studyName: study.name,
            missedSessions: 2,
            sessionTitles: [session1.title, session2.title],
          });

          absentAlerts.push({
            id: m.id,
            name: m.name,
            email: m.email,
            consecutiveAbsences: 2,
            status: "Warning",
            studyName: study.name,
          });
        }
      }
    }

    // 5. Top Attendees Per Study
    const topAttendeesPerStudy: any[] = [];
    for (const study of activeStudies) {
      const studyEventIds = study.events.map((e) => e.id);
      if (studyEventIds.length === 0) continue;

      const topAttendeesRows = await prisma.attendance.groupBy({
        by: ["memberId"],
        where: {
          eventId: { in: studyEventIds },
          removedAt: null,
          status: { in: ["PRESENT", "LATE"] },
        },
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: 5,
      });

      const memberIds = topAttendeesRows.map((r) => r.memberId);
      const topMembers = await prisma.member.findMany({
        where: { id: { in: memberIds } },
        select: { id: true, name: true, uniqueId: true, campus: true },
      });
      const topMemberMap = new Map(topMembers.map((m) => [m.id, m]));

      topAttendeesPerStudy.push({
        studyId: study.id,
        studyName: study.name,
        topAttendees: topAttendeesRows.map((r) => {
          const m = topMemberMap.get(r.memberId);
          return {
            id: r.memberId,
            name: m?.name || "Unknown",
            uniqueId: m?.uniqueId || "",
            campus: m?.campus || "",
            attendedCount: r._count.id,
          };
        }),
      });
    }

    // Overall Top Attendees (across all events)
    const overallTopAttendees = await prisma.member.findMany({
      select: {
        id: true,
        name: true,
        _count: {
          select: { attendances: { where: { removedAt: null } } },
        },
      },
      orderBy: { attendances: { _count: "desc" } },
      take: 5,
    });

    const attendanceByBatch = await prisma.member.groupBy({
      by: ["batch"],
      _count: { id: true },
    });

    return {
      summary: {
        totalMembers,
        activeMembers,
        totalEvents,
        activeEventsCount: activeEvents.length,
        attendanceRate,
      },
      latestCompletedSession,
      needsAttention: lowAttendanceEvents,
      membersAtRisk,
      topAttendeesPerStudy,
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
        topAttendees: overallTopAttendees,
      },
    };
  }
}

export const dashboardService = new DashboardService();
