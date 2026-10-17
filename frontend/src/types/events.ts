export type EventStatus = "UPCOMING" | "ACTIVE" | "PAST" | "DEACTIVATED" | "CANCELLED";
export type EventType = "WEEKLY" | "MONTHLY" | "ONE_TIME";
export type SessionType = "EVENING" | "OVERNIGHT" | "OTHER";
export type AudienceType = "ALL" | "FINAL_YEAR" | "BATCHES";
export type AttendanceStatus = "PRESENT" | "LATE" | "EXCUSED";

export interface EventCreator {
  id: string;
  name: string;
}

export interface EventClusterSummary {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
}

export interface Study {
  id: string;
  name: string;
  description?: string | null;
  startDate: string;
  endDate: string;
  audienceType: AudienceType;
  audienceBatches: string[];
  requiredSessions?: number | null;
  defaultLateGraceMinutes?: number | null;
  isActive: boolean;
  sessionCount?: number;
  activeSessions?: number;
  events?: DashboardEvent[];
}

export interface EventStats {
  isCancelled: boolean;
  eligible: number;
  participants: number;
  present: number;
  late: number;
  excused: number;
  absentAmongParticipants: number;
  turnoutAmongParticipants: number | null;
  eligibleAttendanceRate: number | null;
  attendanceRate: number | null;
  absent: number;
}

export interface EventAbsentee {
  id: string;
  name: string;
  uniqueId: string;
  phoneNumber: string | null;
  campus: string;
  batch: string;
}

export interface DashboardEvent {
  id: string;
  title: string;
  description: string;
  startTime: string;
  endTime: string;
  status: EventStatus;
  attendanceOpen: boolean;
  location: string;
  eventType: EventType;
  sessionType?: SessionType;
  studyId?: string | null;
  study?: Study | null;
  plannedStartTime?: string | null;
  rescheduleReason?: string | null;
  rescheduledAt?: string | null;
  cancelReason?: string | null;
  cancelledAt?: string | null;
  lateGraceMinutes?: number | null;
  createdAt: string;
  createdBy: EventCreator;
  attendanceCount: number;
  totalMembers: number;
  stats?: EventStats;
  absentees?: EventAbsentee[];
  cluster?: EventClusterSummary | null;
  clusterLabel?: string | null;
}

export type AttendanceSortBy = "time" | "name";
export type AttendanceSortOrder = "asc" | "desc";

export interface EventAttendanceRecord {
  id?: string;
  memberId: string;
  name: string;
  email: string;
  phone: string | null;
  uniqueId: string;
  markedAt: string;
  isActive: boolean;
  status?: AttendanceStatus;
  excuseReason?: string | null;
  removedAt?: string | null;
  removeReason?: string | null;
}

export interface EventAttendanceResponse {
  data: EventAttendanceRecord[];
  totalCount: number;
  totalPages: number;
  currentPage: number;
}

export interface MemberGridSessionStatus {
  eventId: string;
  title: string;
  startTime: string;
  sessionType: SessionType;
  status: "PRESENT" | "LATE" | "EXCUSED" | "ABSENT" | "CANCELLED" | "NOT_ELIGIBLE";
  markedAt?: string;
  excuseReason?: string;
}

export interface MemberStudyRow {
  memberId: string;
  name: string;
  uniqueId: string;
  campus: string;
  effectiveBatch: string;
  phoneNumber: string | null;
  sessions: MemberGridSessionStatus[];
  attendedCount: number;
  excusedCount: number;
  absentCount: number;
  eligibleSessionCount: number;
  requiredSessions: number | null;
  isCompleted: boolean;
  droppedOff?: boolean;
  droppedOffAfterSession?: number | null;
}

export interface StudyTurnoutSession {
  eventId: string;
  title: string;
  startTime: string;
  endTime: string;
  sessionType: SessionType;
  isCancelled: boolean;
  eligible: number;
  participants: number;
  present: number;
  late: number;
  excused: number;
  absentAmongParticipants: number;
  turnoutAmongParticipants: number | null;
  eligibleAttendanceRate: number | null;
  attendanceRate: number | null;
  absent: number;
}

export interface StudyStatsResponse {
  study: Study;
  sessionSeries: StudyTurnoutSession[];
  averageTurnout: number | null;
  attendedAllMembers: Array<{
    id: string;
    name: string;
    uniqueId: string;
    campus: string;
    effectiveBatch: string;
  }>;
  attendedNoneMembers: Array<{
    id: string;
    name: string;
    uniqueId: string;
    campus: string;
    effectiveBatch: string;
  }>;
  droppedOffMembers?: Array<{
    id: string;
    name: string;
    uniqueId: string;
    campus: string;
    effectiveBatch: string;
    droppedOffAfterSession: number | null;
  }>;
  grid: MemberStudyRow[];
}
