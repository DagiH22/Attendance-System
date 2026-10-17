import { PrismaClient, EventType } from "@prisma/client";
import {
  computeBatch,
  getEligibleMembers,
  getEventStats,
  REGULAR_STUDY_ID,
  REGULAR_STUDY_NAME,
  STUDY_TURNOUT_DIFF_THRESHOLD,
  getEffectiveStudyId,
  isStudyOngoing,
  getHeldSessions,
  getStudyParticipants,
  computeParticipantTrailingMisses,
  checkAttendingOtherStudy,
} from "./academic.service";

const prisma = new PrismaClient();

export class DashboardService {
  async getDashboardData() {
    const now = new Date();
    const activeStartThreshold = new Date(now.getTime() + 30 * 60000); // 30 mins before
    const activeEndThreshold = new Date(now.getTime() - 90 * 60000); // 1.5h after

    // 1. Load foundational data in parallel
    const [
      totalMembers,
      activeMembers,
      totalEvents,
      activeEvents,
      allMembersList,
      allStudies,
      allEvents,
      allAttendances,
    ] = await Promise.all([
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
          uniqueId: true,
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
      prisma.study.findMany({
        orderBy: { createdAt: "desc" },
      }),
      prisma.event.findMany({
        where: { cancelledAt: null },
        include: {
          study: {
            select: { id: true, name: true, isActive: true, endDate: true },
          },
          _count: {
            select: { attendances: { where: { removedAt: null } } },
          },
        },
        orderBy: { startTime: "asc" },
      }),
      prisma.attendance.findMany({
        where: { removedAt: null },
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

    const mappedMembers = allMembersList.map((m) => ({
      ...m,
      entryAcademicYear: m.entryAcademicYear ?? 2025,
    }));
    const memberMap = new Map(mappedMembers.map((m) => [m.id, m]));

    // Study setup including built-in "Regular" pseudo-study
    const regularStudy = {
      id: REGULAR_STUDY_ID,
      name: REGULAR_STUDY_NAME,
      isActive: true,
      endDate: null,
      description: "Regular gatherings and standalone events",
      createdAt: new Date(0),
    };

    const studiesList = [regularStudy, ...allStudies];
    const ongoingStudies = studiesList.filter((s) => isStudyOngoing(s, now));
    const ongoingStudyIds = ongoingStudies.map((s) => s.id);

    // Group attendances by eventId and by studyId
    const attendancesByEvent = new Map<string, typeof allAttendances>();
    const attendancesByStudy = new Map<string, typeof allAttendances>();

    for (const att of allAttendances) {
      const evList = attendancesByEvent.get(att.eventId) || [];
      evList.push(att);
      attendancesByEvent.set(att.eventId, evList);
    }

    // Group events by effective studyId
    const eventsByStudy = new Map<string, typeof allEvents>();
    for (const ev of allEvents) {
      const effStudyId = getEffectiveStudyId(ev.studyId);
      const sEvents = eventsByStudy.get(effStudyId) || [];
      sEvents.push(ev);
      eventsByStudy.set(effStudyId, sEvents);

      const evAtts = attendancesByEvent.get(ev.id) || [];
      const sAtts = attendancesByStudy.get(effStudyId) || [];
      sAtts.push(...evAtts);
      attendancesByStudy.set(effStudyId, sAtts);
    }

    // 2. Held sessions and Recent completed events
    const allHeldSessions = getHeldSessions(allEvents, now);
    const recentHeldSessions = [...allHeldSessions]
      .reverse()
      .filter((e) => !(e.type === EventType.WEEKLY && e.recurrenceIndex === null))
      .slice(0, 10);

    // Latest Completed Session Hero
    const latestEvent = recentHeldSessions[0] || null;
    let latestCompletedSession: any = null;

    if (latestEvent) {
      const effStudyId = getEffectiveStudyId(latestEvent.studyId);
      const studyEvents = eventsByStudy.get(effStudyId) || [];
      const studyAtts = attendancesByStudy.get(effStudyId) || [];
      const eventEnd = latestEvent.endedAt || latestEvent.endTime;

      const participantsAsOfEnd = getStudyParticipants(
        effStudyId,
        studyEvents,
        studyAtts,
        eventEnd,
      );

      const eventAtts = attendancesByEvent.get(latestEvent.id) || [];
      const eligible = getEligibleMembers(
        latestEvent,
        mappedMembers,
        eventAtts,
        latestEvent.startTime,
      );

      const stats = getEventStats(
        latestEvent,
        eligible,
        eventAtts,
        participantsAsOfEnd.length,
      );

      latestCompletedSession = {
        event: {
          id: latestEvent.id,
          title: latestEvent.title,
          startTime: latestEvent.startTime,
          endTime: latestEvent.endTime,
          studyId: effStudyId,
          studyName: latestEvent.study?.name || (effStudyId === REGULAR_STUDY_ID ? REGULAR_STUDY_NAME : "Standalone"),
        },
        stats: {
          ...stats,
          attendanceRate: stats.turnoutAmongParticipants ?? stats.eligibleAttendanceRate ?? 0,
        },
        id: latestEvent.id,
        title: latestEvent.title,
        startTime: latestEvent.startTime,
        endTime: latestEvent.endTime,
        studyId: effStudyId,
        studyName: latestEvent.study?.name || (effStudyId === REGULAR_STUDY_ID ? REGULAR_STUDY_NAME : "Standalone"),
        turnout: stats.present + stats.late,
        absenteeCount: stats.absentAmongParticipants,
        attendanceRate: stats.turnoutAmongParticipants ?? stats.eligibleAttendanceRate ?? 0,
        turnoutAmongParticipants: stats.turnoutAmongParticipants,
        eligibleAttendanceRate: stats.eligibleAttendanceRate,
        eligibleCount: stats.eligible,
        participantsCount: stats.participants,
      };
    }

    // 3. Compute Study Turnouts and "Needs Attention" Sessions (turnout > 20% below study average)
    const lowAttendanceEvents: any[] = [];
    const studyAverages = new Map<string, number>();

    for (const study of studiesList) {
      const studyEvents = eventsByStudy.get(study.id) || [];
      const studyAtts = attendancesByStudy.get(study.id) || [];
      const heldSessions = getHeldSessions(studyEvents, now);

      if (heldSessions.length === 0) continue;

      const sessionTurnouts: Array<{
        session: (typeof heldSessions)[0];
        turnout: number;
        eligibleRate: number | null;
      }> = [];

      for (const sess of heldSessions) {
        const sessEnd = sess.endedAt || sess.endTime;
        const partsAsOf = getStudyParticipants(
          study.id,
          studyEvents,
          studyAtts,
          sessEnd,
        );
        const sessAtts = attendancesByEvent.get(sess.id) || [];
        const eligible = getEligibleMembers(
          sess,
          mappedMembers,
          sessAtts,
          sess.startTime,
        );
        const sessStats = getEventStats(
          sess,
          eligible,
          sessAtts,
          partsAsOf.length,
        );

        if (sessStats.turnoutAmongParticipants !== null) {
          sessionTurnouts.push({
            session: sess,
            turnout: sessStats.turnoutAmongParticipants,
            eligibleRate: sessStats.eligibleAttendanceRate,
          });
        }
      }

      if (sessionTurnouts.length === 0) continue;

      const studyAvg =
        sessionTurnouts.reduce((sum, s) => sum + s.turnout, 0) /
        sessionTurnouts.length;
      studyAverages.set(study.id, studyAvg);

      // Flag sessions whose turnout is well below study average (diff > STUDY_TURNOUT_DIFF_THRESHOLD)
      for (const item of sessionTurnouts) {
        if (item.turnout < studyAvg - STUDY_TURNOUT_DIFF_THRESHOLD) {
          lowAttendanceEvents.push({
            id: item.session.id,
            eventId: item.session.id,
            title: item.session.title,
            eventDate: item.session.eventDate,
            startTime: item.session.startTime,
            studyId: study.id,
            studyName: study.name,
            turnout: item.turnout,
            rate: item.turnout,
            turnoutAmongParticipants: item.turnout,
            eligibleAttendanceRate: item.eligibleRate,
            studyAverage: Math.round(studyAvg * 1000) / 1000,
            studyAverageTurnout: Math.round(studyAvg * 1000) / 1000,
            diff: Math.round((studyAvg - item.turnout) * 1000) / 1000,
            reason: `Turnout among participants (${Math.round(item.turnout * 100)}%) is ${Math.round((studyAvg - item.turnout) * 100)}% below study average (${Math.round(studyAvg * 100)}%)`,
          });
        }
      }
    }

    // Sort low attendance events by start time descending
    lowAttendanceEvents.sort(
      (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime(),
    );

    // 4. Members at Risk: Participants with trailingMisses >= 2 (WARNING) or >= 3 (CRITICAL)
    // ONLY for studies that are still ongoing. Never flag non-participants.
    const membersAtRisk: any[] = [];
    const absentAlerts: any[] = [];

    for (const study of ongoingStudies) {
      const studyEvents = eventsByStudy.get(study.id) || [];
      const studyAtts = attendancesByStudy.get(study.id) || [];
      const heldSessions = getHeldSessions(studyEvents, now);

      if (heldSessions.length === 0) continue;

      const participantIds = getStudyParticipants(
        study.id,
        studyEvents,
        studyAtts,
        now,
      );

      for (const mId of participantIds) {
        const m = memberMap.get(mId);
        if (!m) continue;

        const memberAtts = studyAtts.filter((a) => a.memberId === mId);
        const analysis = computeParticipantTrailingMisses(
          mId,
          heldSessions,
          memberAtts,
          true,
        );

        if (analysis.alertLevel !== null) {
          const attendingOtherStudy = checkAttendingOtherStudy(
            mId,
            study.id,
            allEvents,
            allAttendances,
            ongoingStudyIds,
            now,
          );

          const lastSession =
            analysis.lastAttendedSessionIndex && analysis.lastAttendedSessionIndex > 0
              ? heldSessions[analysis.lastAttendedSessionIndex - 1]
              : null;

          const alertObj = {
            id: m.id,
            memberId: m.id,
            name: m.name,
            memberName: m.name,
            uniqueId: m.uniqueId,
            email: m.email,
            phoneNumber: m.phoneNumber,
            campus: m.campus,
            batch: computeBatch(m, now),
            studyId: study.id,
            studyName: study.name,
            trailingMisses: analysis.trailingMisses,
            missedSessions: analysis.trailingMisses,
            alertLevel: analysis.alertLevel, // "WARNING" | "CRITICAL"
            attendingOtherStudy,
            lastAttendedSessionTitle: lastSession?.title || null,
            lastAttendedSessionNumber: analysis.lastAttendedSessionIndex,
          };

          membersAtRisk.push(alertObj);

          absentAlerts.push({
            id: m.id,
            name: m.name,
            email: m.email,
            consecutiveAbsences: analysis.trailingMisses,
            status: analysis.alertLevel === "CRITICAL" ? "Critical" : "Warning",
            alertLevel: analysis.alertLevel,
            studyName: study.name,
            attendingOtherStudy,
          });
        }
      }
    }

    // Sort members at risk: CRITICAL first, then by trailingMisses desc
    membersAtRisk.sort((a, b) => {
      if (a.alertLevel === "CRITICAL" && b.alertLevel !== "CRITICAL") return -1;
      if (b.alertLevel === "CRITICAL" && a.alertLevel !== "CRITICAL") return 1;
      return b.trailingMisses - a.trailingMisses;
    });

    // 5. Top Attendees Per Registered Study
    const topAttendeesPerStudy: any[] = [];
    for (const study of allStudies.filter((s) => s.isActive)) {
      const studyEvents = eventsByStudy.get(study.id) || [];
      const studyEventIds = studyEvents.map((e) => e.id);
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
        select: {
          id: true,
          name: true,
          uniqueId: true,
          campus: true,
          batch: true,
          entryAcademicYear: true,
          batchOverride: true,
        },
      });
      const topMemberMap = new Map(topMembers.map((m) => [m.id, m]));

      const membersList = topAttendeesRows.map((r) => {
        const m = topMemberMap.get(r.memberId);
        return {
          id: r.memberId,
          name: m?.name || "Unknown",
          uniqueId: m?.uniqueId || "",
          campus: m?.campus || "",
          effectiveBatch: m
            ? computeBatch(
                {
                  ...m,
                  entryAcademicYear: m.entryAcademicYear ?? 2025,
                },
                now,
              )
            : "",
          attendedCount: r._count.id,
        };
      });

      topAttendeesPerStudy.push({
        studyId: study.id,
        studyName: study.name,
        topAttendees: membersList,
        topMembers: membersList,
      });
    }

    // Overall average turnout among participants across recent sessions
    let recentTurnoutSum = 0;
    let recentTurnoutCount = 0;
    for (const sess of recentHeldSessions) {
      const effStudyId = getEffectiveStudyId(sess.studyId);
      const studyEvents = eventsByStudy.get(effStudyId) || [];
      const studyAtts = attendancesByStudy.get(effStudyId) || [];
      const partsAsOf = getStudyParticipants(
        effStudyId,
        studyEvents,
        studyAtts,
        sess.endedAt || sess.endTime,
      );
      const sessAtts = attendancesByEvent.get(sess.id) || [];
      const eligible = getEligibleMembers(
        sess,
        mappedMembers,
        sessAtts,
        sess.startTime,
      );
      const stats = getEventStats(sess, eligible, sessAtts, partsAsOf.length);
      if (stats.turnoutAmongParticipants !== null) {
        recentTurnoutSum += stats.turnoutAmongParticipants;
        recentTurnoutCount++;
      }
    }
    const overallTurnoutRate =
      recentTurnoutCount > 0 ? recentTurnoutSum / recentTurnoutCount : null;

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
        totalStudies: allStudies.length,
        activeStudiesCount: allStudies.filter((s) => s.isActive).length,
        attendanceRate: overallTurnoutRate,
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

