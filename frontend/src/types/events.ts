export type EventStatus = "UPCOMING" | "ACTIVE" | "PAST" | "DEACTIVATED";
export type EventType = "WEEKLY" | "MONTHLY" | "ONE_TIME";

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
  createdAt: string;
  createdBy: EventCreator;
  attendanceCount: number;
  totalMembers: number;
  cluster?: EventClusterSummary | null;
  clusterLabel?: string | null;
}

export type AttendanceSortBy = "time" | "name";
export type AttendanceSortOrder = "asc" | "desc";

export interface EventAttendanceRecord {
  memberId: string;
  name: string;
  email: string;
  phone: string | null;
  uniqueId: string;
  markedAt: string;
  isActive: boolean;
}

export interface EventAttendanceResponse {
  data: EventAttendanceRecord[];
  totalCount: number;
  totalPages: number;
  currentPage: number;
}
