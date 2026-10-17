export interface Member {
  id: string;
  uniqueId: string;
  name: string;
  email: string;
  phoneNumber: string | null;
  department?: string | null;
  batch?: string | null;
  effectiveBatch?: string | null;
  campus?: string | null;
  gender: "MALE" | "FEMALE";
  isActive: boolean;
  entryAcademicYear?: number | null;
  batchOverride?: string | null;
  deactivatedAt?: string | null;
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
    status?: "PRESENT" | "LATE" | "EXCUSED";
    excuseReason?: string | null;
    removedAt?: string | null;
  };
  member?: Pick<Member, "id" | "uniqueId" | "name" | "phoneNumber">;
}

export interface PromotePreviewMember {
  id: string;
  name: string;
  uniqueId: string;
  campus: string;
  currentBatch: string;
  nextBatch: string;
  isPromoting: boolean;
  isGraduating: boolean;
  hasOverride: boolean;
}

export interface PromotePreviewResponse {
  preview: PromotePreviewMember[];
  summary: {
    totalActive: number;
    graduatingCount: number;
    promotingCount: number;
  };
}

export interface MemberStudyParticipation {
  studyId: string;
  studyName: string;
  attended: number;
  total: number;
  required: number | null;
  isCompleted: boolean;
}
