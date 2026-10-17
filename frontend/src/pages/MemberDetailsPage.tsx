import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { toFriendlyError } from "../lib/errors";
import formatDate from "../lib/formatDate";
import type { Member } from "../types/members";

interface AttendanceRecord {
  id: string;
  eventId: string;
  eventName: string;
  markedAt: string;
  status: "Present" | "Late" | "Excused" | "Absent";
}

export interface StudyParticipationItem {
  studyId: string;
  studyName: string;
  attendedSessions: number;
  lateSessions: number;
  excusedSessions: number;
  totalSessions: number;
  attendanceRate: number | null;
  summary: string;
  isCompleted: boolean;
}

interface MemberDetails extends Member {
  qrCodeUrl?: string;
  studyParticipation?: StudyParticipationItem[];
  attendanceData?: {
    totalAttended: number;
    totalMissed: number;
    percentage: number;
    recentRecords: AttendanceRecord[];
    studyParticipation?: StudyParticipationItem[];
  };
}

type AttendanceDetailsResponse = {
  attended: Array<{
    attendanceId: string;
    markedAt: string;
    status?: "PRESENT" | "LATE" | "EXCUSED";
    excuseReason?: string | null;
    event: {
      id: string;
      title: string;
      eventDate: string;
      startTime: string;
      endTime: string;
      recurrenceIndex?: number | null;
    };
  }>;
  missed: Array<{
    id: string;
    title: string;
    eventDate: string;
    startTime: string;
    endTime: string;
    recurrenceIndex?: number | null;
  }>;
};

const NOT_SPECIFIED = "Not specified";

const formatEnumLabel = (value?: string | null) => {
  if (!value) return NOT_SPECIFIED;
  return value
    .split("_")
    .map((segment) => {
      if (/^\d+$/.test(segment)) return segment;
      return segment.charAt(0) + segment.slice(1).toLowerCase();
    })
    .join(" ");
};

const getDisplayValue = (value?: string | null) => {
  if (!value || value.trim() === "") return NOT_SPECIFIED;
  return value;
};

const buildRecentRecords = (
  attended: AttendanceDetailsResponse["attended"],
  missed: AttendanceDetailsResponse["missed"],
): AttendanceRecord[] => {
  const combined: AttendanceRecord[] = [
    ...attended.map((a) => {
      let statusStr: AttendanceRecord["status"] = "Present";
      if (a.status === "LATE") statusStr = "Late";
      else if (a.status === "EXCUSED") statusStr = "Excused";
      return {
        id: a.attendanceId,
        eventId: a.event.id,
        eventName: a.event.title,
        markedAt: a.markedAt,
        status: statusStr,
      };
    }),
    ...missed.map((e) => ({
      id: e.id,
      eventId: e.id,
      eventName: e.title,
      markedAt: e.eventDate,
      status: "Absent" as AttendanceRecord["status"],
    })),
  ];

  combined.sort(
    (x, y) => new Date(y.markedAt).getTime() - new Date(x.markedAt).getTime(),
  );

  return combined.slice(0, 10);
};

const MemberDetailsPage: React.FC = () => {
  const { memberId } = useParams<{ memberId: string }>();
  const navigate = useNavigate();
  const { admin } = useAuth();
  const isSuperAdmin = admin?.role === "SUPER_ADMIN";

  const [member, setMember] = useState<MemberDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    "activate" | "deactivate" | null
  >(null);
  const [isResending, setIsResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);

  // Batch Override Modal (SUPER_ADMIN)
  const [isOverrideModalOpen, setIsOverrideModalOpen] = useState(false);
  const [selectedOverride, setSelectedOverride] = useState<string>("NONE");
  const [isSavingOverride, setIsSavingOverride] = useState(false);
  const [overrideError, setOverrideError] = useState("");

  const [statsModalOpen, setStatsModalOpen] = useState(false);
  const [statsTab, setStatsTab] = useState<"attended" | "missed">("attended");
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [statsActionMessage, setStatsActionMessage] = useState<string | null>(
    null,
  );
  const [markingEventId, setMarkingEventId] = useState<string | null>(null);
  const [attendanceDetails, setAttendanceDetails] =
    useState<AttendanceDetailsResponse | null>(null);

  const fetchMemberDetails = React.useCallback(
    async (options?: { withGlobalLoading?: boolean }) => {
      if (!memberId) return;

      const withGlobalLoading = options?.withGlobalLoading !== false;

      try {
        if (withGlobalLoading) {
          setLoading(true);
        }
        const response = await api.get(`/members/${memberId}`);
        const memberData = response.data?.member ?? response.data;

        memberData.attendanceData = memberData.attendanceData || {
          totalAttended: 0,
          totalMissed: 0,
          percentage: 0,
          recentRecords: [],
        };

        try {
          const attRes = await api.get<AttendanceDetailsResponse>(
            `/members/${memberId}/attendance`,
          );
          const attended = attRes.data.attended || [];
          const missed = attRes.data.missed || [];

          memberData.attendanceData.recentRecords = buildRecentRecords(
            attended,
            missed,
          );
          setAttendanceDetails(attRes.data);
        } catch {
          // non-fatal
        }

        setMember(memberData);
        setSelectedOverride(memberData.batchOverride || "NONE");
        setError(null);
      } catch (err: unknown) {
        const friendly = toFriendlyError(err, {
          action: "load the member details",
          fallbackTitle: "Couldn't load member",
          fallbackMessage: "Please refresh the page and try again.",
        });
        setError(friendly.message);
      } finally {
        if (withGlobalLoading) {
          setLoading(false);
        }
      }
    },
    [memberId],
  );

  useEffect(() => {
    void fetchMemberDetails({ withGlobalLoading: true });
  }, [fetchMemberDetails]);

  const handleDeactivate = async () => {
    try {
      await api.patch(`/members/${memberId}/deactivate`);
      setMember((prev) => (prev ? { ...prev, isActive: false } : null));
      setShowConfirmModal(false);
      setPendingAction(null);
    } catch (err) {
      console.error("Failed to deactivate member", err);
      const friendly = toFriendlyError(err, {
        action: "deactivate the member",
        fallbackTitle: "Couldn't deactivate member",
        fallbackMessage: "Please try again.",
      });
      setError(friendly.message);
    }
  };

  const handleActivate = async () => {
    try {
      await api.patch(`/members/${memberId}/activate`);
      setMember((prev) => (prev ? { ...prev, isActive: true } : null));
      setShowConfirmModal(false);
      setPendingAction(null);
    } catch (err) {
      console.error("Failed to activate member", err);
      const friendly = toFriendlyError(err, {
        action: "activate the member",
        fallbackTitle: "Couldn't activate member",
        fallbackMessage: "Please try again.",
      });
      setError(friendly.message);
    }
  };

  const handleResendQR = async () => {
    setResendMessage(null);
    setResendError(null);
    if (!memberId) return;
    setIsResending(true);
    try {
      const response = await api.post(`/members/${memberId}/resend-qr`);
      const remaining = response.data?.remaining;
      setResendMessage(
        remaining === 0
          ? "QR resent. You have no more resends left this week."
          : `QR resent. You have ${remaining} resend(s) remaining this week.`,
      );
    } catch (err: any) {
      console.error("Failed to resend QR code", err);
      if (err.response?.status === 429) {
        setResendError(
          "You've reached the weekly resend limit. Please try again later or contact support.",
        );
      } else {
        const friendly = toFriendlyError(err, {
          action: "resend the QR code",
          fallbackTitle: "Couldn't resend QR code",
          fallbackMessage:
            "Please try again later. If the issue continues, contact support.",
        });
        setResendError(friendly.message);
      }
    } finally {
      setIsResending(false);
    }
  };

  const handleDownloadQR = () => {
    if (member?.uniqueId) {
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${member.uniqueId}`;
      fetch(qrUrl)
        .then((response) => response.blob())
        .then((blob) => {
          const url = window.URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = `${member.name.replace(/\s+/g, "_")}_QR.png`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          window.URL.revokeObjectURL(url);
        })
        .catch((err) => console.error("Error downloading QR:", err));
    }
  };

  const handleSaveBatchOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!memberId) return;
    try {
      setIsSavingOverride(true);
      setOverrideError("");

      const batchOverrideVal = selectedOverride === "NONE" ? null : selectedOverride;

      await api.patch(`/members/${memberId}`, {
        name: member?.name,
        email: member?.email,
        phoneNumber: member?.phoneNumber,
        department: member?.department,
        campus: member?.campus,
        gender: member?.gender,
        batch: member?.batch,
        batchOverride: batchOverrideVal,
      });

      await fetchMemberDetails({ withGlobalLoading: false });
      setIsOverrideModalOpen(false);
    } catch (err: any) {
      setOverrideError(
        err.response?.data?.error || "Failed to update batch override.",
      );
    } finally {
      setIsSavingOverride(false);
    }
  };

  const openStatsModal = async (tab: "attended" | "missed") => {
    if (!memberId) return;
    setStatsTab(tab);
    setStatsModalOpen(true);
    setStatsActionMessage(null);

    if (attendanceDetails) return;

    setStatsLoading(true);
    setStatsError(null);
    try {
      const response = await api.get<AttendanceDetailsResponse>(
        `/members/${memberId}/attendance`,
      );
      setAttendanceDetails(response.data);
    } catch (err: unknown) {
      const friendly = toFriendlyError(err, {
        action: "load the attendance details",
        fallbackTitle: "Couldn't load attendance",
        fallbackMessage: "Please try again.",
      });
      setStatsError(friendly.message);
    } finally {
      setStatsLoading(false);
    }
  };

  const closeStatsModal = () => {
    setStatsModalOpen(false);
    setStatsError(null);
    setStatsActionMessage(null);
    setMarkingEventId(null);
  };

  const handleMarkPresentFromMissed = async (
    eventId: string,
    eventTitle: string,
  ) => {
    if (!memberId) return;

    setStatsActionMessage(null);
    setStatsError(null);
    setMarkingEventId(eventId);

    try {
      await api.post("/attendance", {
        memberId,
        eventId,
        method: "MANUAL",
        allowOverride: true,
      });

      await fetchMemberDetails({ withGlobalLoading: false });
      setStatsActionMessage(`Marked present for "${eventTitle}".`);
    } catch (err: unknown) {
      const friendly = toFriendlyError(err, {
        action: "mark attendance",
        fallbackTitle: "Couldn't mark attendance",
        fallbackMessage: "Please try again.",
      });
      setStatsError(friendly.message);
    } finally {
      setMarkingEventId(null);
    }
  };

  if (loading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 flex justify-center mt-20">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !member) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 mt-10 text-center text-red-500 bg-red-50 rounded-lg max-w-lg mx-auto border border-red-200">
        {error || "Member not found."}
      </div>
    );
  }

  const emailDisplay = getDisplayValue(member.email);
  const phoneDisplay = getDisplayValue(member.phoneNumber);
  const departmentDisplay = formatEnumLabel(member.department);
  const batchDisplay = formatEnumLabel(member.effectiveBatch || member.batch);
  const campusDisplay = formatEnumLabel(member.campus);
  const genderDisplay = formatEnumLabel(member.gender);

  const studyParticipationList =
    member.studyParticipation ||
    member.attendanceData?.studyParticipation ||
    [];

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Attendance Modal (Attended / Missed) */}
      {statsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8">
          <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl border border-gray-200 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  Attendance Details
                </h3>
                <p className="text-sm text-gray-500">{member.name}</p>
              </div>
              <button
                type="button"
                onClick={closeStatsModal}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100"
              >
                Close
              </button>
            </div>

            <div className="px-5 pt-4">
              <div className="inline-flex rounded-lg border bg-gray-50 p-1">
                <button
                  type="button"
                  onClick={() => setStatsTab("attended")}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition ${
                    statsTab === "attended"
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  Attended
                </button>
                <button
                  type="button"
                  onClick={() => setStatsTab("missed")}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition ${
                    statsTab === "missed"
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  Missed
                </button>
              </div>
            </div>

            <div className="px-5 py-4 max-h-[70vh] overflow-auto">
              {statsLoading && (
                <div className="text-sm text-gray-600">Loading…</div>
              )}
              {statsError && (
                <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {statsError}
                </div>
              )}
              {statsActionMessage && (
                <div className="mb-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                  {statsActionMessage}
                </div>
              )}

              {!statsLoading && !statsError && (
                <>
                  {statsTab === "attended" && (
                    <div className="space-y-2">
                      {(attendanceDetails?.attended ?? []).length === 0 ? (
                        <div className="text-sm text-gray-500">
                          No attended events yet.
                        </div>
                      ) : (
                        attendanceDetails!.attended.map((row) => (
                          <button
                            key={row.attendanceId}
                            type="button"
                            onClick={() =>
                              navigate(`/events/${row.event.id}`, {
                                replace: false,
                              })
                            }
                            className="w-full text-left rounded-lg border border-gray-200 p-3 hover:bg-gray-50 transition"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="font-medium text-gray-900">
                                  {row.event.title}
                                </div>
                                <div className="text-sm text-gray-500">
                                  {formatDate(row.event.eventDate)}
                                </div>
                              </div>
                              <div
                                className={`text-xs rounded-full px-2.5 py-1 font-bold border ${
                                  row.status === "LATE"
                                    ? "bg-amber-50 text-amber-800 border-amber-200"
                                    : row.status === "EXCUSED"
                                      ? "bg-blue-50 text-blue-700 border-blue-200"
                                      : "bg-green-50 text-green-700 border-green-200"
                                }`}
                              >
                                {row.status === "LATE"
                                  ? "Late"
                                  : row.status === "EXCUSED"
                                    ? "Excused"
                                    : "Present"}
                              </div>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  )}

                  {statsTab === "missed" && (
                    <div className="space-y-2">
                      {(attendanceDetails?.missed ?? []).length === 0 ? (
                        <div className="text-sm text-gray-500">
                          No missed events found.
                        </div>
                      ) : (
                        attendanceDetails!.missed.map((eventItem) => (
                          <div
                            key={eventItem.id}
                            className={`w-full rounded-lg border p-3 transition ${
                              markingEventId === eventItem.id
                                ? "border-blue-200 bg-blue-50/60"
                                : "border-gray-200"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <button
                                type="button"
                                onClick={() =>
                                  navigate(`/events/${eventItem.id}`, {
                                    replace: false,
                                  })
                                }
                                className="text-left hover:opacity-90 transition"
                              >
                                <div className="font-medium text-gray-900">
                                  {eventItem.title}
                                </div>
                                <div className="text-sm text-gray-500">
                                  {formatDate(eventItem.eventDate)}
                                </div>
                              </button>
                              <div className="flex items-center gap-2">
                                <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-1 font-bold">
                                  Absent
                                </div>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleMarkPresentFromMissed(
                                      eventItem.id,
                                      eventItem.title,
                                    )
                                  }
                                  disabled={markingEventId !== null}
                                  className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-wait disabled:opacity-70"
                                >
                                  {markingEventId === eventItem.id ? (
                                    <>
                                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-blue-300 border-t-blue-700" />
                                      Marking
                                    </>
                                  ) : (
                                    "Mark present"
                                  )}
                                </button>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Top Header */}
      <div className="flex items-center space-x-4 mb-6">
        <button
          onClick={() => navigate("/members")}
          className="text-gray-500 hover:text-gray-700 p-2 rounded-full hover:bg-gray-100 transition-colors"
        >
          <svg
            className="w-6 h-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M10 19l-7-7m0 0l7-7m-7 7h18"
            />
          </svg>
        </button>
        <h1 className="text-2xl font-bold text-gray-900">Member Details</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Info Column */}
        <div className="md:col-span-2 space-y-6">
          {/* Member Information Card */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 relative">
            <div className="absolute top-6 right-6">
              <span
                className={`px-3 py-1 rounded-full text-sm font-medium ${
                  member.isActive
                    ? "bg-green-100 text-green-800"
                    : "bg-red-100 text-red-800"
                }`}
              >
                {member.isActive ? "Active" : "Inactive"}
              </span>
            </div>
            <h2 className="text-xl font-semibold text-gray-800 mb-4 pb-2 border-b border-gray-100">
              Member Information
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-500 mb-1">Name</p>
                <p className="font-medium text-gray-900">{member.name}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 mb-1">Member ID</p>
                <p className="font-medium text-gray-900">{member.uniqueId}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 mb-1">Phone</p>
                <p className="font-medium text-gray-900">{phoneDisplay}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 mb-1">Email</p>
                {member.email ? (
                  <a
                    href={`mailto:${member.email}`}
                    className="font-medium text-blue-600 hover:text-blue-700 hover:underline break-all"
                  >
                    {emailDisplay}
                  </a>
                ) : (
                  <p className="font-medium text-gray-900">{emailDisplay}</p>
                )}
              </div>
              <div>
                <p className="text-sm text-gray-500 mb-1">Gender</p>
                <p className="font-medium text-gray-900">{genderDisplay}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 mb-1">Department</p>
                <p className="font-medium text-gray-900">{departmentDisplay}</p>
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-500 mb-1">Effective Batch</p>
                  {isSuperAdmin && (
                    <button
                      type="button"
                      onClick={() => setIsOverrideModalOpen(true)}
                      className="text-xs text-blue-600 hover:underline font-semibold"
                    >
                      Override
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <p className="font-bold text-gray-900">{batchDisplay}</p>
                  {member.batchOverride && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                      Override active
                    </span>
                  )}
                </div>
              </div>
              <div>
                <p className="text-sm text-gray-500 mb-1">Campus</p>
                <p className="font-medium text-gray-900">{campusDisplay}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 mb-1">Entry Academic Year</p>
                <p className="font-medium text-gray-900">
                  {member.entryAcademicYear
                    ? `${member.entryAcademicYear}/${member.entryAcademicYear + 1}`
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500 mb-1">Date Registered</p>
                <p className="font-medium text-gray-900">
                  {formatDate(member.createdAt)}
                </p>
              </div>
            </div>
          </div>

          {/* Attendance Stats Cards */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-4 pb-2 border-b border-gray-100">
              Overall Attendance
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <button
                type="button"
                onClick={() => openStatsModal("attended")}
                className="rounded-lg p-4 text-center transition"
              >
                <div className="bg-blue-50 rounded-lg p-4 border border-blue-100">
                  <div className="text-3xl font-bold text-blue-600">
                    {member.attendanceData?.totalAttended ?? 0}
                  </div>
                  <div className="text-sm text-blue-800 mt-1 font-medium">
                    Attended Sessions
                  </div>
                </div>
                <div className="text-xs text-gray-500 mt-1">Tap to view</div>
              </button>

              <button
                type="button"
                onClick={() => openStatsModal("missed")}
                className="rounded-lg p-4 text-center transition"
              >
                <div className="bg-red-50 rounded-lg p-4 border border-red-100">
                  <div className="text-3xl font-bold text-red-600">
                    {member.attendanceData?.totalMissed ?? 0}
                  </div>
                  <div className="text-sm text-red-800 mt-1 font-medium">
                    Missed Sessions
                  </div>
                </div>
                <div className="text-xs text-gray-500 mt-1">Tap to view</div>
              </button>

              <div className="rounded-lg p-4">
                <div className="bg-green-50 rounded-lg p-4 border border-green-100 text-center">
                  <div className="text-3xl font-bold text-green-600">
                    {member.attendanceData?.percentage ?? 0}%
                  </div>
                  <div className="text-sm text-green-800 mt-1 font-medium">
                    Overall Turnout Rate
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Study Participation Section */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-4 pb-2 border-b border-gray-100 flex items-center justify-between">
              <span>Participation per Study</span>
              <span className="text-xs font-normal text-gray-500">
                Department Studies Breakdown
              </span>
            </h2>

            {studyParticipationList.length === 0 ? (
              <p className="text-gray-500 text-center py-6 bg-gray-50 rounded-xl border border-dashed border-gray-200 text-sm italic">
                No active studies recorded yet.
              </p>
            ) : (
              <div className="space-y-3">
                {studyParticipationList.map((studyItem) => (
                  <div
                    key={studyItem.studyId}
                    className="rounded-xl border border-gray-100 bg-gray-50/70 p-4 transition hover:bg-gray-50"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-base font-bold text-gray-900">
                          {studyItem.studyName}
                        </span>
                        {studyItem.isCompleted && (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                            ✓ Completed
                          </span>
                        )}
                      </div>
                      <span className="text-sm font-bold text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-full border border-blue-200">
                        {studyItem.attendedSessions} / {studyItem.totalSessions} sessions
                      </span>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden mb-2">
                      <div
                        className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                        style={{
                          width: `${
                            studyItem.totalSessions > 0
                              ? Math.min(
                                  100,
                                  Math.round(
                                    (studyItem.attendedSessions /
                                      studyItem.totalSessions) *
                                      100,
                                  ),
                                )
                              : 0
                          }%`,
                        }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <div className="flex gap-3">
                        <span>Attended: {studyItem.attendedSessions}</span>
                        {studyItem.lateSessions > 0 && (
                          <span className="text-amber-700">Late: {studyItem.lateSessions}</span>
                        )}
                        {studyItem.excusedSessions > 0 && (
                          <span className="text-blue-600">Excused: {studyItem.excusedSessions}</span>
                        )}
                      </div>
                      <span className="font-semibold text-gray-700">
                        Turnout: {studyItem.attendanceRate !== null ? `${studyItem.attendanceRate}%` : "—"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Attendance */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-4 pb-2 border-b border-gray-100">
              Recent Sessions
            </h2>
            {member.attendanceData?.recentRecords &&
            member.attendanceData.recentRecords.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-gray-200 text-sm text-gray-500">
                      <th className="pb-3 font-medium">Event Name</th>
                      <th className="pb-3 font-medium">Date</th>
                      <th className="pb-3 font-medium text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {member.attendanceData.recentRecords.map((record) => (
                      <tr
                        key={record.id}
                        className="border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors"
                      >
                        <td className="py-3 text-gray-800 font-medium">
                          {record.eventName}
                        </td>
                        <td className="py-3 text-gray-500 text-sm">
                          {formatDate(record.markedAt)}
                        </td>
                        <td className="py-3 text-right">
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                              record.status === "Present"
                                ? "bg-green-100 text-green-700 border-green-200"
                                : record.status === "Late"
                                  ? "bg-amber-100 text-amber-800 border-amber-200"
                                  : record.status === "Excused"
                                    ? "bg-blue-100 text-blue-700 border-blue-200"
                                    : "bg-red-100 text-red-700 border-red-200"
                            }`}
                          >
                            {record.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-gray-500 text-center py-4 bg-gray-50 rounded-lg italic border border-dashed border-gray-200">
                No recent attendance records found.
              </p>
            )}
          </div>
        </div>

        {/* Action Column */}
        <div className="space-y-6">
          {/* QR Section */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col items-center">
            <h2 className="text-lg font-semibold text-gray-800 mb-4 self-start">
              QR Code
            </h2>
            <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 mb-6">
              {member.uniqueId ? (
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${member.uniqueId}`}
                  alt={`${member.name}'s QR Code`}
                  className="w-48 h-48 object-contain"
                />
              ) : (
                <div className="w-48 h-48 flex items-center justify-center text-gray-400 border-2 border-dashed border-gray-300 rounded-lg bg-white">
                  No QR Available
                </div>
              )}
            </div>

            <div className="w-full grid grid-cols-1 gap-3">
              <button
                onClick={handleResendQR}
                disabled={isResending}
                className={`w-full py-2.5 rounded-lg font-medium transition-colors flex items-center justify-center border border-blue-200 ${
                  isResending
                    ? "bg-blue-100 text-blue-700 cursor-wait"
                    : "bg-blue-50 text-blue-700 hover:bg-blue-100"
                }`}
              >
                <svg
                  className="w-4 h-4 mr-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  />
                </svg>
                {isResending ? "Sending Email..." : "Resend QR Email"}
              </button>
              <button
                onClick={handleDownloadQR}
                disabled={!member.uniqueId}
                className="w-full py-2.5 bg-gray-50 text-gray-700 hover:bg-gray-100 rounded-lg font-medium transition-colors flex items-center justify-center border border-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg
                  className="w-4 h-4 mr-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
                Download QR
              </button>

              {resendMessage && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
                  {resendMessage}
                </div>
              )}
              {resendError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  {resendError}
                </div>
              )}
            </div>
          </div>

          {/* Super Admin Quick Actions */}
          {isSuperAdmin && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-3">
              <h2 className="text-base font-semibold text-gray-800">
                Administration
              </h2>

              <button
                type="button"
                onClick={() => setIsOverrideModalOpen(true)}
                className="w-full py-2 px-3 text-xs font-semibold rounded-lg border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 transition"
              >
                ✏️ Set Batch Override
              </button>

              {member.isActive ? (
                <button
                  type="button"
                  onClick={() => {
                    setPendingAction("deactivate");
                    setShowConfirmModal(true);
                  }}
                  className="w-full py-2 px-3 text-xs font-semibold rounded-lg border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 transition"
                >
                  Deactivate Member
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setPendingAction("activate");
                    setShowConfirmModal(true);
                  }}
                  className="w-full py-2 px-3 text-xs font-semibold rounded-lg border border-green-200 bg-green-50 text-green-700 hover:bg-green-100 transition"
                >
                  Reactivate Member
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Batch Override Modal */}
      {isOverrideModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 px-4 py-6">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-gray-900">Set Batch Override</h3>
            <p className="mt-1 text-xs text-gray-500">
              Overrides the dynamically computed academic batch for repeaters or students taking a leave of absence.
            </p>

            <form onSubmit={handleSaveBatchOverride} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Batch Override Value
                </label>
                <select
                  value={selectedOverride}
                  onChange={(e) => setSelectedOverride(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                >
                  <option value="NONE">Automatic (No override)</option>
                  <option value="FRESHMAN">Freshman</option>
                  <option value="YEAR_2">Year 2</option>
                  <option value="YEAR_3">Year 3</option>
                  <option value="YEAR_4">Year 4</option>
                  <option value="YEAR_5">Year 5 (5-yr campus)</option>
                  <option value="GRADUATE">Graduate</option>
                </select>
              </div>

              {overrideError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
                  {overrideError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsOverrideModalOpen(false)}
                  className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingOverride}
                  className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {isSavingOverride ? "Saving..." : "Save Override"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-gray-900">
              {pendingAction === "deactivate"
                ? "Deactivate Member?"
                : "Reactivate Member?"}
            </h3>
            <p className="mt-2 text-sm text-gray-500">
              {pendingAction === "deactivate"
                ? "Deactivated members cannot check into events and are excluded from attendance rate statistics."
                : "Reactivating will restore the member's eligibility for attendance."}
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={
                  pendingAction === "deactivate" ? handleDeactivate : handleActivate
                }
                className={`rounded-xl px-4 py-2 text-sm font-semibold text-white ${
                  pendingAction === "deactivate"
                    ? "bg-red-600 hover:bg-red-700"
                    : "bg-green-600 hover:bg-green-700"
                }`}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MemberDetailsPage;
