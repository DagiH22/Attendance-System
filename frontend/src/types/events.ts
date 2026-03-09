export type EventStatus = "UPCOMING" | "ACTIVE" | "PAST" | "DEACTIVATED";
export type EventType = "WEEKLY" | "MONTHLY" | "ONE_TIME";

export interface EventCreator {
  id: string;
  name: string;
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
}
