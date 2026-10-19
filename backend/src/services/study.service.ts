import { PrismaClient, Batch, Campus, EventType, SessionType, AudienceType } from "@prisma/client";
import {
  computeBatch,
  getEligibleMembers,
  getEventStats,
  resolveLateGraceMinutes,
  EventStatsResult,
  getStudyParticipants,
  getHeldSessions,
  isStudyOngoing,
  computeParticipantTrailingMisses,
  REGULAR_STUDY_ID,
  getStudyEvaluationDate,
  getNotParticipatingMembers,
  filterNotParticipatingMembers,
  NotParticipatingFilterOptions,
} from "./academic.service";
import {
  setTimeOnDate,
  addDays,
  normalizeToDateOnly,
} from "./recurrence.service";
import ExcelJS from "exceljs";

export interface CreateStudyInput {
  name: string;
  description?: string | null;
  startDate: Date | string;
  endDate: Date | string;
  audienceType?: AudienceType;
  audienceBatches?: Batch[];
  requiredSessions?: number | null;
  defaultLateGraceMinutes?: number | null;
}

export interface AddSessionsInput {
  mode: "one-time" | "weekly" | "custom";
  // For one-time:
  title?: string;
  description?: string;
  eventDate?: Date | string;
  startTime?: Date | string;
  endTime?: Date | string;
  location?: string;
  sessionType?: SessionType;
  lateGraceMinutes?: number | null;

  // For weekly:
  startDate?: Date | string;
  endDate?: Date | string;
  recurrenceLengthWeeks?: number;

  // For custom:
  sessions?: Array<{
    title?: string;
    description?: string;
    eventDate: Date | string;
    startTime: Date | string;
    endTime: Date | string;
    location?: string;
    sessionType?: SessionType;
    lateGraceMinutes?: number | null;
  }>;
}

export interface MemberGridSessionStatus {
  eventId: string;
  title: string;
  startTime: Date;
  sessionType: SessionType;
  status: "PRESENT" | "LATE" | "EXCUSED" | "ABSENT" | "NOT_ELIGIBLE" | "CANCELLED";
  markedAt?: Date;
  excuseReason?: string;
}

export interface MemberStudyRow {
  memberId: string;
  name: string;
  uniqueId: string;
  campus: Campus;
  effectiveBatch: Batch;
  phoneNumber: string;
  sessions: MemberGridSessionStatus[];
  attendedCount: number; // present + late
  excusedCount: number;
  absentCount: number;
  eligibleSessionCount: number;
  requiredSessions: number | null;
  isCompleted: boolean;
  droppedOff?: boolean;
  droppedOffAfterSession?: number | null;
}

export class StudyService {
  constructor(private prisma: PrismaClient) {}

  async getAllStudies() {
    const studies = await this.prisma.study.findMany({
      orderBy: { startDate: "desc" },
      include: {
        events: {
          select: {
            id: true,
            title: true,
            startTime: true,
            endTime: true,
            sessionType: true,
            cancelledAt: true,
            endedAt: true,
            isActive: true,
            _count: {
              select: {
                attendances: {
                  where: { removedAt: null },
                },
              },
            },
          },
        },
      },
    });

    const now = new Date();

    return studies.map((study) => {
      const activeEvents = study.events.filter((e) => e.isActive && !e.cancelledAt);
      const completedEvents = activeEvents.filter(
        (e) => e.endedAt || new Date(e.endTime) <= now,
      );
      const upcomingEvents = activeEvents.filter(
        (e) => !e.endedAt && new Date(e.endTime) > now,
      );
      const cancelledEvents = study.events.filter((e) => Boolean(e.cancelledAt));

      return {
        id: study.id,
        name: study.name,
        description: study.description,
        startDate: study.startDate,
        endDate: study.endDate,
        audienceType: study.audienceType,
        audienceBatches: study.audienceBatches,
        requiredSessions: study.requiredSessions,
        defaultLateGraceMinutes: study.defaultLateGraceMinutes,
        isActive: study.isActive,
        createdAt: study.createdAt,
        updatedAt: study.updatedAt,
        sessionCounts: {
          total: study.events.length,
          active: activeEvents.length,
          completed: completedEvents.length,
          upcoming: upcomingEvents.length,
          cancelled: cancelledEvents.length,
        },
      };
    });
  }

  async getStudyById(id: string) {
    const study = await this.prisma.study.findUnique({
      where: { id },
      include: {
        events: {
          orderBy: { startTime: "asc" },
          include: {
            _count: {
              select: {
                attendances: {
                  where: { removedAt: null },
                },
              },
            },
          },
        },
      },
    });

    if (!study) return null;

    const stats = await this.getStudyStats(id);

    return {
      study,
      stats,
    };
  }

  async createStudy(adminId: string, input: CreateStudyInput) {
    const startDate = normalizeToDateOnly(new Date(input.startDate));
    const endDate = normalizeToDateOnly(new Date(input.endDate));

    return this.prisma.study.create({
      data: {
        name: input.name.trim(),
        description: input.description?.trim() || null,
        startDate,
        endDate,
        audienceType: input.audienceType || "ALL",
        audienceBatches: input.audienceBatches || [],
        requiredSessions: input.requiredSessions ?? null,
        defaultLateGraceMinutes: input.defaultLateGraceMinutes ?? 15,
        isActive: true,
      },
    });
  }

  async updateStudy(id: string, input: Partial<CreateStudyInput> & { isActive?: boolean }) {
    const data: any = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.description !== undefined) data.description = input.description?.trim() || null;
    if (input.startDate) data.startDate = normalizeToDateOnly(new Date(input.startDate));
    if (input.endDate) data.endDate = normalizeToDateOnly(new Date(input.endDate));
    if (input.audienceType) data.audienceType = input.audienceType;
    if (input.audienceBatches) data.audienceBatches = input.audienceBatches;
    if (input.requiredSessions !== undefined) data.requiredSessions = input.requiredSessions;
    if (input.defaultLateGraceMinutes !== undefined)
      data.defaultLateGraceMinutes = input.defaultLateGraceMinutes;
    if (input.isActive !== undefined) data.isActive = input.isActive;

    return this.prisma.study.update({
      where: { id },
      data,
    });
  }

  async deleteStudy(id: string, moveSessionsToStandalone: boolean = false) {
    const sessionCount = await this.prisma.event.count({
      where: { studyId: id },
    });

    if (sessionCount > 0 && !moveSessionsToStandalone) {
      const error: any = new Error(
        "Cannot delete a study that contains sessions. Please archive it instead, or confirm moving its sessions to Standalone.",
      );
      error.statusCode = 400;
      error.sessionCount = sessionCount;
      throw error;
    }

    if (sessionCount > 0 && moveSessionsToStandalone) {
      await this.prisma.event.updateMany({
        where: { studyId: id },
        data: { studyId: null },
      });
    }

    return this.prisma.study.delete({
      where: { id },
    });
  }

  async addSessionsToStudy(
    studyId: string,
    adminId: string,
    input: AddSessionsInput,
  ) {
    const study = await this.prisma.study.findUnique({
      where: { id: studyId },
    });
    if (!study) throw new Error("Study not found");

    const defaultLocation = "Main Hall";
    const defaultGrace = study.defaultLateGraceMinutes ?? 15;

    if (input.mode === "one-time") {
      const eventDate = normalizeToDateOnly(
        new Date(input.eventDate || input.startTime || study.startDate),
      );
      const startTime = new Date(input.startTime || eventDate);
      const endTime = new Date(input.endTime || new Date(startTime.getTime() + 2 * 3600 * 1000));

      const title = input.title?.trim() || `${study.name} - Session`;
      const description = input.description?.trim() || study.description || title;
      const location = input.location?.trim() || defaultLocation;
      const sessionType = input.sessionType || SessionType.EVENING;

      const created = await this.prisma.event.create({
        data: {
          title,
          description,
          eventDate,
          startTime,
          endTime,
          plannedStartTime: startTime,
          type: EventType.ONE_TIME,
          sessionType,
          location,
          lateGraceMinutes: input.lateGraceMinutes ?? defaultGrace,
          studyId: study.id,
          createdById: adminId,
        },
      });

      return [created];
    }

    if (input.mode === "weekly") {
      const startDateOnly = normalizeToDateOnly(
        new Date(input.startDate || input.startTime || study.startDate),
      );
      const startTimeSource = new Date(input.startTime || startDateOnly);
      const endTimeSource = new Date(
        input.endTime || new Date(startTimeSource.getTime() + 2 * 3600 * 1000),
      );

      const title = input.title?.trim() || study.name;
      const description = input.description?.trim() || study.description || title;
      const location = input.location?.trim() || defaultLocation;
      const sessionType = input.sessionType || SessionType.EVENING;

      const length = (() => {
        const weeks = input.recurrenceLengthWeeks || (input as any).weeksCount;
        if (weeks && weeks >= 1) {
          return Math.floor(weeks);
        }
        if (input.endDate) {
          const endDateOnly = normalizeToDateOnly(new Date(input.endDate));
          const diffDays = Math.floor(
            (endDateOnly.getTime() - startDateOnly.getTime()) / (1000 * 3600 * 24),
          );
          return Math.max(1, Math.floor(diffDays / 7) + 1);
        }
        return 8; // Default 8 sessions
      })();

      const week1Date = startDateOnly;
      const week1Start = setTimeOnDate(week1Date, startTimeSource);
      const week1End = setTimeOnDate(week1Date, endTimeSource);

      const week1 = await this.prisma.event.create({
        data: {
          title: `${title} - Session 1`,
          description,
          eventDate: week1Date,
          startTime: week1Start,
          endTime: week1End,
          plannedStartTime: week1Start,
          type: EventType.WEEKLY,
          sessionType,
          location,
          lateGraceMinutes: input.lateGraceMinutes ?? defaultGrace,
          studyId: study.id,
          parentEventId: null,
          recurrenceIndex: 1,
          recurrenceLengthWeeks: length,
          createdById: adminId,
        },
      });

      const rest: any[] = [];
      for (let i = 1; i < length; i++) {
        const occDate = addDays(startDateOnly, i * 7);
        const occStart = setTimeOnDate(occDate, startTimeSource);
        const occEnd = setTimeOnDate(occDate, endTimeSource);

        rest.push(
          this.prisma.event.create({
            data: {
              title: `${title} - Session ${i + 1}`,
              description,
              eventDate: occDate,
              startTime: occStart,
              endTime: occEnd,
              plannedStartTime: occStart,
              type: EventType.WEEKLY,
              sessionType,
              location,
              lateGraceMinutes: input.lateGraceMinutes ?? defaultGrace,
              studyId: study.id,
              parentEventId: week1.id,
              recurrenceIndex: i + 1,
              recurrenceLengthWeeks: length,
              createdById: adminId,
            },
          }),
        );
      }

      const createdRest = rest.length > 0 ? await this.prisma.$transaction(rest) : [];
      return [week1, ...createdRest];
    }

    if (input.mode === "custom") {
      const sessions = input.sessions || [];
      if (sessions.length === 0) {
        throw new Error("At least one session is required in custom mode");
      }

      const creates: any[] = [];
      for (let i = 0; i < sessions.length; i++) {
        const item = sessions[i];
        const eventDate = normalizeToDateOnly(
          new Date(item.eventDate || item.startTime || study.startDate),
        );
        const startTime = new Date(item.startTime || eventDate);
        const endTime = new Date(item.endTime || new Date(startTime.getTime() + 2 * 3600 * 1000));
        const title = item.title?.trim() || `${study.name} - Session ${i + 1}`;
        const description = item.description?.trim() || study.description || title;
        const location = item.location?.trim() || input.location?.trim() || defaultLocation;
        const sessionType = item.sessionType || SessionType.EVENING;

        creates.push(
          this.prisma.event.create({
            data: {
              title,
              description,
              eventDate,
              startTime,
              endTime,
              plannedStartTime: startTime,
              type: EventType.ONE_TIME,
              sessionType,
              location,
              lateGraceMinutes: item.lateGraceMinutes ?? input.lateGraceMinutes ?? defaultGrace,
              studyId: study.id,
              recurrenceIndex: i + 1,
              createdById: adminId,
            },
          }),
        );
      }

      return this.prisma.$transaction(creates);
    }

    throw new Error(`Unsupported session mode: ${input.mode}`);
  }

  async getStudyStats(studyId: string) {
    const study = await this.prisma.study.findUnique({
      where: { id: studyId },
      include: {
        events: {
          orderBy: { startTime: "asc" },
        },
      },
    });

    if (!study) throw new Error("Study not found");

    const allMembers = await this.prisma.member.findMany({
      select: {
        id: true,
        name: true,
        uniqueId: true,
        phoneNumber: true,
        campus: true,
        batch: true,
        entryAcademicYear: true,
        batchOverride: true,
        createdAt: true,
        deactivatedAt: true,
      },
    });

    const eventIds = study.events.map((e) => e.id);
    const attendances = await this.prisma.attendance.findMany({
      where: {
        eventId: { in: eventIds },
      },
      select: {
        id: true,
        memberId: true,
        eventId: true,
        status: true,
        markedAt: true,
        removedAt: true,
        excuseReason: true,
      },
    });

    const activeEvents = study.events.filter((e) => !e.cancelledAt);
    const now = new Date();
    const isOngoing = isStudyOngoing(study, now);
    const heldSessions = getHeldSessions(study.events, now);

    // Compute stats per session
    const sessionSeries = activeEvents.map((event) => {
      const eligible = getEligibleMembers(
        { ...event, study },
        allMembers.map((m) => ({
          ...m,
          entryAcademicYear: m.entryAcademicYear ?? 2025,
        })),
        attendances,
        event.startTime,
      );

      const participants = getStudyParticipants(
        study.id,
        activeEvents,
        attendances,
        event.endTime,
      );

      const stats = getEventStats(
        { ...event, study },
        eligible,
        attendances,
        participants.length,
        new Set(participants),
      );

      return {
        eventId: event.id,
        title: event.title,
        startTime: event.startTime,
        endTime: event.endTime,
        sessionType: event.sessionType,
        ...stats,
      };
    });

    // Average turnout across completed non-cancelled sessions
    const completedSessions = sessionSeries.filter(
      (s) => new Date(s.endTime) <= now && s.attendanceRate !== null,
    );
    const averageTurnout =
      completedSessions.length > 0
        ? Math.round(
            (completedSessions.reduce(
              (sum, s) => sum + (s.attendanceRate || 0),
              0,
            ) /
              completedSessions.length) *
              1000,
          ) / 1000
        : null;

    // Member x Session Grid
    const attendanceMap = new Map<string, Map<string, (typeof attendances)[0]>>();
    for (const a of attendances) {
      if (!attendanceMap.has(a.memberId)) {
        attendanceMap.set(a.memberId, new Map());
      }
      attendanceMap.get(a.memberId)!.set(a.eventId, a);
    }

    const memberRows: MemberStudyRow[] = [];
    const attendedAllMembers: Array<{
      id: string;
      name: string;
      uniqueId: string;
      campus: Campus;
      effectiveBatch: Batch;
    }> = [];
    const attendedNoneMembers: Array<{
      id: string;
      name: string;
      uniqueId: string;
      campus: Campus;
      effectiveBatch: Batch;
    }> = [];
    const droppedOffMembers: Array<{
      id: string;
      name: string;
      uniqueId: string;
      campus: Campus;
      effectiveBatch: Batch;
      droppedOffAfterSession: number | null;
    }> = [];

    for (const member of allMembers) {
      const memberEntryYear = member.entryAcademicYear ?? 2025;
      const effectiveBatch = computeBatch(
        {
          campus: member.campus,
          entryAcademicYear: memberEntryYear,
          batchOverride: member.batchOverride,
        },
        study.startDate,
      );

      let attendedCount = 0;
      let excusedCount = 0;
      let absentCount = 0;
      let eligibleCount = 0;

      const sessions: MemberGridSessionStatus[] = [];

      for (const event of study.events) {
        if (event.cancelledAt) {
          sessions.push({
            eventId: event.id,
            title: event.title,
            startTime: event.startTime,
            sessionType: event.sessionType,
            status: "CANCELLED",
          });
          continue;
        }

        const eligibleList = getEligibleMembers(
          { ...event, study },
          [{ ...member, entryAcademicYear: memberEntryYear }],
          attendances,
          event.startTime,
        );

        const isEligible = eligibleList.length > 0;
        const memberAtt = attendanceMap.get(member.id)?.get(event.id);

        if (!isEligible && !memberAtt) {
          sessions.push({
            eventId: event.id,
            title: event.title,
            startTime: event.startTime,
            sessionType: event.sessionType,
            status: "NOT_ELIGIBLE",
          });
          continue;
        }

        eligibleCount++;

        if (memberAtt && !memberAtt.removedAt) {
          if (memberAtt.status === "PRESENT") {
            attendedCount++;
            sessions.push({
              eventId: event.id,
              title: event.title,
              startTime: event.startTime,
              sessionType: event.sessionType,
              status: "PRESENT",
              markedAt: memberAtt.markedAt,
            });
          } else if (memberAtt.status === "LATE") {
            attendedCount++;
            sessions.push({
              eventId: event.id,
              title: event.title,
              startTime: event.startTime,
              sessionType: event.sessionType,
              status: "LATE",
              markedAt: memberAtt.markedAt,
            });
          } else if (memberAtt.status === "EXCUSED") {
            excusedCount++;
            sessions.push({
              eventId: event.id,
              title: event.title,
              startTime: event.startTime,
              sessionType: event.sessionType,
              status: "EXCUSED",
              excuseReason: memberAtt.excuseReason || undefined,
            });
          }
        } else {
          absentCount++;
          sessions.push({
            eventId: event.id,
            title: event.title,
            startTime: event.startTime,
            sessionType: event.sessionType,
            status: "ABSENT",
          });
        }
      }

      // Only include member in the study grid if they were eligible for at least one session
      if (eligibleCount > 0) {
        const required = study.requiredSessions ?? null;
        const isCompleted =
          required !== null
            ? attendedCount >= required
            : attendedCount === activeEvents.length;

        // Trailing misses & dropped off status
        const trailingRes = computeParticipantTrailingMisses(
          member.id,
          heldSessions,
          attendances,
          isOngoing,
        );

        const row: MemberStudyRow = {
          memberId: member.id,
          name: member.name,
          uniqueId: member.uniqueId,
          campus: member.campus,
          effectiveBatch,
          phoneNumber: member.phoneNumber,
          sessions,
          attendedCount,
          excusedCount,
          absentCount,
          eligibleSessionCount: eligibleCount,
          requiredSessions: required,
          isCompleted,
          droppedOff: !isOngoing && trailingRes.droppedOff,
          droppedOffAfterSession: !isOngoing ? trailingRes.droppedOffAfterSession : null,
        };
        memberRows.push(row);

        if (activeEvents.length > 0) {
          if (attendedCount === eligibleCount) {
            attendedAllMembers.push({
              id: member.id,
              name: member.name,
              uniqueId: member.uniqueId,
              campus: member.campus,
              effectiveBatch,
            });
          }
          if (attendedCount === 0) {
            attendedNoneMembers.push({
              id: member.id,
              name: member.name,
              uniqueId: member.uniqueId,
              campus: member.campus,
              effectiveBatch,
            });
          }
          if (!isOngoing && trailingRes.droppedOff) {
            droppedOffMembers.push({
              id: member.id,
              name: member.name,
              uniqueId: member.uniqueId,
              campus: member.campus,
              effectiveBatch,
              droppedOffAfterSession: trailingRes.droppedOffAfterSession,
            });
          }
        }
      }
    }

    return {
      study: {
        id: study.id,
        name: study.name,
        description: study.description,
        startDate: study.startDate,
        endDate: study.endDate,
        audienceType: study.audienceType,
        audienceBatches: study.audienceBatches,
        requiredSessions: study.requiredSessions,
        defaultLateGraceMinutes: study.defaultLateGraceMinutes,
        totalSessions: study.events.length,
        activeSessions: activeEvents.length,
      },
      sessionSeries,
      averageTurnout,
      attendedAllMembers,
      attendedNoneMembers,
      droppedOffMembers,
      grid: memberRows,
    };
  }

  async exportStudyToExcel(studyId: string): Promise<ExcelJS.Workbook> {
    const stats = await this.getStudyStats(studyId);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(
      stats.study.name.slice(0, 31).replace(/[\\/*?:[\]]/g, "-") || "Study Grid",
    );

    // Columns: Name, Unique ID, Campus, Batch, Phone, [Sessions...], Attended, Excused, Absent, Completed
    const sessionCols = stats.study.totalSessions > 0
      ? stats.sessionSeries.map((s, idx) => ({
          header: `S${idx + 1}: ${s.title}`,
          key: `session_${s.eventId}`,
          width: 15,
        }))
      : [];

    sheet.columns = [
      { header: "Name", key: "name", width: 22 },
      { header: "Unique ID", key: "uniqueId", width: 16 },
      { header: "Campus", key: "campus", width: 14 },
      { header: "Batch", key: "batch", width: 14 },
      { header: "Phone", key: "phone", width: 16 },
      ...sessionCols,
      { header: "Attended", key: "attended", width: 12 },
      { header: "Excused", key: "excused", width: 12 },
      { header: "Absent", key: "absent", width: 12 },
      { header: "Completed", key: "completed", width: 14 },
    ];

    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE0E7FF" },
    };

    for (const row of stats.grid) {
      const rowData: Record<string, any> = {
        name: row.name,
        uniqueId: row.uniqueId,
        campus: row.campus,
        batch: row.effectiveBatch,
        phone: row.phoneNumber,
        attended: row.attendedCount,
        excused: row.excusedCount,
        absent: row.absentCount,
        completed: row.isCompleted ? "YES" : "NO",
      };

      for (const s of row.sessions) {
        let code = "-";
        if (s.status === "PRESENT") code = "P";
        else if (s.status === "LATE") code = "L";
        else if (s.status === "EXCUSED") code = "E";
        else if (s.status === "ABSENT") code = "A";
        else if (s.status === "NOT_ELIGIBLE") code = "N/A";
        else if (s.status === "CANCELLED") code = "C";
        rowData[`session_${s.eventId}`] = code;
      }

      const excelRow = sheet.addRow(rowData);

      // Color code cells
      for (const s of row.sessions) {
        const cell = excelRow.getCell(`session_${s.eventId}`);
        if (cell.value === "P") {
          cell.font = { color: { argb: "FF16A34A" }, bold: true };
        } else if (cell.value === "L") {
          cell.font = { color: { argb: "FFD97706" }, bold: true };
        } else if (cell.value === "E") {
          cell.font = { color: { argb: "FF2563EB" }, bold: true };
        } else if (cell.value === "A") {
          cell.font = { color: { argb: "FFDC2626" }, bold: true };
        }
      }
    }

    return workbook;
  }

  async getNotParticipating(
    studyId: string,
    filters: NotParticipatingFilterOptions & { page?: number; limit?: number } = {},
  ) {
    const study = await this.prisma.study.findUnique({
      where: { id: studyId },
    });
    if (!study) {
      throw new Error("Study not found");
    }

    const now = new Date();

    const [allMembers, studyEvents, studyAttendances, allEvents, allAttendances, allStudies] =
      await Promise.all([
        this.prisma.member.findMany({
          select: {
            id: true,
            name: true,
            uniqueId: true,
            phoneNumber: true,
            campus: true,
            batch: true,
            department: true,
            entryAcademicYear: true,
            batchOverride: true,
            createdAt: true,
            deactivatedAt: true,
            isActive: true,
          },
        }),
        this.prisma.event.findMany({
          where: { studyId },
          orderBy: { startTime: "asc" },
        }),
        this.prisma.attendance.findMany({
          where: {
            removedAt: null,
            event: { studyId },
          },
        }),
        this.prisma.event.findMany({
          where: { cancelledAt: null },
          select: { id: true, studyId: true, startTime: true, endTime: true, cancelledAt: true },
        }),
        this.prisma.attendance.findMany({
          where: { removedAt: null },
          select: { id: true, memberId: true, eventId: true, status: true, markedAt: true, removedAt: true },
        }),
        this.prisma.study.findMany({
          select: { id: true, isActive: true, endDate: true },
        }),
      ]);

    const ongoingStudyIds = [
      REGULAR_STUDY_ID,
      ...allStudies.filter((s) => isStudyOngoing(s, now)).map((s) => s.id),
    ];

    const result = getNotParticipatingMembers(
      study,
      allMembers.map((m) => ({ ...m, entryAcademicYear: m.entryAcademicYear ?? 2025 })),
      studyEvents,
      studyAttendances,
      allEvents,
      allAttendances,
      ongoingStudyIds,
      now,
    );

    const filtered = filterNotParticipatingMembers(result.members, filters);

    const page = Math.max(1, Number(filters.page) || 1);
    const limit = filters.limit ? Math.max(1, Number(filters.limit)) : 50;
    const totalFiltered = filtered.length;
    const totalPages = Math.ceil(totalFiltered / limit) || 1;
    const paginatedMembers = filtered.slice((page - 1) * limit, page * limit);

    const departments = Array.from(
      new Set(result.members.map((m) => m.department).filter(Boolean)),
    ).sort() as string[];

    return {
      study: {
        id: study.id,
        name: study.name,
        audienceType: study.audienceType,
        audienceBatches: study.audienceBatches,
        audienceLabel: result.audienceLabel,
      },
      evaluationDate: result.evaluationDate,
      isOngoing: result.isOngoing,
      totalEligible: result.totalEligible,
      totalParticipants: result.totalParticipants,
      totalNotParticipating: result.totalNotParticipating,
      totalFiltered,
      page,
      limit,
      totalPages,
      audienceBatches: result.audienceBatches,
      departments,
      members: paginatedMembers,
      allFilteredCount: totalFiltered,
    };
  }

  async exportNotParticipatingToExcel(
    studyId: string,
    filters: NotParticipatingFilterOptions = {},
  ): Promise<{ workbook: ExcelJS.Workbook; studyName: string }> {
    const data = await this.getNotParticipating(studyId, {
      ...filters,
      page: 1,
      limit: 100000,
    });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(
      "Not Participating".slice(0, 31),
    );

    sheet.columns = [
      { header: "Unique ID", key: "uniqueId", width: 16 },
      { header: "Full Name", key: "name", width: 26 },
      { header: "Phone Number", key: "phoneNumber", width: 18 },
      { header: "Campus", key: "campus", width: 14 },
      { header: "Effective Batch", key: "effectiveBatch", width: 16 },
      { header: "Department", key: "department", width: 24 },
      { header: "Status / Badges", key: "badges", width: 28 },
    ];

    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1E3A8A" }, // Dark blue
    };

    for (const m of data.members) {
      const badgeText = m.badges.length > 0 ? m.badges.join(", ") : "Not Participating";
      const row = sheet.addRow({
        uniqueId: m.uniqueId,
        name: m.name,
        phoneNumber: m.phoneNumber || "—",
        campus: m.campus,
        effectiveBatch: m.effectiveBatch,
        department: m.department || "—",
        badges: badgeText,
      });

      if (m.attendingOtherStudy) {
        row.font = { color: { argb: "FF6B7280" } }; // Muted grey
      }
    }

    return { workbook, studyName: data.study.name };
  }
}
