export interface Member {
  id: string;
  uniqueId: string;
  name: string;
  email: string;
  phone: string | null;
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
  member?: Pick<Member, "id" | "uniqueId" | "name" | "phone">;
}
