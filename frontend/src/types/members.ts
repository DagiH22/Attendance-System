export interface Member {
  id: string;
  uniqueId: string;
  name: string;
  email: string;
  phoneNumber: string | null;
  department?: string | null;
  batch?: string | null;
  campus?: string | null;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface AttendanceRecordResponse {
  message?: string;
  error?: string;
  attendance?: {
    id: string;
    memberId: string;
    eventId: string;
    markedById: string;
    markedMethod: "QR" | "MANUAL";
    markedAt: string;
  };
  member?: Pick<Member, "id" | "uniqueId" | "name" | "phoneNumber">;
}
