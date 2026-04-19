import React, { useEffect, useMemo, useState } from "react";
import { isAxiosError } from "axios";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import api, { setSessionExpiredHandler } from "../lib/api";
import formatDate from "../lib/formatDate";
import QrAttendanceScanner from "../components/QrAttendanceScanner";
import { usePersistentState } from "../hooks/usePersistentState";
import { useScrollDirection } from "../hooks/useScrollDirection";
import type {
  DashboardEvent,
  EventAttendanceRecord,
  EventAttendanceResponse,
} from "../types/events";
import type { AttendanceRecordResponse, Member } from "../types/members";

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
  const eventStart = rawEvent.startTime
    ? new Date(rawEvent.startTime)
    : new Date(rawEvent.eventDate ?? new Date());
  const eventEnd = rawEvent.endTime
    ? new Date(rawEvent.endTime)
    : new Date(eventStart.getTime() + 2 * 60 * 60 * 1000);

  const status: DashboardEvent["status"] =
    (rawEvent.status as DashboardEvent["status"]) ?? "UPCOMING";
  const attendanceOpen = Boolean(rawEvent.attendanceOpen);

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
  DEACTIVATED: { title: "Member is deactivated", tone: "error" },
  EVENT_CLOSED: { title: "Event closed", tone: "error" },
  SUCCESS: { title: "Attendance recorded", tone: "success" },
};

const MANUAL_PAGE_SIZE = 20;
const attendancePageCache = new Map<string, EventAttendanceResponse>();

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
  const [submittingMemberId, setSubmittingMemberId] = useState<string | null>(
    null,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [feedback, setFeedback] = useState<AttendanceFeedback | null>(null);
  const [presentMembers, setPresentMembers] = useState<Set<string>>(
    () => new Set(),
  );
  const [attendanceRecords, setAttendanceRecords] = useState<
    EventAttendanceRecord[]
  >([]);
  const [manualPage, setManualPage] = useState(1);
  const [prefetchingPage, setPrefetchingPage] = useState<number | null>(null);

  type StatusFilter = "ALL" | "ACTIVE" | "INACTIVE";
  type SortOption =
    | "DEFAULT"
    | "ALPHA_ASC"
    | "ALPHA_DESC"
    | "RECENTLY_REGISTERED";

  const [statusFilter, setStatusFilter] = usePersistentState<StatusFilter>(
    "take-attendance-status-filter",
    "ALL",
  );
  const [sortBy, setSortBy] = usePersistentState<SortOption>(
    "take-attendance-sort-by",
    "DEFAULT",
  );
  const [isSortModalOpen, setIsSortModalOpen] = useState(false);
  const [isFilterDropdownOpen, setIsFilterDropdownOpen] = useState(false);

  const sortDropdownRef = React.useRef<HTMLDivElement>(null);
  const filterDropdownRef = React.useRef<HTMLDivElement>(null);

  const scrollDirection = useScrollDirection();

  const attendanceDisabled =
    !event?.attendanceOpen || event?.status !== "ACTIVE";

  useEffect(() => {
    setSessionExpiredHandler(() => {
      navigate("/login", {
        state: { from: location },
        replace: true,
      });
    });

    return () => {
      setSessionExpiredHandler(null);
    };
  }, [location, navigate]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        sortDropdownRef.current &&
        !sortDropdownRef.current.contains(event.target as Node)
      ) {
        setIsSortModalOpen(false);
      }
      if (
        filterDropdownRef.current &&
        !filterDropdownRef.current.contains(event.target as Node)
      ) {
        setIsFilterDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    // Auto-dismiss feedback message after 3 seconds so screen stays clean
    if (feedback) {
      const timer = setTimeout(() => {
        setFeedback(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [feedback]);

  const handleQrSuccess = async (result: {
    memberId: string;
    memberName?: string;
  }) => {
    // Update local state for immediate feedback
    if (result.memberName) {
      setFeedback({
        ...ATTENDANCE_MESSAGES.SUCCESS,
        description: `${result.memberName} has been checked in.`,
      });
    } else {
      setFeedback({
        ...ATTENDANCE_MESSAGES.SUCCESS,
      });
    }

    // Refresh lists
    try {
      await Promise.all([
        refreshPresentMembers(),
        loadAttendancePage(1, { preferCache: false }),
        refreshEvent(),
      ]);
    } catch (e) {
      console.error("Background refresh failed", e);
    }
  };

  const handleQrError = (error: any) => {
    setFeedback(getFeedbackFromError(error));
  };

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

  const getAttendanceCacheKey = React.useCallback(
    (page: number) => `${id ?? "unknown"}:${page}`,
    [id],
  );

  const loadAttendancePage = React.useCallback(
    async (
      page: number,
      options?: { silent?: boolean; preferCache?: boolean },
    ) => {
      if (!id) {
        return null;
      }

      const { silent = false, preferCache = true } = options ?? {};
      const cacheKey = getAttendanceCacheKey(page);

      if (preferCache && attendancePageCache.has(cacheKey)) {
        const cached = attendancePageCache.get(cacheKey)!;
        if (!silent) {
          setAttendanceRecords(cached.data);
        }
        return cached;
      }

      if (silent) {
        setPrefetchingPage(page);
      }

      try {
        const response = await api.get<EventAttendanceResponse>(
          `/events/${id}/attendance`,
          {
            params: {
              page,
              limit: 200,
              sortBy: "time",
              order: "desc",
            },
          },
        );

        attendancePageCache.set(cacheKey, response.data);

        if (!silent) {
          setAttendanceRecords(response.data.data);
        }

        return response.data;
      } finally {
        if (silent) {
          setPrefetchingPage((current) => (current === page ? null : current));
        }
      }
    },
    [getAttendanceCacheKey, id],
  );

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
          loadAttendancePage(1, { preferCache: false }),
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
  }, [refreshEvent, refreshMembers, refreshPresentMembers, loadAttendancePage]);

  const markedAtByMemberId = useMemo(() => {
    return attendanceRecords.reduce<Record<string, string>>((acc, record) => {
      acc[record.memberId] = record.markedAt;
      return acc;
    }, {});
  }, [attendanceRecords]);

  // Filter members by status and search
  const baseFilteredMembers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return members.filter((member) => {
      const matchStatus =
        statusFilter === "ALL" ||
        (statusFilter === "ACTIVE" && member.isActive !== false) ||
        (statusFilter === "INACTIVE" && member.isActive === false);

      const matchSearch =
        !query ||
        [member.name, member.uniqueId, member.phoneNumber ?? ""].some((value) =>
          value.toLowerCase().includes(query),
        );

      return matchStatus && matchSearch;
    });
  }, [members, statusFilter, searchQuery]);

  const filteredMembers = useMemo(() => {
    const orderedMembers = [...baseFilteredMembers].sort((a, b) => {
      if (sortBy === "DEFAULT") {
        const aDeactivated = a.isActive === false;
        const bDeactivated = b.isActive === false;
        if (aDeactivated !== bDeactivated) {
          return aDeactivated ? 1 : -1;
        }

        const aPresent = presentMembers.has(a.id);
        const bPresent = presentMembers.has(b.id);
        if (aPresent !== bPresent) {
          return aPresent ? 1 : -1;
        }

        if (aPresent && bPresent) {
          const aMarkedAt = markedAtByMemberId[a.id]
            ? new Date(markedAtByMemberId[a.id]).getTime()
            : 0;
          const bMarkedAt = markedAtByMemberId[b.id]
            ? new Date(markedAtByMemberId[b.id]).getTime()
            : 0;

          if (aMarkedAt !== bMarkedAt) {
            return bMarkedAt - aMarkedAt;
          }
        }

        return a.name.localeCompare(b.name);
      } else if (sortBy === "ALPHA_ASC") {
        return a.name.localeCompare(b.name);
      } else if (sortBy === "ALPHA_DESC") {
        return b.name.localeCompare(a.name);
      } else if (sortBy === "RECENTLY_REGISTERED") {
        return (
          new Date(b.createdAt || 0).getTime() -
          new Date(a.createdAt || 0).getTime()
        );
      }
      return 0;
    });

    return orderedMembers;
  }, [baseFilteredMembers, markedAtByMemberId, presentMembers, sortBy]);

  const totalManualPages = Math.max(
    1,
    Math.ceil(filteredMembers.length / MANUAL_PAGE_SIZE),
  );

  const paginatedMembers = filteredMembers.slice(
    (manualPage - 1) * MANUAL_PAGE_SIZE,
    manualPage * MANUAL_PAGE_SIZE,
  );

  useEffect(() => {
    setManualPage(1);
  }, [attendanceRecords, members, presentMembers, searchQuery]);

  useEffect(() => {
    if (manualPage >= totalManualPages) {
      return;
    }

    void loadAttendancePage(manualPage + 1, { silent: true });
  }, [loadAttendancePage, manualPage, totalManualPages]);

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

      if (error.response?.status === 403) {
        return {
          ...ATTENDANCE_MESSAGES.DEACTIVATED,
          description: message || "This member has been deactivated.",
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

    const memberIdForLoading =
      memberForUi?.id ??
      members.find(
        (member) =>
          member.id === memberIdentifier || member.uniqueId === memberIdentifier,
      )?.id ??
      null;

    setSubmittingMemberId(memberIdForLoading);
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
      await refreshPresentMembers();
      await loadAttendancePage(1, { preferCache: false });
    } catch (error) {
      setFeedback(getFeedbackFromError(error));
    } finally {
      setSubmittingMemberId(null);
    }
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

  const getSortLabel = (sortValue: SortOption) => {
    switch (sortValue) {
      case "DEFAULT":
        return "Default";
      case "ALPHA_ASC":
        return "Alphabetical (A → Z)";
      case "ALPHA_DESC":
        return "Alphabetical (Z → A)";
      case "RECENTLY_REGISTERED":
        return "Recently Registered";
      default:
        return "";
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-8">
      <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-4 sm:max-w-2xl sm:px-6 sm:py-6">
        <div
          className={`sticky top-0 z-10 -mx-4 border-b border-slate-100 bg-slate-50/95 px-4 pb-4 pt-1 backdrop-blur sm:static sm:mx-0 sm:border-none sm:bg-transparent sm:px-0 sm:pb-0 transition-transform duration-300 ${
            scrollDirection === "down" ? "-translate-y-full" : "translate-y-0"
          }`}
        >
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
                className={`flex-shrink-0 inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusBadgeClass}`}
              >
                {event.status}
              </span>
            </div>

            <div className="mt-4 flex flex-col gap-2 rounded-2xl bg-white/10 px-4 py-3">
              <div className="flex items-center gap-2 text-white">
                <svg
                  className="h-4 w-4 text-blue-200"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <span className="text-sm font-medium">
                  {formatDate(event.startTime)} •{" "}
                  {formatTimeRange(event.startTime, event.endTime)}
                </span>
              </div>

              {event.location && (
                <div className="flex items-center gap-2 text-white">
                  <svg
                    className="h-4 w-4 text-blue-200"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                  <span className="text-sm font-medium">{event.location}</span>
                </div>
              )}
            </div>
          </header>

          <div className="mt-4">
            <div className="flex rounded-full bg-slate-200 p-1">
              {(["QR", "MANUAL"] as PageTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`w-full rounded-full py-2 text-sm font-semibold transition-colors ${
                    activeTab === tab
                      ? "bg-white text-slate-900 shadow-sm"
                      : "bg-transparent text-slate-600 hover:bg-white/50"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          {feedback && (
            <div
              className={`mt-4 rounded-xl p-4 text-sm ${
                feedback.tone === "success"
                  ? "bg-green-50 text-green-900"
                  : feedback.tone === "error"
                    ? "bg-red-50 text-red-900"
                    : "bg-blue-50 text-blue-900"
              }`}
            >
              <p className="font-semibold">{feedback.title}</p>
              {feedback.description && (
                <p className="mt-1">{feedback.description}</p>
              )}
            </div>
          )}
        </div>

        {activeTab === "QR" && (
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            {attendanceDisabled ? (
              <div className="text-center text-slate-500">
                <p>QR scanning is not available for this event.</p>
              </div>
            ) : (
              <>
                <div className="relative mx-auto max-w-sm">
                  <QrAttendanceScanner
                    eventId={event.id}
                    onScanSuccess={handleQrSuccess}
                    onApiError={handleQrError}
                    resolveMemberId={(code) => {
                      // Attempt to resolve custom uniqueId to UUID so we don't crash Postgres natively.
                      const match = members.find(
                        (m) => m.uniqueId === code || m.id === code,
                      );
                      return match ? match.id : code;
                    }}
                  />
                </div>
                <p className="mt-4 text-center text-sm text-slate-500">
                  Point the camera at a member's QR code to mark their
                  attendance.
                </p>
              </>
            )}
          </div>
        )}

        {activeTab === "MANUAL" && (
          <div className="flex flex-col gap-4">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">
                    Manual Check-in
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {event.attendanceCount} of {members.length} members present
                  </p>
                </div>
              </div>

              {/* Filters & Sort & Search */}
              <div className="mt-4 flex flex-col gap-3">
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search members..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full rounded-full border border-slate-200 bg-slate-50 py-2 pl-10 pr-4 text-sm text-slate-800 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
                  />
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <svg
                      className="h-5 w-5 text-slate-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                      />
                    </svg>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                  {/* Mobile Filter view: horizontally scrolling pills */}
                  <div className="flex overflow-x-auto no-scrollbar gap-2 pb-1 flex-1 sm:hidden">
                    {(["ALL", "ACTIVE", "INACTIVE"] as StatusFilter[]).map(
                      (filter) => (
                        <button
                          key={filter}
                          onClick={() => setStatusFilter(filter)}
                          className={`whitespace-nowrap px-4 py-1.5 rounded-full text-sm font-medium transition-colors border ${
                            statusFilter === filter
                              ? filter === "ACTIVE"
                                ? "bg-green-600 text-white border-green-600"
                                : filter === "INACTIVE"
                                  ? "bg-red-600 text-white border-red-600"
                                  : "bg-blue-600 text-white border-blue-600"
                              : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"
                          }`}
                        >
                          {filter === "ALL"
                            ? "All"
                            : filter.charAt(0) + filter.slice(1).toLowerCase()}
                        </button>
                      ),
                    )}
                  </div>

                  {/* Desktop Filter View: Dropdown */}
                  <div
                    className="hidden sm:block relative flex-shrink-0"
                    ref={filterDropdownRef}
                  >
                    <button
                      onClick={() =>
                        setIsFilterDropdownOpen(!isFilterDropdownOpen)
                      }
                      className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors mb-1"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
                        ></path>
                      </svg>
                      <span>
                        Filter:{" "}
                        {statusFilter === "ALL"
                          ? "All"
                          : statusFilter.charAt(0) +
                            statusFilter.slice(1).toLowerCase()}
                      </span>
                    </button>

                    {isFilterDropdownOpen && (
                      <div className="absolute left-0 mt-2 w-48 bg-white border border-slate-100 rounded-xl shadow-lg z-50 py-2">
                        <div className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                          Status Filter
                        </div>
                        {(["ALL", "ACTIVE", "INACTIVE"] as StatusFilter[]).map(
                          (filter) => (
                            <button
                              key={filter}
                              onClick={() => {
                                setStatusFilter(filter);
                                setIsFilterDropdownOpen(false);
                              }}
                              className={`w-full text-left px-4 py-2 text-sm flex items-center justify-between hover:bg-slate-50 transition-colors ${
                                statusFilter === filter
                                  ? "font-semibold text-blue-600"
                                  : "text-slate-700"
                              }`}
                            >
                              {filter === "ALL"
                                ? "All"
                                : filter.charAt(0) +
                                  filter.slice(1).toLowerCase()}
                              {statusFilter === filter && (
                                <svg
                                  className="w-4 h-4"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth="2"
                                    d="M5 13l4 4L19 7"
                                  ></path>
                                </svg>
                              )}
                            </button>
                          ),
                        )}
                      </div>
                    )}
                  </div>

                  {/* Sort Button */}
                  <div className="relative flex-shrink-0" ref={sortDropdownRef}>
                    <button
                      onClick={() => setIsSortModalOpen(!isSortModalOpen)}
                      className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors mb-1"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12"
                        ></path>
                      </svg>
                      <span className="hidden sm:inline">Sort</span>
                    </button>

                    {isSortModalOpen && (
                      <div className="absolute right-0 mt-2 w-56 bg-white border border-slate-100 rounded-xl shadow-lg z-50 py-2">
                        <div className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                          Sort By
                        </div>
                        {(
                          [
                            "DEFAULT",
                            "ALPHA_ASC",
                            "ALPHA_DESC",
                            "RECENTLY_REGISTERED",
                          ] as SortOption[]
                        ).map((option) => (
                          <button
                            key={option}
                            onClick={() => {
                              setSortBy(option);
                              setIsSortModalOpen(false);
                            }}
                            className={`w-full text-left px-4 py-2 text-sm flex items-center justify-between hover:bg-slate-50 transition-colors ${
                              sortBy === option
                                ? "font-semibold text-blue-600"
                                : "text-slate-700"
                            }`}
                          >
                            {getSortLabel(option)}
                            {sortBy === option && (
                              <svg
                                className="w-4 h-4"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth="2"
                                  d="M5 13l4 4L19 7"
                                ></path>
                              </svg>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {prefetchingPage && (
                <div className="mt-2 text-center text-xs text-slate-400">
                  Loading more records...
                </div>
              )}

              <ul className="mt-4 divide-y divide-slate-100">
                {paginatedMembers.map((member) => {
                  const isPresent = presentMembers.has(member.id);
                  const isDeactivated = member.isActive === false;
                  const canMark = !isDeactivated && !isPresent;
                  const isMarkingThisMember = submittingMemberId === member.id;

                  return (
                    <li
                      key={member.id}
                      className={`flex items-center justify-between rounded-xl py-3 transition ${
                        isMarkingThisMember ? "bg-blue-50/70 px-2" : ""
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`h-10 w-10 rounded-full ${
                            isPresent
                              ? "bg-green-100 text-green-600"
                              : isDeactivated
                                ? "bg-slate-100 text-slate-400"
                                : "bg-slate-100 text-slate-500"
                          } flex items-center justify-center text-lg font-semibold`}
                        >
                          {member.name.charAt(0)}
                        </div>
                        <div>
                          <p
                            className={`font-medium ${
                              isDeactivated
                                ? "text-slate-400"
                                : "text-slate-800"
                            }`}
                          >
                            {member.name}
                          </p>
                          <p
                            className={`text-sm ${
                              isDeactivated
                                ? "text-slate-400"
                                : "text-slate-500"
                            }`}
                          >
                            {member.uniqueId}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          markAttendance(member.id, "MANUAL", member)
                        }
                        disabled={
                          !canMark || submittingMemberId !== null || attendanceDisabled
                        }
                        className={`inline-flex min-w-[96px] items-center justify-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                          isPresent
                            ? "bg-green-100 text-green-700"
                            : isDeactivated
                              ? "cursor-not-allowed bg-slate-100 text-slate-400"
                              : "bg-blue-50 text-blue-600 hover:bg-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                        }`}
                      >
                        {isPresent ? (
                          "Present"
                        ) : isMarkingThisMember ? (
                          <>
                            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-blue-300 border-t-blue-700" />
                            Marking
                          </>
                        ) : (
                          "Mark"
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>

              {totalManualPages > 1 && (
                <div className="mt-4 flex items-center justify-between">
                  <button
                    onClick={() => setManualPage((p) => Math.max(1, p - 1))}
                    disabled={manualPage === 1}
                    className="rounded-md bg-white px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <span className="text-sm text-slate-600">
                    Page {manualPage} of {totalManualPages}
                  </span>
                  <button
                    onClick={() =>
                      setManualPage((p) => Math.min(totalManualPages, p + 1))
                    }
                    disabled={manualPage === totalManualPages}
                    className="rounded-md bg-white px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TakeAttendancePage;
