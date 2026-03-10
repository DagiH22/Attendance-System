import React, { useEffect, useMemo, useRef, useState } from "react";
import { QrReader } from "react-qr-reader";
import { isAxiosError } from "axios";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import api from "../lib/api";
import formatDate from "../lib/formatDate";
import type { DashboardEvent } from "../types/events";
import type { AttendanceRecordResponse, Member } from "../types/members";

type QrReaderScanResult = {
  getText: () => string;
};

type QrReaderScanError = {
  name?: string;
};

type PageTab = "QR" | "MANUAL";

type AttendanceFeedbackTone = "success" | "error" | "info";

type AttendanceFeedback = {
  tone: AttendanceFeedbackTone;
  title: string;
  description?: string;
};

type LocationState = {
  event?: DashboardEvent;
};

const mapEventToDashboardEvent = (rawEvent: any): DashboardEvent => {
  const now = new Date();
  const eventStart = rawEvent.startTime
    ? new Date(rawEvent.startTime)
    : new Date(rawEvent.eventDate ?? now);
  const eventEnd = rawEvent.endTime
    ? new Date(rawEvent.endTime)
    : new Date(eventStart.getTime() + 2 * 60 * 60 * 1000);

  let status: DashboardEvent["status"] =
    (rawEvent.status as DashboardEvent["status"]) ?? "UPCOMING";
  let attendanceOpen = Boolean(rawEvent.attendanceOpen);

  if (!rawEvent.status) {
    if (rawEvent.isActive === false) {
      status = "DEACTIVATED";
    } else if (now >= eventStart && now <= eventEnd) {
      status = "ACTIVE";
    } else if (now > eventEnd) {
      status = "PAST";
    } else {
      status = "UPCOMING";
    }

    attendanceOpen = status === "ACTIVE";
  }

  return {
    id: rawEvent.id,
    title: rawEvent.title,
    description: rawEvent.description || "",
    startTime: rawEvent.startTime ?? eventStart.toISOString(),
    endTime: rawEvent.endTime ?? eventEnd.toISOString(),
    status,
    attendanceOpen,
    location: rawEvent.location || "",
    eventType: rawEvent.type,
    createdAt: rawEvent.createdAt || eventStart.toISOString(),
    createdBy: {
      id: rawEvent.admin?.id || rawEvent.createdBy?.id || "unknown-admin",
      name: rawEvent.admin?.name || rawEvent.createdBy?.name || "Admin User",
    },
    attendanceCount:
      rawEvent._count?.attendances || rawEvent.attendanceCount || 0,
    totalMembers: rawEvent.totalMembers || 0,
  };
};

const ATTENDANCE_MESSAGES: Record<
  string,
  { title: string; tone: AttendanceFeedbackTone }
> = {
  ALREADY_PRESENT: { title: "Already checked in", tone: "info" },
  MEMBER_NOT_FOUND: { title: "Member not found", tone: "error" },
  EVENT_CLOSED: { title: "Event closed", tone: "error" },
  SUCCESS: { title: "Attendance recorded", tone: "success" },
};

const TakeAttendancePage: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const state = location.state as LocationState | null;

  const [event, setEvent] = useState<DashboardEvent | null>(
    state?.event ?? null,
  );
  const [members, setMembers] = useState<Member[]>([]);
  const [loadingEvent, setLoadingEvent] = useState<boolean>(!state?.event);
  const [loadingMembers, setLoadingMembers] = useState<boolean>(true);
  const [pageError, setPageError] = useState<string>("");
  const [activeTab, setActiveTab] = useState<PageTab>("QR");
  const [cameraPermission, setCameraPermission] = useState<
    "idle" | "pending" | "granted" | "denied"
  >("idle");
  const [cameraError, setCameraError] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [feedback, setFeedback] = useState<AttendanceFeedback | null>(null);
  const [lastScannedMember, setLastScannedMember] = useState<Member | null>(
    null,
  );
  const [presentMembers, setPresentMembers] = useState<Set<string>>(
    () => new Set(),
  );

  const lastScannedValueRef = useRef<string>("");
  const scanCooldownRef = useRef<number | null>(null);

  const attendanceDisabled =
    !event?.attendanceOpen || event?.status !== "ACTIVE";

  // show date as dd/mm/yyyy (formatDate is imported)

  const formatTimeRange = (start: string, end: string) =>
    `${new Date(start).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })} - ${new Date(end).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })}`;

  const refreshEvent = React.useCallback(async () => {
    if (!id) return;

    const response = await api.get(`/events/${id}`);
    const rawEvent = response.data?.event ?? response.data;
    if (!rawEvent) {
      throw new Error("Event not found");
    }

    setEvent(mapEventToDashboardEvent(rawEvent));
  }, [id]);

  const refreshMembers = React.useCallback(async () => {
    const response = await api.get("/members");
    setMembers(response.data?.members ?? []);
  }, []);

  const refreshPresentMembers = React.useCallback(async () => {
    if (!id) return;

    const response = await api.get(`/events/${id}/present-members`);
    setPresentMembers(new Set(response.data?.presentMemberIds ?? []));
  }, [id]);

  useEffect(() => {
    const load = async () => {
      try {
        setPageError("");
        setLoadingEvent(true);
        setLoadingMembers(true);

        await Promise.all([
          refreshEvent(),
          refreshMembers(),
          refreshPresentMembers(),
        ]);
      } catch (error: any) {
        console.error("Error loading attendance page:", error);
        setPageError(
          error?.response?.data?.error ||
            error?.message ||
            "Unable to load attendance data.",
        );
      } finally {
        setLoadingEvent(false);
        setLoadingMembers(false);
      }
    };

    void load();
  }, [refreshEvent, refreshMembers, refreshPresentMembers]);

  useEffect(() => {
    return () => {
      if (scanCooldownRef.current) {
        window.clearTimeout(scanCooldownRef.current);
      }
    };
  }, []);

  const filteredMembers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return members;

    return members.filter((member) =>
      [member.name, member.uniqueId, member.phone ?? ""].some((value) =>
        value.toLowerCase().includes(query),
      ),
    );
  }, [members, searchQuery]);

  const getFeedbackFromError = (error: unknown): AttendanceFeedback => {
    if (isAxiosError(error)) {
      const message =
        error.response?.data?.error || error.response?.data?.message || "";

      if (error.response?.status === 409) {
        return {
          ...ATTENDANCE_MESSAGES.ALREADY_PRESENT,
          description: message || "This member has already been checked in.",
        };
      }

      if (error.response?.status === 404) {
        return {
          ...ATTENDANCE_MESSAGES.MEMBER_NOT_FOUND,
          description: message || "We couldn't match that member.",
        };
      }

      if (error.response?.status === 400 && /event|attendance/i.test(message)) {
        return {
          ...ATTENDANCE_MESSAGES.EVENT_CLOSED,
          description: message || "Attendance is not open for this event.",
        };
      }

      return {
        tone: "error",
        title: "Unable to mark attendance",
        description: message || "Please try again.",
      };
    }

    return {
      tone: "error",
      title: "Unable to mark attendance",
      description: "Please try again.",
    };
  };

  const markAttendance = async (
    memberIdentifier: string,
    method: "QR" | "MANUAL",
    memberForUi?: Member | null,
  ) => {
    if (!id || !event) return;
    if (attendanceDisabled) {
      setFeedback({
        ...ATTENDANCE_MESSAGES.EVENT_CLOSED,
        description: "Attendance is only available while the event is ACTIVE.",
      });
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);

    try {
      const response = await api.post<AttendanceRecordResponse>("/attendance", {
        memberId: memberIdentifier,
        eventId: id,
        method,
      });

      const responseMember = response.data?.member;
      const matchedMember =
        members.find(
          (member) =>
            member.id === responseMember?.id ||
            member.uniqueId === responseMember?.uniqueId ||
            member.id === memberIdentifier ||
            member.uniqueId === memberIdentifier,
        ) ??
        memberForUi ??
        null;

      if (matchedMember) {
        setLastScannedMember(matchedMember);
        setPresentMembers((previous) => {
          const updated = new Set(previous);
          updated.add(matchedMember.id);
          return updated;
        });
      }

      setFeedback({
        ...ATTENDANCE_MESSAGES.SUCCESS,
        description: matchedMember
          ? `${matchedMember.name} has been marked present.`
          : response.data?.message,
      });

      await refreshEvent();
    } catch (error) {
      setFeedback(getFeedbackFromError(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const requestCameraPermission = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraPermission("denied");
      setCameraError("Camera access is not supported on this device/browser.");
      return;
    }

    try {
      setCameraPermission("pending");
      setCameraError("");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
      });
      stream.getTracks().forEach((track) => track.stop());
      setCameraPermission("granted");
    } catch (error) {
      console.error("Camera permission denied:", error);
      setCameraPermission("denied");
      setCameraError(
        "Camera permission was denied. Please enable it to scan QR codes.",
      );
    }
  };

  const handleScanResult = async (value: string | null) => {
    if (!value || isSubmitting || attendanceDisabled) {
      return;
    }

    const trimmedValue = value.trim();
    if (!trimmedValue || trimmedValue === lastScannedValueRef.current) {
      return;
    }

    lastScannedValueRef.current = trimmedValue;
    if (scanCooldownRef.current) {
      window.clearTimeout(scanCooldownRef.current);
    }

    let memberIdentifier = trimmedValue;
    try {
      const parsed = JSON.parse(trimmedValue);
      memberIdentifier =
        parsed?.memberId ??
        parsed?.memberUniqueId ??
        parsed?.uniqueId ??
        trimmedValue;
    } catch {
      const memberIdMatch = trimmedValue.match(/memberId[:=]([\w-]+)/i);
      const uniqueIdMatch = trimmedValue.match(
        /(?:memberUniqueId|uniqueId)[:=]([\w-]+)/i,
      );
      memberIdentifier =
        memberIdMatch?.[1] || uniqueIdMatch?.[1] || trimmedValue;
    }

    const localMember =
      members.find(
        (member) =>
          member.id === memberIdentifier ||
          member.uniqueId === memberIdentifier,
      ) ?? null;

    await markAttendance(memberIdentifier, "QR", localMember);

    scanCooldownRef.current = window.setTimeout(() => {
      lastScannedValueRef.current = "";
    }, 2500);
  };

  const statusBadgeClass = attendanceDisabled
    ? "bg-amber-50 text-amber-800 border-amber-200"
    : "bg-green-50 text-green-700 border-green-200";

  if (loadingEvent || loadingMembers) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-6">
        <div className="mx-auto flex min-h-[60vh] max-w-md items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
            <p className="text-sm font-medium text-slate-500">
              Loading attendance tools...
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (pageError || !event) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-6">
        <div className="mx-auto max-w-md">
          <button
            type="button"
            onClick={() => navigate(id ? `/events/${id}` : "/events")}
            className="mb-4 inline-flex items-center text-sm font-medium text-slate-600"
          >
            <span className="mr-2">←</span>
            Back
          </button>
          <div className="rounded-3xl border border-red-200 bg-white p-5 shadow-sm">
            <h1 className="text-lg font-semibold text-slate-900">
              Unable to load attendance page
            </h1>
            <p className="mt-2 text-sm text-red-600">
              {pageError || "Event data could not be loaded."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-8">
      <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-4 sm:max-w-2xl sm:px-6 sm:py-6">
        <div className="sticky top-0 z-10 -mx-4 border-b border-slate-100 bg-slate-50/95 px-4 pb-4 pt-1 backdrop-blur sm:static sm:mx-0 sm:border-none sm:bg-transparent sm:px-0 sm:pb-0">
          <button
            type="button"
            onClick={() =>
              navigate(`/events/${event.id}`, { state: { event } })
            }
            className="inline-flex items-center text-sm font-medium text-slate-600"
          >
            <span className="mr-2">←</span>
            Back to event
          </button>

          <header className="mt-4 rounded-3xl bg-gradient-to-br from-blue-600 to-indigo-700 p-5 text-white shadow-lg shadow-blue-100">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-100">
                  Take Attendance
                </p>
                <h1 className="mt-2 text-2xl font-bold leading-tight">
                  {event.title}
                </h1>
              </div>
              <span
                className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusBadgeClass}`}
              >
                {event.status}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 text-sm text-blue-50 sm:grid-cols-2">
              <div className="rounded-2xl bg-white/10 px-3 py-2">
                <p className="text-xs uppercase tracking-wide text-blue-100">
                  Date
                </p>
                <p className="mt-1 font-semibold text-white">
                  {formatDate(event.startTime)}
                </p>
              </div>
              <div className="rounded-2xl bg-white/10 px-3 py-2">
                <p className="text-xs uppercase tracking-wide text-blue-100">
                  Time
                </p>
                <p className="mt-1 font-semibold text-white">
                  {formatTimeRange(event.startTime, event.endTime)}
                </p>
              </div>
            </div>

            {event.location && (
              <p className="mt-3 text-sm text-blue-50">📍 {event.location}</p>
            )}
          </header>
        </div>

        {feedback && <FeedbackBanner feedback={feedback} />}

        {lastScannedMember && feedback?.tone === "success" && (
          <section className="rounded-3xl border border-green-100 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-green-600">
              Last checked in
            </p>
            <div className="mt-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-base font-semibold text-slate-900">
                  {lastScannedMember.name}
                </p>
                <p className="text-sm text-slate-500">
                  {lastScannedMember.uniqueId}
                  {lastScannedMember.phone
                    ? ` • ${lastScannedMember.phone}`
                    : ""}
                </p>
              </div>
              <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700">
                Present
              </span>
            </div>
          </section>
        )}

        {attendanceDisabled && (
          <section className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 shadow-sm">
            Attendance is disabled because this event is currently{" "}
            <strong>{event.status}</strong>. Attendance can only be marked while
            the event is ACTIVE.
          </section>
        )}

        <section className="rounded-3xl border border-slate-100 bg-white p-2 shadow-sm">
          <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1">
            {(["QR", "MANUAL"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`rounded-2xl px-4 py-3 text-sm font-semibold transition-colors ${
                  activeTab === tab
                    ? "bg-white text-blue-700 shadow-sm"
                    : "text-slate-500"
                }`}
              >
                {tab === "QR" ? "QR Scan" : "Manual"}
              </button>
            ))}
          </div>
        </section>

        {activeTab === "QR" ? (
          <section className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  Scan member QR
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Point the camera at a member QR code to check them in
                  instantly.
                </p>
              </div>
            </div>

            {cameraPermission !== "granted" ? (
              <div className="mt-4 rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-blue-100 text-2xl">
                  📷
                </div>
                <p className="mt-4 text-sm text-slate-600">
                  Allow camera access to scan QR codes.
                </p>
                {cameraError && (
                  <p className="mt-2 text-sm font-medium text-red-600">
                    {cameraError}
                  </p>
                )}
                <button
                  type="button"
                  onClick={requestCameraPermission}
                  disabled={
                    attendanceDisabled || cameraPermission === "pending"
                  }
                  className="mt-4 inline-flex w-full items-center justify-center rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                >
                  {cameraPermission === "pending"
                    ? "Requesting permission..."
                    : "Enable camera"}
                </button>
              </div>
            ) : (
              <div className="mt-4 overflow-hidden rounded-3xl border border-slate-100 bg-slate-950 shadow-inner">
                <QrReader
                  constraints={{ facingMode: "environment" }}
                  scanDelay={800}
                  onResult={(
                    result: QrReaderScanResult | null | undefined,
                    error: QrReaderScanError | null | undefined,
                  ) => {
                    if (result) {
                      void handleScanResult(result.getText());
                    }

                    if (error && error.name !== "NotFoundException") {
                      setCameraError(
                        "Unable to read QR code. Please try again.",
                      );
                    }
                  }}
                  containerStyle={{ width: "100%" }}
                  videoContainerStyle={{
                    width: "100%",
                    paddingTop: "100%",
                    position: "relative",
                  }}
                  videoStyle={{ objectFit: "cover" }}
                />
                <div className="border-t border-white/10 px-4 py-3 text-sm text-slate-200">
                  Align the QR code inside the frame. Scans will pause briefly
                  after each result.
                </div>
              </div>
            )}
          </section>
        ) : (
          <section className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  Manual check-in
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Search members by name, ID, or phone, then mark them present.
                </p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                {filteredMembers.length} members
              </span>
            </div>

            <div className="mt-4">
              <label htmlFor="member-search" className="sr-only">
                Search members
              </label>
              <input
                id="member-search"
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search by name, ID, or phone"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-50"
              />
            </div>

            <div className="mt-4 space-y-3">
              {filteredMembers.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                  No members matched your search.
                </div>
              ) : (
                filteredMembers.map((member) => {
                  const isPresent = presentMembers.has(member.id);

                  return (
                    <div
                      key={member.id}
                      className={`flex items-center justify-between gap-3 rounded-2xl border p-4 ${
                        isPresent
                          ? "border-green-100 bg-green-50/60"
                          : "border-slate-100"
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900">
                          {member.name}
                        </p>
                        <p className="mt-1 truncate text-sm text-slate-500">
                          {member.uniqueId}
                          {member.phone ? ` • ${member.phone}` : ""}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          void markAttendance(member.id, "MANUAL", member)
                        }
                        disabled={
                          attendanceDisabled || isSubmitting || isPresent
                        }
                        className={`shrink-0 rounded-2xl px-4 py-2.5 text-sm font-semibold transition ${
                          isPresent
                            ? "bg-green-100 text-green-700"
                            : "bg-slate-900 text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                        }`}
                      >
                        {isPresent ? "Present ✓" : "Mark Present"}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        )}

        <section className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">
                Attendance count
              </p>
            </div>
            <div className="rounded-2xl bg-blue-50 px-4 py-2 text-right text-blue-700">
              <p className="text-xs font-semibold uppercase tracking-wide">
                Present
              </p>
              <p className="text-xl font-bold">{event.attendanceCount}</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

const FeedbackBanner: React.FC<{ feedback: AttendanceFeedback }> = ({
  feedback,
}) => {
  const theme =
    feedback.tone === "success"
      ? "border-green-100 bg-green-50 text-green-800"
      : feedback.tone === "info"
        ? "border-blue-100 bg-blue-50 text-blue-800"
        : "border-red-100 bg-red-50 text-red-800";

  return (
    <section className={`rounded-3xl border p-4 shadow-sm ${theme}`}>
      <p className="text-sm font-semibold">{feedback.title}</p>
      {feedback.description && (
        <p className="mt-1 text-sm opacity-90">{feedback.description}</p>
      )}
    </section>
  );
};

export default TakeAttendancePage;
