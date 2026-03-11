import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "../lib/api";
import formatDate from "../lib/formatDate";
import type { Member } from "../types/members";

interface AttendanceRecord {
  id: string;
  eventId: string;
  eventName: string;
  markedAt: string;
  status: "Present" | "Absent";
}

interface MemberDetails extends Member {
  qrCodeUrl?: string;
  attendanceData?: {
    totalAttended: number;
    totalMissed: number;
    percentage: number;
    recentRecords: AttendanceRecord[];
  };
}

const NOT_SPECIFIED = "Not specified";

const formatEnumLabel = (value?: string | null) => {
  if (!value) {
    return NOT_SPECIFIED;
  }

  return value
    .split("_")
    .map((segment) => {
      if (/^\d+$/.test(segment)) {
        return segment;
      }

      return segment.charAt(0) + segment.slice(1).toLowerCase();
    })
    .join(" ");
};

const getDisplayValue = (value?: string | null) => {
  if (!value || value.trim() === "") {
    return NOT_SPECIFIED;
  }

  return value;
};

const MemberDetailsPage: React.FC = () => {
  const { memberId } = useParams<{ memberId: string }>();
  const navigate = useNavigate();
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

  // Note: hard-coded user role for now until auth context provides it
  const isSuperAdmin = true;

  useEffect(() => {
    const fetchMemberDetails = async () => {
      try {
        setLoading(true);
        const response = await api.get(`/members/${memberId}`);
        // backend returns { member }
        const memberData = response.data?.member ?? response.data;
        memberData.attendanceData = memberData.attendanceData || {
          totalAttended: 0,
          totalMissed: 0,
          percentage: 0,
          recentRecords: [],
        };
        setMember(memberData);
        setError(null);
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(
            (err as { response?: { data?: { message?: string } } }).response
              ?.data?.message || "Failed to load member details.",
          );
        } else {
          setError("Failed to load member details.");
        }
      } finally {
        setLoading(false);
      }
    };

    if (memberId) {
      fetchMemberDetails();
    }
  }, [memberId]);

  const handleDeactivate = async () => {
    try {
      await api.patch(`/members/${memberId}/deactivate`);
      setMember((prev) => (prev ? { ...prev, isActive: false } : null));
      setShowConfirmModal(false);
      setPendingAction(null);
    } catch {
      console.error("Failed to deactivate member");
    }
  };

  const handleActivate = async () => {
    try {
      await api.patch(`/members/${memberId}/activate`);
      setMember((prev) => (prev ? { ...prev, isActive: true } : null));
      setShowConfirmModal(false);
      setPendingAction(null);
    } catch {
      console.error("Failed to activate member");
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
        setResendError(
          "We couldn't send the email right now. Please try again later or contact support.",
        );
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

  if (loading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 flex justify-center mt-20">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
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
  const batchDisplay = formatEnumLabel(member.batch);
  const campusDisplay = formatEnumLabel(member.campus);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
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
          {/* Member Information */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 relative">
            <div className="absolute top-6 right-6">
              <span
                className={`px-3 py-1 rounded-full text-sm font-medium ${member.isActive ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}
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
                <p className="text-sm text-gray-500 mb-1">Department</p>
                <p className="font-medium text-gray-900">{departmentDisplay}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 mb-1">Batch</p>
                <p className="font-medium text-gray-900">{batchDisplay}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 mb-1">Campus</p>
                <p className="font-medium text-gray-900">{campusDisplay}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 mb-1">Date Registered</p>
                <p className="font-medium text-gray-900">
                  {formatDate(member.createdAt)}
                </p>
              </div>
            </div>
          </div>

          {/* Attendance Stats */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-4 pb-2 border-b border-gray-100">
              Attendance Statistics
            </h2>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="bg-blue-50 rounded-lg p-4 border border-blue-100">
                <p className="text-3xl font-bold text-blue-600">
                  {member.attendanceData?.totalAttended}
                </p>
                <p className="text-sm text-blue-800 mt-1 font-medium">
                  Attended
                </p>
              </div>
              <div className="bg-orange-50 rounded-lg p-4 border border-orange-100">
                <p className="text-3xl font-bold text-orange-600">
                  {member.attendanceData?.totalMissed}
                </p>
                <p className="text-sm text-orange-800 mt-1 font-medium">
                  Missed
                </p>
              </div>
              <div className="bg-green-50 rounded-lg p-4 border border-green-100">
                <p className="text-3xl font-bold text-green-600">
                  {member.attendanceData?.percentage}%
                </p>
                <p className="text-sm text-green-800 mt-1 font-medium">Rate</p>
              </div>
            </div>
          </div>

          {/* Recent Attendance */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-4 pb-2 border-b border-gray-100">
              Recent Attendance
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
                            className={`px-2 py-1 rounded-full text-xs font-medium ${record.status === "Present" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}
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
                  ></path>
                </svg>
                Resend QR Email
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
                  ></path>
                </svg>
                Download QR
              </button>
              {/* Resend status messages (friendly) */}
              <div className="mt-3">
                {resendMessage && (
                  <div className="text-sm text-green-700 bg-green-50 border border-green-100 rounded-md px-3 py-2">
                    {resendMessage}
                  </div>
                )}
                {resendError && (
                  <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2">
                    {resendError}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Admin Actions */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">
              Actions
            </h2>
            <div className="w-full grid grid-cols-1 gap-3">
              <button className="w-full py-2.5 bg-gray-800 text-white hover:bg-gray-900 rounded-lg font-medium transition-colors">
                Edit Member
              </button>
              {isSuperAdmin && member.isActive && (
                <button
                  onClick={() => {
                    setPendingAction("deactivate");
                    setShowConfirmModal(true);
                  }}
                  className="w-full py-2.5 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 rounded-lg font-medium transition-colors border border-red-200"
                >
                  Deactivate Member
                </button>
              )}
              {isSuperAdmin && !member.isActive && (
                <button
                  onClick={() => {
                    setPendingAction("activate");
                    setShowConfirmModal(true);
                  }}
                  className="w-full py-2.5 bg-green-50 text-green-700 hover:bg-green-100 hover:text-green-800 rounded-lg font-medium transition-colors border border-green-200"
                >
                  Activate Member
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl transform transition-all">
            <div className="flex items-center justify-center w-12 h-12 mx-auto bg-red-100 rounded-full mb-4">
              <svg
                className="h-6 w-6 text-red-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 text-center mb-2">
              {pendingAction === "activate"
                ? "Activate Member"
                : "Deactivate Member"}
            </h3>
            <p className="text-sm text-gray-500 text-center mb-6">
              {pendingAction === "activate" ? (
                <>
                  Are you sure you want to activate{" "}
                  <strong>{member.name}</strong>? They will be able to access
                  their account and check in to events.
                </>
              ) : (
                <>
                  Are you sure you want to deactivate{" "}
                  <strong>{member.name}</strong>? They will no longer be able to
                  check in to events or access their account.
                </>
              )}
            </p>
            <div className="flex space-x-3">
              <button
                onClick={() => {
                  setShowConfirmModal(false);
                  setPendingAction(null);
                }}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 bg-white hover:bg-gray-50 font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (pendingAction === "activate") {
                    handleActivate();
                  } else {
                    handleDeactivate();
                  }
                }}
                className={`flex-1 px-4 py-2 border border-transparent rounded-lg text-white font-medium transition-colors shadow-sm ${
                  pendingAction === "activate"
                    ? "bg-green-600 hover:bg-green-700"
                    : "bg-red-600 hover:bg-red-700"
                }`}
              >
                {pendingAction === "activate"
                  ? "Yes, Activate"
                  : "Yes, Deactivate"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MemberDetailsPage;
