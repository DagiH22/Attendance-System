import React, { useEffect, useState, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import api, { getStudies, rescheduleEvent, cancelEvent } from "../lib/api";
import { toFriendlyError } from "../lib/errors";
import formatDate from "../lib/formatDate";
import type { DashboardEvent, Study, SessionType } from "../types/events";
import { useAuth } from "../contexts/AuthContext";
import { usePersistentState } from "../hooks/usePersistentState";

type StatusOption = "UPCOMING" | "ACTIVE" | "PAST" | "DEACTIVATED" | "CANCELLED";
type TypeFilter = "ALL" | "WEEKLY" | "MONTHLY" | "ONE_TIME";
type SessionTypeFilter = "ALL" | "EVENING" | "OVERNIGHT" | "OTHER";
type SortOption =
  | "DEFAULT"
  | "NEXT_EVENT"
  | "RECENTLY_CREATED"
  | "HIGHEST_ATTENDANCE"
  | "LOWEST_ATTENDANCE";

const BATCH_SIZE = 50;

const toDateTimeLocalValue = (value: string) => {
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60_000);
  return localDate.toISOString().slice(0, 16);
};

const mapEventToDashboardEvent = (event: any): DashboardEvent => {
  const startIso = event.startTime ?? event.eventDate;
  const eventStart = startIso ? new Date(startIso) : new Date();
  const eventEnd = event.endTime
    ? new Date(event.endTime)
    : new Date(eventStart.getTime() + 2 * 60 * 60 * 1000);

  const status: DashboardEvent["status"] =
    (event.status as DashboardEvent["status"]) ?? "UPCOMING";
  const attendanceOpen = Boolean(event.attendanceOpen);

  return {
    id: event.id,
    title: event.title,
    description: event.description || "",
    startTime: event.startTime ?? eventStart.toISOString(),
    endTime: event.endTime ?? eventEnd.toISOString(),
    status,
    attendanceOpen,
    location: event.location || "",
    eventType: event.type as DashboardEvent["eventType"],
    sessionType: (event.sessionType as SessionType) || "EVENING",
    studyId: event.studyId || null,
    study: event.study || null,
    plannedStartTime: event.plannedStartTime || null,
    rescheduleReason: event.rescheduleReason || null,
    rescheduledAt: event.rescheduledAt || null,
    cancelReason: event.cancelReason || null,
    cancelledAt: event.cancelledAt || null,
    lateGraceMinutes: event.lateGraceMinutes ?? null,
    createdBy: {
      id: event.admin?.id || event.createdBy?.id || "unknown-admin",
      name: event.admin?.name || event.createdBy?.name || "Admin User",
    },
    attendanceCount: event._count?.attendances || event.attendanceCount || 0,
    createdAt: event.createdAt || eventStart.toISOString(),
    totalMembers: event.totalMembers || 0,
    stats: event.stats || undefined,
  };
};

const EventsPage: React.FC = () => {
  const [events, setEvents] = useState<DashboardEvent[]>([]);
  const [studies, setStudies] = useState<Study[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [totalEvents, setTotalEvents] = useState<number>(0);
  const [initialLoaded, setInitialLoaded] = useState(false);

  const loadedBatchOffsetsRef = React.useRef<Set<number>>(new Set());
  const pendingBatchOffsetsRef = React.useRef<Set<number>>(new Set());

  // Filters and Sorting State
  const [statusFilter, setStatusFilter] = usePersistentState<StatusOption[]>(
    "events-status-filter-v2",
    [],
  );
  const [typeFilter, setTypeFilter] = usePersistentState<TypeFilter>(
    "events-type-filter",
    "ALL",
  );
  const [sessionTypeFilter, setSessionTypeFilter] = useState<SessionTypeFilter>("ALL");
  const [studyFilter, setStudyFilter] = useState<string>("ALL");
  const [sortBy, setSortBy] = usePersistentState<SortOption>(
    "events-sort-by",
    "NEXT_EVENT",
  );
  const [isSortModalOpen, setIsSortModalOpen] = useState(false);

  // Collapsed study sections (studyId or "STANDALONE")
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // Search State
  const [searchQuery, setSearchQuery] = usePersistentState<string>(
    "events-search-query",
    "",
  );
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(searchQuery);
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);

  const searchInputRef = React.useRef<HTMLInputElement | null>(null);

  // Debounce effect
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Dropdown states for desktop
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState(false);
  const [isSessionTypeDropdownOpen, setIsSessionTypeDropdownOpen] = useState(false);
  const [isStudyDropdownOpen, setIsStudyDropdownOpen] = useState(false);

  // Click outside handlers ref
  const sortDropdownRef = React.useRef<HTMLDivElement>(null);
  const statusDropdownRef = React.useRef<HTMLDivElement>(null);
  const sessionTypeDropdownRef = React.useRef<HTMLDivElement>(null);
  const studyDropdownRef = React.useRef<HTMLDivElement>(null);

  const navigate = useNavigate();
  const location = useLocation();
  const { logout, admin } = useAuth();

  // Modals state
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<DashboardEvent | null>(null);
  const [editError, setEditError] = useState("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editForm, setEditForm] = useState({
    title: "",
    description: "",
    status: "UPCOMING" as DashboardEvent["status"],
    startTime: "",
    endTime: "",
  });

  // Reschedule Modal
  const [isRescheduleModalOpen, setIsRescheduleModalOpen] = useState(false);
  const [rescheduleEventTarget, setRescheduleEventTarget] = useState<DashboardEvent | null>(null);
  const [rescheduleForm, setRescheduleForm] = useState({
    startTime: "",
    endTime: "",
    reason: "",
  });
  const [rescheduleError, setRescheduleError] = useState("");
  const [isRescheduling, setIsRescheduling] = useState(false);

  // Cancel Modal
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [cancelEventTarget, setCancelEventTarget] = useState<DashboardEvent | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelError, setCancelError] = useState("");
  const [isCancelling, setIsCancelling] = useState(false);

  const STATUS_OPTIONS: StatusOption[] = [
    "UPCOMING",
    "ACTIVE",
    "PAST",
    "DEACTIVATED",
    "CANCELLED",
  ];

  const formatStatusLabel = (s: StatusOption) => {
    if (s === "DEACTIVATED") return "Deactivated";
    if (s === "CANCELLED") return "Cancelled";
    if (s === "PAST") return "Past";
    return s.charAt(0) + s.slice(1).toLowerCase();
  };

  const toggleStatus = (s: StatusOption) => {
    setStatusFilter((prev) => {
      const found = prev.includes(s);
      if (found) return prev.filter((x) => x !== s);
      return [...prev, s];
    });
  };

  const toggleGroupCollapse = (groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  // Fetch studies
  useEffect(() => {
    getStudies()
      .then((data: Study[]) => setStudies(data || []))
      .catch((err) => console.error("Failed to load studies", err));
  }, []);

  useEffect(() => {
    void fetchEventsBatch(0, { replace: true, showLoader: true });

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (sortDropdownRef.current && !sortDropdownRef.current.contains(target)) {
        setIsSortModalOpen(false);
      }
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(target)) {
        setIsStatusDropdownOpen(false);
      }
      if (sessionTypeDropdownRef.current && !sessionTypeDropdownRef.current.contains(target)) {
        setIsSessionTypeDropdownOpen(false);
      }
      if (studyDropdownRef.current && !studyDropdownRef.current.contains(target)) {
        setIsStudyDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    if ((location.state as { refreshEvents?: boolean } | null)?.refreshEvents) {
      loadedBatchOffsetsRef.current.clear();
      pendingBatchOffsetsRef.current.clear();
      void fetchEventsBatch(0, { replace: true, showLoader: false });
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.pathname, location.state, navigate]);

  useEffect(() => {
    if (!initialLoaded) return;
    const intervalId = window.setInterval(() => {
      loadedBatchOffsetsRef.current.clear();
      pendingBatchOffsetsRef.current.clear();
      void fetchEventsBatch(0, { replace: true, showLoader: false });
    }, 60_000);
    return () => window.clearInterval(intervalId);
  }, [initialLoaded]);

  const fetchEventsBatch = async (
    offset: number,
    options?: { replace?: boolean; showLoader?: boolean },
  ) => {
    const { replace = false, showLoader = false } = options ?? {};

    if (
      loadedBatchOffsetsRef.current.has(offset) ||
      pendingBatchOffsetsRef.current.has(offset)
    ) {
      return;
    }

    try {
      pendingBatchOffsetsRef.current.add(offset);
      if (showLoader) {
        setLoading(true);
      }

      const response = await api.get("/events", {
        params: {
          offset,
          limit: BATCH_SIZE,
        },
      });
      const fetchedEvents = response.data?.events || [];
      const nextTotalEvents = response.data?.totalEvents ?? 0;

      setTotalEvents(nextTotalEvents);

      if (Array.isArray(fetchedEvents)) {
        const transformedEvents: DashboardEvent[] = fetchedEvents.map(
          mapEventToDashboardEvent,
        );

        setEvents((prev) => {
          const mergedEvents = replace
            ? transformedEvents
            : [...prev, ...transformedEvents];
          const uniqueEvents = new Map<string, DashboardEvent>();

          for (const item of mergedEvents) {
            uniqueEvents.set(item.id, item);
          }
          return Array.from(uniqueEvents.values());
        });

        loadedBatchOffsetsRef.current.add(offset);
        setInitialLoaded(true);
      }
    } catch (err: any) {
      console.error("Error fetching events:", err);
      const friendly = toFriendlyError(err, {
        action: "load events",
        fallbackTitle: "Couldn't load events",
        fallbackMessage: "Please try again.",
      });
      setError(friendly.message);
    } finally {
      pendingBatchOffsetsRef.current.delete(offset);
      if (showLoader) {
        setLoading(false);
      }
    }
  };

  // Filter and Sort Logic
  const filteredEvents = events.filter((e) => {
    const matchStatus =
      statusFilter.length === 0 ||
      statusFilter.includes(e.status as StatusOption);
    const matchType = typeFilter === "ALL" || e.eventType === typeFilter;
    const matchSessionType =
      sessionTypeFilter === "ALL" || e.sessionType === sessionTypeFilter;
    const matchStudy =
      studyFilter === "ALL"
        ? true
        : studyFilter === "STANDALONE"
          ? !e.studyId
          : e.studyId === studyFilter;

    const normalizedSearch = debouncedSearchQuery.toLowerCase().trim();
    const matchSearch =
      normalizedSearch === "" ||
      e.title.toLowerCase().includes(normalizedSearch) ||
      e.description.toLowerCase().includes(normalizedSearch) ||
      (e.study?.name && e.study.name.toLowerCase().includes(normalizedSearch)) ||
      e.eventType.toLowerCase().replace("_", " ").includes(normalizedSearch);

    return matchStatus && matchType && matchSessionType && matchStudy && matchSearch;
  });

  const sortedEvents =
    sortBy === "DEFAULT"
      ? filteredEvents
      : [...filteredEvents].sort((a, b) => {
          switch (sortBy) {
            case "NEXT_EVENT": {
              const rank: Record<string, number> = {
                ACTIVE: 0,
                UPCOMING: 1,
                PAST: 2,
                DEACTIVATED: 3,
                CANCELLED: 4,
              };
              const rankA = rank[a.status] ?? 5;
              const rankB = rank[b.status] ?? 5;
              if (rankA !== rankB) return rankA - rankB;
              return (
                new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
              );
            }
            case "RECENTLY_CREATED":
              return (
                new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
              );
            case "HIGHEST_ATTENDANCE":
              return b.attendanceCount - a.attendanceCount;
            case "LOWEST_ATTENDANCE":
              return a.attendanceCount - b.attendanceCount;
            default:
              return 0;
          }
        });

  // Grouping into Study groups + Standalone group
  const groupedSections = useMemo(() => {
    const studyMap = new Map<
      string,
      { study: Study | { id: string; name: string }; events: DashboardEvent[] }
    >();
    const standaloneEvents: DashboardEvent[] = [];

    // Initialize with known studies if in studies list
    for (const ev of sortedEvents) {
      if (ev.studyId) {
        if (!studyMap.has(ev.studyId)) {
          const knownStudy =
            studies.find((s) => s.id === ev.studyId) ||
            ev.study || { id: ev.studyId, name: "Study Session Group" };
          studyMap.set(ev.studyId, { study: knownStudy, events: [] });
        }
        studyMap.get(ev.studyId)!.events.push(ev);
      } else {
        standaloneEvents.push(ev);
      }
    }

    return {
      studies: Array.from(studyMap.values()),
      standalone: standaloneEvents,
    };
  }, [sortedEvents, studies]);

  const formatTime = (isoString: string) => {
    return new Date(isoString).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getStatusColor = (status: DashboardEvent["status"]) => {
    if (status === "ACTIVE")
      return "bg-green-100 text-green-800 border-green-200";
    if (status === "UPCOMING")
      return "bg-blue-100 text-blue-800 border-blue-200";
    if (status === "DEACTIVATED")
      return "bg-yellow-50 text-yellow-800 border-yellow-100";
    if (status === "CANCELLED")
      return "bg-red-100 text-red-800 border-red-200";
    return "bg-gray-100 text-gray-800 border-gray-200";
  };

  const getSortLabel = (sortValue: SortOption) => {
    switch (sortValue) {
      case "DEFAULT":
        return "Default";
      case "NEXT_EVENT":
        return "Next Event";
      case "RECENTLY_CREATED":
        return "Recently Created";
      case "HIGHEST_ATTENDANCE":
        return "Highest Attendance";
      case "LOWEST_ATTENDANCE":
        return "Lowest Attendance";
      default:
        return "";
    }
  };

  const isSuperAdmin = admin?.role === "SUPER_ADMIN";

  // Actions
  const openEditModal = (event: DashboardEvent) => {
    setSelectedEvent(event);
    setEditError("");
    setEditForm({
      title: event.title,
      description: event.description || "",
      status: event.status === "DEACTIVATED" ? "DEACTIVATED" : "UPCOMING",
      startTime: toDateTimeLocalValue(event.startTime),
      endTime: toDateTimeLocalValue(event.endTime),
    });
    setIsEditModalOpen(true);
  };

  const handleEditSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedEvent) return;

    const parsedStartTime = new Date(editForm.startTime);
    const parsedEndTime = new Date(editForm.endTime);

    if (
      Number.isNaN(parsedStartTime.getTime()) ||
      Number.isNaN(parsedEndTime.getTime())
    ) {
      setEditError("Please enter valid start and end times.");
      return;
    }

    if (parsedStartTime.getTime() <= Date.now()) {
      setEditError("Only upcoming events can be edited.");
      return;
    }

    if (parsedEndTime <= parsedStartTime) {
      setEditError("End time must be after start time.");
      return;
    }

    try {
      setIsSavingEdit(true);
      setEditError("");

      const response = await api.patch(`/events/${selectedEvent.id}`, {
        title: editForm.title.trim(),
        description: editForm.description.trim(),
        status: editForm.status === "DEACTIVATED" ? "DEACTIVATED" : "UPCOMING",
        startTime: parsedStartTime.toISOString(),
        endTime: parsedEndTime.toISOString(),
      });

      const updatedEvent = mapEventToDashboardEvent(
        response.data?.event ?? response.data,
      );

      setEvents((prev) =>
        prev.map((item) => (item.id === updatedEvent.id ? updatedEvent : item)),
      );
      setIsEditModalOpen(false);
      setSelectedEvent(null);
    } catch (err: any) {
      setEditError(
        err.response?.data?.error ||
          err.response?.data?.message ||
          "Failed to update event.",
      );
    } finally {
      setIsSavingEdit(false);
    }
  };

  const openRescheduleModal = (event: DashboardEvent) => {
    setRescheduleEventTarget(event);
    setRescheduleError("");
    setRescheduleForm({
      startTime: toDateTimeLocalValue(event.startTime),
      endTime: toDateTimeLocalValue(event.endTime),
      reason: "",
    });
    setIsRescheduleModalOpen(true);
  };

  const handleRescheduleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!rescheduleEventTarget) return;

    if (!rescheduleForm.reason.trim()) {
      setRescheduleError("Please provide a reason for rescheduling.");
      return;
    }

    const start = new Date(rescheduleForm.startTime);
    const end = new Date(rescheduleForm.endTime);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
      setRescheduleError("End time must be after start time.");
      return;
    }

    try {
      setIsRescheduling(true);
      setRescheduleError("");
      const result = await rescheduleEvent(rescheduleEventTarget.id, {
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        reason: rescheduleForm.reason.trim(),
      });

      const updated = mapEventToDashboardEvent(result.event ?? result);
      setEvents((prev) =>
        prev.map((item) => (item.id === updated.id ? updated : item)),
      );
      setIsRescheduleModalOpen(false);
      setRescheduleEventTarget(null);
    } catch (err: any) {
      setRescheduleError(
        err.response?.data?.error ||
          err.response?.data?.message ||
          "Failed to reschedule event.",
      );
    } finally {
      setIsRescheduling(false);
    }
  };

  const openCancelModal = (event: DashboardEvent) => {
    setCancelEventTarget(event);
    setCancelError("");
    setCancelReason("");
    setIsCancelModalOpen(true);
  };

  const handleCancelSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!cancelEventTarget) return;

    if (!cancelReason.trim()) {
      setCancelError("Please provide a cancellation reason.");
      return;
    }

    try {
      setIsCancelling(true);
      setCancelError("");
      const result = await cancelEvent(cancelEventTarget.id, {
        reason: cancelReason.trim(),
      });

      const updated = mapEventToDashboardEvent(result.event ?? result);
      setEvents((prev) =>
        prev.map((item) => (item.id === updated.id ? updated : item)),
      );
      setIsCancelModalOpen(false);
      setCancelEventTarget(null);
    } catch (err: any) {
      setCancelError(
        err.response?.data?.error ||
          err.response?.data?.message ||
          "Failed to cancel event.",
      );
    } finally {
      setIsCancelling(false);
    }
  };

  const renderEventCard = (event: DashboardEvent) => (
    <div
      key={event.id}
      role="button"
      tabIndex={0}
      onClick={() =>
        navigate(`/events/${event.id}`, {
          state: { event },
        })
      }
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          navigate(`/events/${event.id}`, { state: { event } });
        }
      }}
      className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 transition-all hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
    >
      <div className="flex justify-between items-start mb-2 gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base sm:text-lg font-bold text-gray-900 leading-tight">
              {event.title}
            </h3>
            {event.sessionType && (
              <span
                className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                  event.sessionType === "OVERNIGHT"
                    ? "bg-indigo-50 text-indigo-700 border-indigo-200"
                    : event.sessionType === "EVENING"
                      ? "bg-blue-50 text-blue-700 border-blue-200"
                      : "bg-gray-50 text-gray-600 border-gray-200"
                }`}
              >
                {event.sessionType === "OVERNIGHT"
                  ? "🌙 Overnight"
                  : event.sessionType === "EVENING"
                    ? "🌆 Evening"
                    : "📅 Other"}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span
            className={`px-2.5 py-1 text-xs font-bold rounded-full border whitespace-nowrap ${getStatusColor(
              event.status,
            )}`}
          >
            {event.status}
          </span>
        </div>
      </div>

      {/* Rescheduled / Cancelled badges */}
      {event.rescheduledAt && (
        <div className="mb-2 inline-flex items-center gap-1.5 bg-amber-50 text-amber-800 border border-amber-200 px-2.5 py-1 rounded-lg text-xs">
          <span>⚠️ Rescheduled:</span>
          <span className="font-medium">{event.rescheduleReason || "Slot updated"}</span>
          {event.plannedStartTime && (
            <span className="text-amber-600">
              (Originally: {formatDate(event.plannedStartTime)})
            </span>
          )}
        </div>
      )}

      {event.cancelledAt && (
        <div className="mb-2 inline-flex items-center gap-1.5 bg-red-50 text-red-800 border border-red-200 px-2.5 py-1 rounded-lg text-xs">
          <span>❌ Cancelled:</span>
          <span className="font-medium">{event.cancelReason || "Session cancelled"}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200">
          {event.eventType.replace("_", " ")}
        </span>
        {(event.status === "PAST" || event.status === "ACTIVE") && (
          <span className="text-xs font-medium px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 flex items-center border border-purple-100">
            <svg
              className="w-3.5 h-3.5 mr-1"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z" />
            </svg>
            {event.attendanceCount} attended
          </span>
        )}
      </div>

      <div className="space-y-1.5 text-sm text-gray-600 mb-3 bg-gray-50 p-3 rounded-lg border border-gray-100">
        <div className="flex items-center">
          <svg
            className="w-4 h-4 mr-2 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          {formatDate(event.startTime)}
        </div>
        <div className="flex items-center">
          <svg
            className="w-4 h-4 mr-2 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          {formatTime(event.startTime)} - {formatTime(event.endTime)}
        </div>
        {event.location && (
          <div className="flex items-center">
            <svg
              className="w-4 h-4 mr-2 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M12 2C8.686 2 6 4.686 6 8c0 5.25 6 12 6 12s6-6.75 6-12c0-3.314-2.686-6-6-6zm0 8a2 2 0 110-4 2 2 0 010 4z"
              />
            </svg>
            <span className="truncate font-medium text-gray-800">
              {event.location}
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 pt-1 border-t border-gray-100">
        <button
          disabled={!event.attendanceOpen && event.status !== "PAST"}
          onClick={(e) => {
            e.stopPropagation();
            if (event.attendanceOpen) {
              navigate(`/events/${event.id}/attendance`);
            } else {
              navigate(`/events/${event.id}`, { state: { event } });
            }
          }}
          className={`flex-1 py-2 px-3 rounded-lg font-semibold text-xs sm:text-sm transition-colors duration-200 ${
            event.attendanceOpen
              ? "bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
              : event.status === "PAST"
                ? "bg-gray-100 hover:bg-gray-200 text-gray-800"
                : "bg-gray-100 text-gray-400 cursor-not-allowed"
          }`}
        >
          {event.attendanceOpen
            ? "Take Attendance"
            : event.status === "PAST"
              ? "View Attendance"
              : "Attendance Unavailable"}
        </button>

        {isSuperAdmin && event.status !== "CANCELLED" && (
          <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => openRescheduleModal(event)}
              className="px-2.5 py-2 text-xs font-semibold rounded-lg bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors"
              title="Reschedule event"
            >
              🔄 Reschedule
            </button>
            <button
              type="button"
              onClick={() => openCancelModal(event)}
              className="px-2.5 py-2 text-xs font-semibold rounded-lg bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 transition-colors"
              title="Cancel event"
            >
              ❌ Cancel
            </button>
            {new Date(event.startTime).getTime() > Date.now() && (
              <button
                type="button"
                onClick={() => openEditModal(event)}
                className="px-2.5 py-2 text-xs font-semibold rounded-lg bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors"
                title="Edit event"
              >
                ✏️ Edit
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 pb-24 relative">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 fixed top-0 w-full z-30">
        <div className="px-4 pt-6 max-w-4xl mx-auto w-full">
          <div className="flex justify-between items-center mb-4">
            <h1 className="text-2xl font-bold text-gray-900">Events & Sessions</h1>
            <div className="flex items-center gap-2">
              <div className="flex items-center">
                <div className="relative flex items-center">
                  <div
                    className={`flex items-center transition-all duration-300 ease-in-out overflow-hidden rounded-md ${
                      isSearchExpanded || searchQuery ? "w-40 sm:w-48" : "w-10"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (!isSearchExpanded) {
                          setIsSearchExpanded(true);
                          setTimeout(() => searchInputRef.current?.focus(), 80);
                        } else {
                          searchInputRef.current?.focus();
                        }
                      }}
                      className="flex-shrink-0 p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md bg-white/0"
                      aria-label="Open search"
                    >
                      <svg
                        className="w-5 h-5"
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
                    </button>

                    <input
                      ref={searchInputRef}
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onBlur={() => {
                        if (!searchQuery) setIsSearchExpanded(false);
                      }}
                      placeholder="Search events..."
                      className={`ml-2 w-full border border-transparent text-sm bg-transparent focus:outline-none focus:ring-0 transition-opacity duration-200 ${
                        isSearchExpanded || searchQuery
                          ? "opacity-100 px-2 py-1.5"
                          : "opacity-0 pointer-events-none p-0"
                      }`}
                    />
                  </div>
                </div>
              </div>
              <button
                onClick={async () => {
                  await logout();
                  navigate("/login", { replace: true });
                }}
                className="text-sm font-medium text-red-600 bg-red-50 px-3 py-1.5 rounded-md flex-shrink-0"
              >
                Logout
              </button>
            </div>
          </div>

          {/* Tab Navigation */}
          <nav className="flex space-x-4">
            <button
              onClick={() => navigate("/events")}
              className={`pb-2 px-1 text-sm font-medium border-b-2 transition-colors ${
                location.pathname === "/events"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              Events
            </button>
            <button
              onClick={() => navigate("/studies")}
              className={`pb-2 px-1 text-sm font-medium border-b-2 transition-colors ${
                location.pathname === "/studies"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              Studies
            </button>
            <button
              onClick={() => navigate("/members")}
              className={`pb-2 px-1 text-sm font-medium border-b-2 transition-colors ${
                location.pathname === "/members"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              Members
            </button>
            <button
              onClick={() => navigate("/dashboard")}
              className={`pb-2 px-1 text-sm font-medium border-b-2 transition-colors ${
                location.pathname === "/dashboard"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              Dashboard
            </button>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto w-full px-4 pt-32 sm:pt-40 pb-6 space-y-4">
        {/* Filters Wrapper */}
        <div className="flex flex-col relative w-full mb-4">
          {/* Mobile view filters */}
          <div className="md:hidden">
            <div className="flex overflow-x-auto no-scrollbar gap-2 mb-3 pb-1">
              <button
                className={`whitespace-nowrap px-4 py-1.5 rounded-full text-sm font-medium transition-colors border ${
                  statusFilter.length === 0
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                }`}
                onClick={() => setStatusFilter([])}
              >
                All Status
              </button>
              {STATUS_OPTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => toggleStatus(s)}
                  className={`whitespace-nowrap px-4 py-1.5 rounded-full text-sm font-medium transition-colors border ${
                    statusFilter.includes(s)
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {formatStatusLabel(s)}
                </button>
              ))}
            </div>

            <div className="flex overflow-x-auto no-scrollbar gap-2 mb-3 pb-1">
              {(["ALL", "EVENING", "OVERNIGHT", "OTHER"] as SessionTypeFilter[]).map((st) => (
                <button
                  key={st}
                  onClick={() => setSessionTypeFilter(st)}
                  className={`whitespace-nowrap px-4 py-1.5 rounded-full text-sm font-medium transition-colors border ${
                    sessionTypeFilter === st
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {st === "ALL" ? "All Times" : st === "OVERNIGHT" ? "🌙 Overnight" : st === "EVENING" ? "🌆 Evening" : "Other"}
                </button>
              ))}
            </div>
          </div>

          {/* Desktop view filters (dropdowns) */}
          <div className="hidden md:flex flex-wrap items-center gap-3 mb-4">
            {/* Status Dropdown */}
            <div className="relative" ref={statusDropdownRef}>
              <button
                onClick={() => setIsStatusDropdownOpen(!isStatusDropdownOpen)}
                className="flex items-center justify-between min-w-[140px] px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <span>
                  {statusFilter.length === 0
                    ? "All Status"
                    : statusFilter.map((s) => formatStatusLabel(s)).join(", ")}
                </span>
                <svg
                  className="w-4 h-4 text-gray-500 ml-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>

              {isStatusDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-50 overflow-hidden py-1">
                  <div className="px-2 py-1">
                    <button
                      onClick={() => setStatusFilter([])}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      All Status
                    </button>
                  </div>
                  <div className="border-t">
                    {STATUS_OPTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => toggleStatus(s)}
                        className={`w-full text-left px-4 py-2 text-sm ${
                          statusFilter.includes(s)
                            ? "bg-blue-50 text-blue-700 font-semibold"
                            : "text-gray-700 hover:bg-gray-50"
                        }`}
                      >
                        {formatStatusLabel(s)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Session Type Dropdown */}
            <div className="relative" ref={sessionTypeDropdownRef}>
              <button
                onClick={() => setIsSessionTypeDropdownOpen(!isSessionTypeDropdownOpen)}
                className="flex items-center justify-between min-w-[140px] px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <span>
                  {sessionTypeFilter === "ALL"
                    ? "All Sessions"
                    : sessionTypeFilter === "OVERNIGHT"
                      ? "🌙 Overnight"
                      : sessionTypeFilter === "EVENING"
                        ? "🌆 Evening"
                        : "Other"}
                </span>
                <svg
                  className="w-4 h-4 text-gray-500 ml-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>

              {isSessionTypeDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-50 overflow-hidden py-1">
                  {(["ALL", "EVENING", "OVERNIGHT", "OTHER"] as SessionTypeFilter[]).map((st) => (
                    <button
                      key={st}
                      onClick={() => {
                        setSessionTypeFilter(st);
                        setIsSessionTypeDropdownOpen(false);
                      }}
                      className={`w-full text-left px-4 py-2 text-sm ${
                        sessionTypeFilter === st
                          ? "bg-gray-100 text-gray-900 font-semibold"
                          : "text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      {st === "ALL"
                        ? "All Session Types"
                        : st === "OVERNIGHT"
                          ? "🌙 Overnight"
                          : st === "EVENING"
                            ? "🌆 Evening"
                            : "Other"}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Study Dropdown Filter */}
            <div className="relative" ref={studyDropdownRef}>
              <button
                onClick={() => setIsStudyDropdownOpen(!isStudyDropdownOpen)}
                className="flex items-center justify-between min-w-[150px] px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <span className="truncate max-w-[150px]">
                  {studyFilter === "ALL"
                    ? "All Studies"
                    : studyFilter === "STANDALONE"
                      ? "Standalone Only"
                      : studies.find((s) => s.id === studyFilter)?.name || "Study Filter"}
                </span>
                <svg
                  className="w-4 h-4 text-gray-500 ml-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>

              {isStudyDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-50 overflow-hidden py-1 max-h-60 overflow-y-auto">
                  <button
                    onClick={() => {
                      setStudyFilter("ALL");
                      setIsStudyDropdownOpen(false);
                    }}
                    className={`w-full text-left px-4 py-2 text-sm ${
                      studyFilter === "ALL" ? "bg-gray-100 font-semibold text-gray-900" : "text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    All Studies & Standalone
                  </button>
                  <button
                    onClick={() => {
                      setStudyFilter("STANDALONE");
                      setIsStudyDropdownOpen(false);
                    }}
                    className={`w-full text-left px-4 py-2 text-sm ${
                      studyFilter === "STANDALONE" ? "bg-gray-100 font-semibold text-gray-900" : "text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    Standalone Events Only
                  </button>
                  <div className="border-t border-gray-100 my-1" />
                  {studies.map((st) => (
                    <button
                      key={st.id}
                      onClick={() => {
                        setStudyFilter(st.id);
                        setIsStudyDropdownOpen(false);
                      }}
                      className={`w-full text-left px-4 py-2 text-sm truncate ${
                        studyFilter === st.id ? "bg-blue-50 text-blue-700 font-semibold" : "text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      {st.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Clear button if any filter active */}
            {(statusFilter.length > 0 || sessionTypeFilter !== "ALL" || studyFilter !== "ALL" || debouncedSearchQuery) && (
              <button
                onClick={() => {
                  setStatusFilter([]);
                  setTypeFilter("ALL");
                  setSessionTypeFilter("ALL");
                  setStudyFilter("ALL");
                  setSearchQuery("");
                }}
                className="text-xs text-blue-600 hover:underline px-2 py-1"
              >
                Clear all filters
              </button>
            )}
          </div>

          {/* Sort By Toggle & Info */}
          <div className="flex justify-between items-center mt-2 border-t md:border-none pt-3 md:pt-0">
            <span className="text-sm text-gray-500 font-medium">
              {sortedEvents.length} of {totalEvents || events.length} events found
            </span>
            <div className="relative" ref={sortDropdownRef}>
              <button
                onClick={() => setIsSortModalOpen(!isSortModalOpen)}
                className="flex items-center text-sm font-medium text-gray-700 bg-gray-100 px-3 py-2 md:py-1.5 rounded-lg border border-gray-200 hover:bg-gray-200 transition-colors"
              >
                <svg
                  className="w-4 h-4 mr-1.5 text-gray-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12"
                  />
                </svg>
                <span className="hidden md:inline mr-1">Sort by:</span>
                <span className="md:font-semibold">{getSortLabel(sortBy)}</span>
              </button>

              {isSortModalOpen && (
                <div className="absolute top-full right-0 mt-2 w-56 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden py-1 animate-in fade-in">
                  <ul>
                    {[
                      { value: "NEXT_EVENT", label: "Next Event" },
                      { value: "RECENTLY_CREATED", label: "Recently Created" },
                      {
                        value: "HIGHEST_ATTENDANCE",
                        label: "Highest Attendance",
                      },
                      {
                        value: "LOWEST_ATTENDANCE",
                        label: "Lowest Attendance",
                      },
                    ].map((opt) => (
                      <li key={opt.value}>
                        <button
                          className={`w-full flex items-center justify-between px-4 py-2.5 text-left text-sm transition-colors ${
                            sortBy === opt.value
                              ? "bg-blue-50 text-blue-700 font-medium"
                              : "text-gray-700 hover:bg-gray-50 hover:text-gray-900"
                          }`}
                          onClick={() => {
                            setSortBy(opt.value as SortOption);
                            setIsSortModalOpen(false);
                          }}
                        >
                          {opt.label}
                          {sortBy === opt.value && (
                            <svg
                              className="w-4 h-4 text-blue-600"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth="2"
                                d="M5 13l4 4L19 7"
                              />
                            </svg>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* List of Events Grouped by Study */}
        {loading ? (
          <div className="flex flex-col items-center py-12">
            <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="mt-4 text-gray-500 text-sm font-medium">
              Loading sessions...
            </p>
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm text-center">
            {error}
          </div>
        ) : sortedEvents.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-xl shadow-sm border border-gray-100">
            <p className="text-gray-500 text-sm">
              No sessions match your selected filters.
            </p>
            <button
              onClick={() => {
                setStatusFilter([]);
                setTypeFilter("ALL");
                setSessionTypeFilter("ALL");
                setStudyFilter("ALL");
              }}
              className="mt-3 text-blue-600 text-sm font-medium hover:underline"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Study Sections */}
            {groupedSections.studies.map((group) => {
              const isCollapsed = collapsedGroups.has(group.study.id);
              return (
                <section
                  key={group.study.id}
                  className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden"
                >
                  {/* Study Header */}
                  <div
                    onClick={() => toggleGroupCollapse(group.study.id)}
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-gradient-to-r from-blue-50/50 via-white to-gray-50/50 border-b border-gray-100 cursor-pointer select-none gap-2 hover:bg-gray-50/80 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-sm">
                        📖
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h2 className="text-base sm:text-lg font-bold text-gray-900">
                            {group.study.name}
                          </h2>
                          {"audienceType" in group.study && (
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
                              {group.study.audienceType === "FINAL_YEAR"
                                ? "🎓 Final Year"
                                : group.study.audienceType === "BATCHES"
                                  ? "🏷️ Batches"
                                  : "👥 Everyone"}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {group.events.length} session{group.events.length === 1 ? "" : "s"} in this view
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 self-end sm:self-auto">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/studies`);
                        }}
                        className="text-xs font-semibold text-blue-600 hover:text-blue-800 hover:underline"
                      >
                        Study Dashboard →
                      </button>
                      <span className="text-gray-400 text-sm">
                        {isCollapsed ? "▼ Show" : "▲ Hide"}
                      </span>
                    </div>
                  </div>

                  {/* Study Events */}
                  {!isCollapsed && (
                    <div className="p-4 space-y-4 bg-gray-50/30">
                      {group.events.map(renderEventCard)}
                    </div>
                  )}
                </section>
              );
            })}

            {/* Standalone Events Section */}
            {groupedSections.standalone.length > 0 && (
              <section className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                <div
                  onClick={() => toggleGroupCollapse("STANDALONE")}
                  className="flex items-center justify-between p-4 bg-gray-50 border-b border-gray-100 cursor-pointer select-none hover:bg-gray-100/60 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-lg bg-gray-200 text-gray-700 flex items-center justify-center font-bold text-sm">
                      📌
                    </div>
                    <div>
                      <h2 className="text-base sm:text-lg font-bold text-gray-900">
                        Standalone Events
                      </h2>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {groupedSections.standalone.length} session{groupedSections.standalone.length === 1 ? "" : "s"} not tied to a study
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 text-sm">
                      {collapsedGroups.has("STANDALONE") ? "▼ Show" : "▲ Hide"}
                    </span>
                  </div>
                </div>

                {!collapsedGroups.has("STANDALONE") && (
                  <div className="p-4 space-y-4 bg-gray-50/30">
                    {groupedSections.standalone.map(renderEventCard)}
                  </div>
                )}
              </section>
            )}
          </div>
        )}
      </div>

      {/* Floating Action Button */}
      <button
        onClick={() => navigate("/events/create")}
        className="fixed bottom-6 right-4 md:bottom-8 md:right-8 bg-blue-600 shadow-lg hover:bg-blue-700 text-white rounded-full h-14 px-5 flex items-center justify-center z-10 font-medium active:scale-95 transition-all"
      >
        <svg
          className="w-5 h-5 mr-1.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M12 4v16m8-8H4"
          />
        </svg>
        Create Event
      </button>

      {/* Reschedule Modal */}
      {isRescheduleModalOpen && rescheduleEventTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 px-4 py-6">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Reschedule Session</h2>
                <p className="mt-1 text-sm text-gray-500">
                  Move <strong>{rescheduleEventTarget.title}</strong> to a new time slot. Series linkage and planned start time are preserved.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsRescheduleModalOpen(false);
                  setRescheduleEventTarget(null);
                }}
                className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            <form className="mt-6 space-y-4" onSubmit={handleRescheduleSubmit}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    New Start Time <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="datetime-local"
                    value={rescheduleForm.startTime}
                    onChange={(e) =>
                      setRescheduleForm((prev) => ({ ...prev, startTime: e.target.value }))
                    }
                    className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    New End Time <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="datetime-local"
                    value={rescheduleForm.endTime}
                    onChange={(e) =>
                      setRescheduleForm((prev) => ({ ...prev, endTime: e.target.value }))
                    }
                    className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Reason for Rescheduling <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={rescheduleForm.reason}
                  onChange={(e) =>
                    setRescheduleForm((prev) => ({ ...prev, reason: e.target.value }))
                  }
                  rows={3}
                  placeholder="e.g. Venue occupied on Tuesday, shifted to Wednesday"
                  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  required
                />
              </div>

              {rescheduleError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {rescheduleError}
                </div>
              )}

              <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setIsRescheduleModalOpen(false);
                    setRescheduleEventTarget(null);
                  }}
                  className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isRescheduling}
                  className="rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-amber-700 disabled:opacity-60"
                >
                  {isRescheduling ? "Rescheduling..." : "Confirm Reschedule"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Cancel Modal */}
      {isCancelModalOpen && cancelEventTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 px-4 py-6">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Cancel Session</h2>
                <p className="mt-1 text-sm text-gray-500">
                  Mark <strong>{cancelEventTarget.title}</strong> as cancelled. Cancelled events are excluded from all rate statistics.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsCancelModalOpen(false);
                  setCancelEventTarget(null);
                }}
                className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            <form className="mt-6 space-y-4" onSubmit={handleCancelSubmit}>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Cancellation Reason <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  rows={3}
                  placeholder="e.g. University holiday or campus emergency closure"
                  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  required
                />
              </div>

              {cancelError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {cancelError}
                </div>
              )}

              <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setIsCancelModalOpen(false);
                    setCancelEventTarget(null);
                  }}
                  className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Keep Event
                </button>
                <button
                  type="submit"
                  disabled={isCancelling}
                  className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-red-700 disabled:opacity-60"
                >
                  {isCancelling ? "Cancelling..." : "Confirm Cancellation"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {isEditModalOpen && selectedEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 px-4 py-6">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Edit Event</h2>
                <p className="mt-1 text-sm text-gray-500">
                  Update event details while it is still upcoming.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsEditModalOpen(false);
                  setSelectedEvent(null);
                  setEditError("");
                }}
                className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            <form className="mt-6 space-y-4" onSubmit={handleEditSubmit}>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Title
                </label>
                <input
                  type="text"
                  value={editForm.title}
                  onChange={(e) =>
                    setEditForm((prev) => ({ ...prev, title: e.target.value }))
                  }
                  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  required
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Description
                </label>
                <textarea
                  value={editForm.description}
                  onChange={(e) =>
                    setEditForm((prev) => ({
                      ...prev,
                      description: e.target.value,
                    }))
                  }
                  rows={4}
                  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Start time
                  </label>
                  <input
                    type="datetime-local"
                    value={editForm.startTime}
                    onChange={(e) =>
                      setEditForm((prev) => ({
                        ...prev,
                        startTime: e.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    End time
                  </label>
                  <input
                    type="datetime-local"
                    value={editForm.endTime}
                    onChange={(e) =>
                      setEditForm((prev) => ({
                        ...prev,
                        endTime: e.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    required
                  />
                </div>
              </div>

              {editError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {editError}
                </div>
              )}

              <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setIsEditModalOpen(false);
                    setSelectedEvent(null);
                    setEditError("");
                  }}
                  className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingEdit}
                  className={`rounded-xl px-4 py-2.5 text-sm font-semibold text-white ${
                    isSavingEdit
                      ? "bg-blue-300"
                      : "bg-blue-600 hover:bg-blue-700"
                  }`}
                >
                  {isSavingEdit ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Global override for hiding scrollbar visually in pill filters */}
      <style>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
};

export default EventsPage;
