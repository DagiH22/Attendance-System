export interface SessionLike {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  status: "ACTIVE" | "UPCOMING" | "PAST" | "DEACTIVATED" | "CANCELLED" | string;
  attendanceOpen?: boolean;
  attendanceCount?: number;
  totalMembers?: number;
  createdAt?: string;
  cancelledAt?: string | null;
  studyId?: string | null;
}

export interface StudyGroupLike<T extends SessionLike = SessionLike> {
  id: string; // studyId or "STANDALONE"
  name: string;
  startDate?: string;
  endDate?: string;
  createdAt?: string;
  sessions: T[];
  averageTurnout?: number;
}

export type SortMode = "SMART" | "DATE" | "NAME" | "ATTENDANCE" | "STATUS";

/**
 * Pure session comparator inside a group:
 * - ACTIVE first
 * - UPCOMING soonest-first (ascending startTime)
 * - PAST most-recent-first (descending startTime)
 * - CANCELLED sessions last in their group (descending startTime)
 */
export function compareSessions<T extends SessionLike>(
  a: T,
  b: T,
  mode: SortMode = "SMART",
  direction: "asc" | "desc" = "asc",
  now: Date = new Date(),
): number {
  const isCancelledA = a.status === "CANCELLED" || Boolean(a.cancelledAt);
  const isCancelledB = b.status === "CANCELLED" || Boolean(b.cancelledAt);

  // Cancelled sessions are always placed at the end in SMART mode
  if (mode === "SMART") {
    if (isCancelledA && !isCancelledB) return 1;
    if (!isCancelledA && isCancelledB) return -1;
    if (isCancelledA && isCancelledB) {
      return new Date(b.startTime).getTime() - new Date(a.startTime).getTime();
    }

    const rankSession = (s: T): number => {
      if (s.status === "ACTIVE" || s.attendanceOpen) return 0;
      if (s.status === "UPCOMING" || new Date(s.startTime).getTime() > now.getTime()) return 1;
      return 2; // PAST
    };

    const rankA = rankSession(a);
    const rankB = rankSession(b);

    if (rankA !== rankB) {
      return rankA - rankB;
    }

    // Inside UPCOMING: soonest first
    if (rankA === 1) {
      return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
    }

    // Inside ACTIVE or PAST: most recent first
    return new Date(b.startTime).getTime() - new Date(a.startTime).getTime();
  }

  // Explicit Sort Modes
  let comp = 0;
  switch (mode) {
    case "NAME":
      comp = a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
      break;
    case "ATTENDANCE":
      comp = (b.attendanceCount || 0) - (a.attendanceCount || 0);
      break;
    case "STATUS":
      comp = (a.status || "").localeCompare(b.status || "");
      break;
    case "DATE":
    default:
      comp = new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
      break;
  }

  return direction === "asc" ? comp : -comp;
}

/**
 * Pure Study/Group comparator:
 * 1. Groups with an ACTIVE session first
 * 2. Groups with upcoming sessions ordered by nearest upcoming session (soonest first)
 * 3. Groups whose startDate is in future (by startDate ascending)
 * 4. Remaining groups by most recent session (newest first)
 * 5. Empty groups with past startDate by createdAt (newest first)
 * "Standalone" is treated with the same rules using its sessions.
 */
export function compareStudyGroups<T extends SessionLike>(
  groupA: StudyGroupLike<T>,
  groupB: StudyGroupLike<T>,
  mode: SortMode = "SMART",
  direction: "asc" | "desc" = "asc",
  now: Date = new Date(),
): number {
  if (mode !== "SMART") {
    let comp = 0;
    switch (mode) {
      case "NAME":
        comp = groupA.name.localeCompare(groupB.name, undefined, { sensitivity: "base" });
        break;
      case "ATTENDANCE": {
        const turnoutA = groupA.averageTurnout ?? computeAverageTurnout(groupA.sessions);
        const turnoutB = groupB.averageTurnout ?? computeAverageTurnout(groupB.sessions);
        comp = turnoutB - turnoutA;
        break;
      }
      case "DATE": {
        const dateA = getGroupRelevantDate(groupA, now);
        const dateB = getGroupRelevantDate(groupB, now);
        comp = dateA - dateB;
        break;
      }
      case "STATUS": {
        const hasActiveA = groupA.sessions.some((s) => s.status === "ACTIVE" || s.attendanceOpen);
        const hasActiveB = groupB.sessions.some((s) => s.status === "ACTIVE" || s.attendanceOpen);
        comp = Number(hasActiveB) - Number(hasActiveA);
        break;
      }
    }
    return direction === "asc" ? comp : -comp;
  }

  // SMART Sorting Mode
  const rankGroup = (group: StudyGroupLike<T>): { rank: number; score: number } => {
    const uncancelledSessions = group.sessions.filter(
      (s) => s.status !== "CANCELLED" && !s.cancelledAt,
    );

    // 1. ACTIVE session
    const activeSessions = uncancelledSessions.filter(
      (s) => s.status === "ACTIVE" || s.attendanceOpen,
    );
    if (activeSessions.length > 0) {
      const earliestActive = Math.min(...activeSessions.map((s) => new Date(s.startTime).getTime()));
      return { rank: 1, score: earliestActive };
    }

    // 2. UPCOMING session (soonest first)
    const upcomingSessions = uncancelledSessions.filter(
      (s) => s.status === "UPCOMING" || new Date(s.startTime).getTime() > now.getTime(),
    );
    if (upcomingSessions.length > 0) {
      const nearestUpcoming = Math.min(...upcomingSessions.map((s) => new Date(s.startTime).getTime()));
      return { rank: 2, score: nearestUpcoming };
    }

    // 3. Future startDate
    if (group.startDate) {
      const startMs = new Date(group.startDate).getTime();
      if (startMs > now.getTime()) {
        return { rank: 3, score: startMs };
      }
    }

    // 4. Remaining by most recent session (newest first)
    if (uncancelledSessions.length > 0) {
      const latestPast = Math.max(...uncancelledSessions.map((s) => new Date(s.startTime).getTime()));
      return { rank: 4, score: -latestPast }; // negative for descending
    }

    // 5. Empty groups by createdAt (newest first)
    const createdMs = group.createdAt ? new Date(group.createdAt).getTime() : 0;
    return { rank: 5, score: -createdMs }; // negative for descending
  };

  const scoreA = rankGroup(groupA);
  const scoreB = rankGroup(groupB);

  if (scoreA.rank !== scoreB.rank) {
    return scoreA.rank - scoreB.rank;
  }

  return scoreA.score - scoreB.score;
}

function computeAverageTurnout(sessions: SessionLike[]): number {
  const attendedSessions = sessions.filter(
    (s) => s.status === "PAST" || s.status === "ACTIVE",
  );
  if (attendedSessions.length === 0) return 0;

  const totalAttended = attendedSessions.reduce((sum, s) => sum + (s.attendanceCount || 0), 0);
  const totalPossible = attendedSessions.reduce((sum, s) => sum + (s.totalMembers || 0), 0);
  return totalPossible > 0 ? (totalAttended / totalPossible) * 100 : 0;
}

function getGroupRelevantDate(group: StudyGroupLike<any>, now: Date): number {
  const uncancelled = group.sessions.filter((s) => s.status !== "CANCELLED" && !s.cancelledAt);
  const upcoming = uncancelled
    .filter((s) => new Date(s.startTime).getTime() >= now.getTime())
    .map((s) => new Date(s.startTime).getTime())
    .sort((a, b) => a - b);

  if (upcoming.length > 0) return upcoming[0];

  const past = uncancelled
    .map((s) => new Date(s.startTime).getTime())
    .sort((a, b) => b - a);

  if (past.length > 0) return past[0];
  if (group.startDate) return new Date(group.startDate).getTime();
  return 0;
}
