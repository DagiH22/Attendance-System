import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import api, {
  getMembersCount,
  rescheduleEvent,
  cancelEvent,
  getEventAbsentees,
  excuseMember,
  undoAttendance,
  updateAttendanceStatus,
} from "../lib/api";
import formatDate, { formatDateTime } from "../lib/formatDate";
import type {
  AttendanceSortBy,
  AttendanceSortOrder,
  AttendanceStatus,
  DashboardEvent,
  EventAbsentee,
  EventAttendanceRecord,
  EventAttendanceResponse,
  SessionType,
} from "../types/events";
import { useAuth } from "../contexts/AuthContext";
import CopyPhoneButton from "../components/shared/CopyPhoneButton";
import CopyAllPhonesDropdown from "../components/shared/CopyAllPhonesDropdown";
import { usePersistedViewState } from "../hooks/usePersistedViewState";
import { RotateCcw } from "lucide-react";

type LocationState = {
  event?: DashboardEvent;
};

const ATTENDANCE_PAGE_SIZE = 20;

const attendanceCache = new Map<string, EventAttendanceResponse>();

const sanitizeDownloadFileName = (value: string) =>
  value
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ") || "event";

const getFileNameFromContentDisposition = (
  header?: string,
  fallback?: string,
) => {
  const fileNameMatch = header?.match(
    /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i,
  );
  const encoded = fileNameMatch?.[1];
  const plain = fileNameMatch?.[2];
  const extracted = encoded ? decodeURIComponent(encoded) : plain;
  return extracted || fallback;
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
    description: rawEvent.description || "No description provided.",
    startTime: rawEvent.startTime ?? eventStart.toISOString(),
    endTime: rawEvent.endTime ?? eventEnd.toISOString(),
    status,
    attendanceOpen,
    location: rawEvent.location || "",
    eventType: rawEvent.type,
    sessionType: (rawEvent.sessionType as SessionType) || "EVENING",
    studyId: rawEvent.studyId || null,
    study: rawEvent.study || null,
    plannedStartTime: rawEvent.plannedStartTime || null,
    rescheduledAt: rawEvent.rescheduledAt || null,
    rescheduleReason: rawEvent.rescheduleReason || null,
    cancelledAt: rawEvent.cancelledAt || null,
    cancelReason: rawEvent.cancelReason || null,
    lateGraceMinutes: rawEvent.lateGraceMinutes ?? null,
    createdAt: rawEvent.createdAt || eventStart.toISOString(),
    createdBy: {
      id: rawEvent.admin?.id || rawEvent.createdBy?.id || "unknown-admin",
      name: rawEvent.admin?.name || rawEvent.createdBy?.name || "Admin User",
    },
    attendanceCount:
      rawEvent._count?.attendances || rawEvent.attendanceCount || 0,
    totalMembers: rawEvent.totalMembers || 0,
    stats: rawEvent.stats || undefined,
    absentees: rawEvent.absentees || undefined,
    cluster: rawEvent.cluster
      ? {
          id: rawEvent.cluster.id,
          title: rawEvent.cluster.title,
          startDate: rawEvent.cluster.startDate,
          endDate: rawEvent.cluster.endDate,
        }
      : null,
    clusterLabel: rawEvent.clusterLabel ?? null,
  };
};

const toDateTimeLocalValue = (value: string) => {
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60_000);
  return localDate.toISOString().slice(0, 16);
};

const EventDetailsPage: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const state = location.state as LocationState | null;
  const { admin } = useAuth();

  const [event, setEvent] = useState<DashboardEvent | null>(
    state?.event ?? null,
  );
  const [loading, setLoading] = useState<boolean>(!state?.event);
  const [error, setError] = useState<string>("");
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");

  // Reschedule Modal
  const [isRescheduleModalOpen, setIsRescheduleModalOpen] = useState(false);
  const [rescheduleForm, setRescheduleForm] = useState({
    startTime: "",
    endTime: "",
    reason: "",
  });
  const [isRescheduling, setIsRescheduling] = useState(false);
  const [rescheduleError, setRescheduleError] = useState("");

  // Cancel Modal
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState("");

  // Attendance Modal & Tabs (Item 4: Persisted View State)
  const [isAttendanceModalOpen, setIsAttendanceModalOpen] = useState(false);
  const {
    viewState: modalViewState,
    setField: setModalField,
    resetFilters: resetModalFilters,
  } = usePersistedViewState("session_details", {
    defaults: {
      tab: "ATTENDEES" as "ATTENDEES" | "ABSENTEES",
      page: 1,
      sortBy: "time" as AttendanceSortBy,
      order: "asc" as AttendanceSortOrder,
      showAllEligible: false,
      search: "",
    },
  });

  const attendanceModalTab = modalViewState.tab;
  const setAttendanceModalTab = (tab: "ATTENDEES" | "ABSENTEES") => setModalField("tab", tab);

  const attendancePage = modalViewState.page;
  const setAttendancePage = (p: number) => setModalField("page", p);

  const attendanceSortBy = modalViewState.sortBy;
  const setAttendanceSortBy = (s: AttendanceSortBy) => setModalField("sortBy", s);

  const attendanceOrder = modalViewState.order;
  const setAttendanceOrder = (o: AttendanceSortOrder) => setModalField("order", o);

  const showAllEligibleAbsentees = modalViewState.showAllEligible;
  const setShowAllEligibleAbsentees = (val: boolean) => setModalField("showAllEligible", val);

  const absenteesSearch = modalViewState.search;
  const setAbsenteesSearch = (s: string) => setModalField("search", s);

  const [attendanceRecords, setAttendanceRecords] = useState<
    EventAttendanceRecord[]
  >([]);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [attendanceError, setAttendanceError] = useState("");
  const [attendanceTotalPages, setAttendanceTotalPages] = useState(1);
  const [attendanceTotalCount, setAttendanceTotalCount] = useState(0);
  const [attendanceExporting, setAttendanceExporting] = useState(false);
  const [membersCount, setMembersCount] = useState<number | null>(null);

  // Absentees Tab State
  const [absenteesList, setAbsenteesList] = useState<EventAbsentee[]>([]);
  const [absenteesLoading, setAbsenteesLoading] = useState(false);
  const [absenteesError, setAbsenteesError] = useState("");

  // Excuse Modal
  const [isExcuseModalOpen, setIsExcuseModalOpen] = useState(false);
  const [excuseTarget, setExcuseTarget] = useState<{
    memberId: string;
    memberName: string;
  } | null>(null);
  const [excuseReasonInput, setExcuseReasonInput] = useState("");
  const [isExcusing, setIsExcusing] = useState(false);
  const [excuseError, setExcuseError] = useState("");

  // Undo Modal
  const [isUndoModalOpen, setIsUndoModalOpen] = useState(false);
  const [undoTarget, setUndoTarget] = useState<EventAttendanceRecord | null>(null);
  const [undoReasonInput, setUndoReasonInput] = useState("");
  const [isUndoing, setIsUndoing] = useState(false);
  const [undoError, setUndoError] = useState("");

  // Edit Event Form
  const [editForm, setEditForm] = useState({
    title: "",
    description: "",
    location: "",
    status: "UPCOMING" as DashboardEvent["status"],
    startTime: "",
    endTime: "",
  });

  const syncEditForm = (nextEvent: DashboardEvent) => {
    setEditForm({
      title: nextEvent.title,
      description: nextEvent.description || "",
      location: nextEvent.location || "",
      status: nextEvent.status === "DEACTIVATED" ? "DEACTIVATED" : "UPCOMING",
      startTime: toDateTimeLocalValue(nextEvent.startTime),
      endTime: toDateTimeLocalValue(nextEvent.endTime),
    });
  };

  const getAttendanceCacheKey = (
    eventId: string,
    page: number,
    sortBy: AttendanceSortBy,
    order: AttendanceSortOrder,
  ) => `${eventId}:${page}:${sortBy}:${order}`;

  const fetchAttendancePage = React.useCallback(
    async (
      page: number,
      options?: { preferCache?: boolean; silent?: boolean },
    ) => {
      if (!event) return;

      const { preferCache = true, silent = false } = options ?? {};
      const cacheKey = getAttendanceCacheKey(
        event.id,
        page,
        attendanceSortBy,
        attendanceOrder,
      );

      if (preferCache && attendanceCache.has(cacheKey)) {
        const cached = attendanceCache.get(cacheKey)!;
        setAttendanceRecords(cached.data);
        setAttendanceTotalPages(cached.totalPages);
        setAttendanceTotalCount(cached.totalCount);
        setAttendancePage(cached.currentPage);
        return cached;
      }

      if (!silent) {
        setAttendanceLoading(true);
      }

      try {
        const response = await api.get<EventAttendanceResponse>(
          `/events/${event.id}/attendance`,
          {
            params: {
              page,
              limit: ATTENDANCE_PAGE_SIZE,
              sortBy: attendanceSortBy,
              order: attendanceOrder,
            },
          },
        );

        const payload = response.data;
        attendanceCache.set(cacheKey, payload);

        if (!silent) {
          setAttendanceRecords(payload.data);
          setAttendanceTotalPages(payload.totalPages);
          setAttendanceTotalCount(payload.totalCount);
          setAttendancePage(payload.currentPage);
          setAttendanceError("");
        }

        return payload;
      } catch (err: any) {
        if (!silent) {
          setAttendanceError(
            err.response?.data?.error ||
              err.response?.data?.message ||
              "Failed to load attendance records.",
          );
        }
        throw err;
      } finally {
        if (!silent) {
          setAttendanceLoading(false);
        }
      }
    },
    [attendanceOrder, attendanceSortBy, event],
  );

  const fetchEvent = async () => {
    if (!id) return;
    try {
      setLoading(true);
      setError("");

      const response = await api.get(`/events/${id}`, {
        params: { includeStats: "true", includeAbsentees: "true" },
      });
      const rawEvent = response.data?.event ?? response.data;

      if (!rawEvent) {
        throw new Error("Event not found");
      }

      const mapped = mapEventToDashboardEvent(rawEvent);
      setEvent(mapped);

      if (mapped.absentees) {
        setAbsenteesList(mapped.absentees);
      }

      if (!mapped.totalMembers) {
        try {
          const count = await getMembersCount();
          setMembersCount(count);
        } catch {
          setMembersCount(0);
        }
      }
    } catch (err: any) {
      console.error("Error loading event details:", err);
      setError(
        err.response?.data?.message ||
          err.response?.data?.error ||
          err.message ||
          "Failed to load event details.",
      );
    } finally {
      setLoading(false);
    }
  };

  const fetchAbsentees = async (showAll = showAllEligibleAbsentees) => {
    if (!event) return;
    setAbsenteesLoading(true);
    setAbsenteesError("");
    try {
      const data = await getEventAbsentees(event.id, showAll);
      setAbsenteesList(
        showAll
          ? (data.allEligibleAbsentees || data.absentees || [])
          : (data.participantAbsentees || data.absentees || []),
      );
    } catch (err: any) {
      setAbsenteesError(
        err.response?.data?.error || "Failed to load absentees list.",
      );
    } finally {
      setAbsenteesLoading(false);
    }
  };

  useEffect(() => {
    void fetchEvent();
    const intervalId = window.setInterval(() => {
      void fetchEvent();
    }, 60_000);

    return () => window.clearInterval(intervalId);
  }, [id]);

  useEffect(() => {
    if (state?.event) {
      setEvent(state.event);
    }
  }, [state?.event]);

  useEffect(() => {
    if (event) {
      syncEditForm(event);
    }
  }, [event]);

  useEffect(() => {
    if (!isAttendanceModalOpen) return;

    if (attendanceModalTab === "ATTENDEES") {
      void fetchAttendancePage(1, { preferCache: false });
    } else if (attendanceModalTab === "ABSENTEES") {
      void fetchAbsentees();
    }
  }, [attendanceModalTab, fetchAttendancePage, isAttendanceModalOpen]);

  const attendanceStats = useMemo(() => {
    if (event?.stats) {
      const headlineRate =
        event.stats.turnoutAmongParticipants !== null &&
        event.stats.turnoutAmongParticipants !== undefined
          ? Math.round(event.stats.turnoutAmongParticipants * 100)
          : event.stats.attendanceRate !== null &&
            event.stats.attendanceRate !== undefined
            ? Math.round(event.stats.attendanceRate * 100)
            : 0;

      const eligibleRate =
        event.stats.eligibleAttendanceRate !== null &&
        event.stats.eligibleAttendanceRate !== undefined
          ? Math.round(event.stats.eligibleAttendanceRate * 100)
          : null;

      return {
        totalMembers: event.stats.eligible,
        participants: event.stats.participants,
        attendees: event.stats.present + event.stats.late,
        present: event.stats.present,
        late: event.stats.late,
        excused: event.stats.excused,
        absentees: event.stats.absentAmongParticipants ?? event.stats.absent,
        attendancePercentage: headlineRate,
        eligiblePercentage: eligibleRate,
        isCancelled: event.stats.isCancelled,
      };
    }

    const totalMembers =
      event?.totalMembers && event.totalMembers > 0
        ? event.totalMembers
        : (membersCount ?? 0);
    const attendees =
      attendanceTotalCount > 0
        ? attendanceTotalCount
        : (event?.attendanceCount ?? 0);
    const absentees = Math.max(totalMembers - attendees, 0);
    const attendancePercentage =
      totalMembers > 0 ? Math.round((attendees / totalMembers) * 100) : 0;

    return {
      totalMembers,
      participants: totalMembers,
      attendees,
      present: attendees,
      late: 0,
      excused: 0,
      absentees,
      attendancePercentage,
      eligiblePercentage: null,
      isCancelled: event?.status === "CANCELLED",
    };
  }, [event, attendanceTotalCount, membersCount]);

  const formatTime = (value: string) =>
    new Date(value).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

  const formatCreatedDate = (value: string) => formatDateTime(value);

  const getStatusClasses = (status: DashboardEvent["status"]) => {
    switch (status) {
      case "ACTIVE":
        return "bg-green-100 text-green-800 border-green-200";
      case "UPCOMING":
        return "bg-blue-100 text-blue-800 border-blue-200";
      case "DEACTIVATED":
        return "bg-yellow-50 text-yellow-800 border-yellow-100";
      case "CANCELLED":
        return "bg-red-100 text-red-800 border-red-200";
      case "PAST":
      default:
        return "bg-gray-100 text-gray-700 border-gray-200";
    }
  };

  const getActionLabel = (status: DashboardEvent["status"]) => {
    switch (status) {
      case "ACTIVE":
        return "Take Attendance";
      case "PAST":
        return "View Attendance & Absentees";
      case "CANCELLED":
        return "Session Cancelled";
      case "DEACTIVATED":
        return "Attendance Unavailable";
      default:
        return "Attendance Not Available Yet";
    }
  };

  const handleAction = () => {
    if (!event) return;

    if (event.status === "PAST" || event.status === "CANCELLED") {
      setAttendanceError("");
      setAttendancePage(1);
      setAttendanceTotalPages(1);
      setAttendanceTotalCount(0);
      setIsAttendanceModalOpen(true);
      return;
    }

    if (!event.attendanceOpen) return;

    navigate(`/events/${event.id}/attendance`, {
      state: { event },
    });
  };

  const handleAttendanceSortChange = async (
    nextSortBy: AttendanceSortBy,
    nextOrder: AttendanceSortOrder,
  ) => {
    setAttendanceSortBy(nextSortBy);
    setAttendanceOrder(nextOrder);
    setAttendancePage(1);

    if (!event) return;

    const cacheKey = getAttendanceCacheKey(event.id, 1, nextSortBy, nextOrder);
    const cached = attendanceCache.get(cacheKey);
    if (cached) {
      setAttendanceRecords(cached.data);
      setAttendanceTotalPages(cached.totalPages);
      setAttendanceTotalCount(cached.totalCount);
      setAttendancePage(cached.currentPage);
      setAttendanceError("");
      return;
    }

    setAttendanceLoading(true);
    try {
      const response = await api.get<EventAttendanceResponse>(
        `/events/${event.id}/attendance`,
        {
          params: {
            page: 1,
            limit: ATTENDANCE_PAGE_SIZE,
            sortBy: nextSortBy,
            order: nextOrder,
          },
        },
      );

      attendanceCache.set(cacheKey, response.data);
      setAttendanceRecords(response.data.data);
      setAttendanceTotalPages(response.data.totalPages);
      setAttendanceTotalCount(response.data.totalCount);
      setAttendancePage(response.data.currentPage);
      setAttendanceError("");
    } catch (err: any) {
      setAttendanceError(
        err.response?.data?.error || "Failed to load attendance records.",
      );
    } finally {
      setAttendanceLoading(false);
    }
  };

  const handleExportAttendanceExcel = async () => {
    if (!event) return;
    try {
      setAttendanceExporting(true);
      const response = await api.get(`/events/${event.id}/export/excel`, {
        responseType: "blob",
      });

      const headerFileName = getFileNameFromContentDisposition(
        response.headers["content-disposition"],
      );
      const fileName =
        headerFileName || `${sanitizeDownloadFileName(event.title)}-attendance.xlsx`;
      const blob = new Blob([response.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error("Export error:", err);
      setAttendanceError("Failed to export attendance records.");
    } finally {
      setAttendanceExporting(false);
    }
  };

  // Status update
  const handleChangeStatus = async (
    recordId: string,
    nextStatus: AttendanceStatus,
    excuseReason?: string,
  ) => {
    try {
      await updateAttendanceStatus(recordId, nextStatus, excuseReason);
      attendanceCache.clear();
      await fetchAttendancePage(attendancePage, { preferCache: false });
      await fetchEvent();
    } catch (err: any) {
      setAttendanceError(
        err.response?.data?.error || "Failed to update attendance status.",
      );
    }
  };

  // Undo attendance (Soft delete)
  const handleConfirmUndo = async () => {
    if (!undoTarget || !undoTarget.id) return;
    try {
      setIsUndoing(true);
      setUndoError("");
      await undoAttendance(undoTarget.id, undoReasonInput.trim());
      attendanceCache.clear();
      setIsUndoModalOpen(false);
      setUndoTarget(null);
      setUndoReasonInput("");
      await fetchAttendancePage(attendancePage, { preferCache: false });
      await fetchEvent();
    } catch (err: any) {
      setUndoError(
        err.response?.data?.error || "Failed to remove attendance record.",
      );
    } finally {
      setIsUndoing(false);
    }
  };

  // Excuse absentee
  const handleConfirmExcuse = async () => {
    if (!event || !excuseTarget) return;
    if (!excuseReasonInput.trim()) {
      setExcuseError("Please provide an excuse reason.");
      return;
    }

    try {
      setIsExcusing(true);
      setExcuseError("");
      await excuseMember({
        eventId: event.id,
        memberId: excuseTarget.memberId,
        reason: excuseReasonInput.trim(),
      });

      attendanceCache.clear();
      setIsExcuseModalOpen(false);
      setExcuseTarget(null);
      setExcuseReasonInput("");
      await fetchAbsentees();
      await fetchEvent();
    } catch (err: any) {
      setExcuseError(
        err.response?.data?.error || "Failed to record excuse.",
      );
    } finally {
      setIsExcusing(false);
    }
  };

  // Reschedule
  const openRescheduleModal = () => {
    if (!event) return;
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
    if (!event) return;

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
      const result = await rescheduleEvent(event.id, {
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        reason: rescheduleForm.reason.trim(),
      });

      setEvent(mapEventToDashboardEvent(result.event ?? result));
      setIsRescheduleModalOpen(false);
      setActionSuccess("Event successfully rescheduled!");
      setTimeout(() => setActionSuccess(""), 4000);
    } catch (err: any) {
      setRescheduleError(
        err.response?.data?.error || "Failed to reschedule event.",
      );
    } finally {
      setIsRescheduling(false);
    }
  };

  // Cancel
  const openCancelModal = () => {
    setCancelError("");
    setCancelReason("");
    setIsCancelModalOpen(true);
  };

  const handleCancelSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!event) return;

    if (!cancelReason.trim()) {
      setCancelError("Please provide a cancellation reason.");
      return;
    }

    try {
      setIsCancelling(true);
      setCancelError("");
      const result = await cancelEvent(event.id, {
        reason: cancelReason.trim(),
      });

      setEvent(mapEventToDashboardEvent(result.event ?? result));
      setIsCancelModalOpen(false);
      setActionSuccess("Event marked as cancelled.");
      setTimeout(() => setActionSuccess(""), 4000);
    } catch (err: any) {
      setCancelError(
        err.response?.data?.error || "Failed to cancel event.",
      );
    } finally {
      setIsCancelling(false);
    }
  };

  const handleEditSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!event) return;

    setActionError("");

    const nextErrors: {
      title?: string;
      description?: string;
      location?: string;
      startTime?: string;
      endTime?: string;
    } = {};

    if (!editForm.title.trim()) nextErrors.title = "Event title is required";
    if (!editForm.description.trim())
      nextErrors.description = "Event description is required";
    if (!editForm.location.trim())
      nextErrors.location = "Event location is required";
    if (!editForm.startTime) nextErrors.startTime = "Start time is required";
    if (!editForm.endTime) nextErrors.endTime = "End time is required";

    if (Object.keys(nextErrors).length > 0) {
      setActionError(Object.values(nextErrors)[0] || "Please fill in all required fields.");
      return;
    }

    const parsedStartTime = new Date(editForm.startTime);
    const parsedEndTime = new Date(editForm.endTime);

    if (parsedEndTime <= parsedStartTime) {
      setActionError("End time must be after start time.");
      return;
    }

    try {
      setIsSaving(true);
      const response = await api.patch(`/events/${event.id}`, {
        title: editForm.title.trim(),
        description: editForm.description.trim(),
        location: editForm.location.trim(),
        status: editForm.status === "DEACTIVATED" ? "DEACTIVATED" : "UPCOMING",
        startTime: parsedStartTime.toISOString(),
        endTime: parsedEndTime.toISOString(),
      });

      setEvent(
        mapEventToDashboardEvent(response.data?.event ?? response.data),
      );
      setIsEditModalOpen(false);
    } catch (err: any) {
      setActionError(
        err.response?.data?.error || "Failed to update event.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!event) return;
    try {
      setActionError("");
      setIsDeleting(true);
      await api.delete(`/events/${event.id}`);
      setShowDeleteConfirmModal(false);
      navigate("/events", {
        replace: true,
        state: { refreshEvents: true, deletedEventId: event.id },
      });
    } catch (err: any) {
      setActionError(
        err.response?.data?.error || "Failed to delete event.",
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const isSuperAdmin = admin?.role === "SUPER_ADMIN";
  const isAdmin = admin?.role === "ADMIN" || isSuperAdmin;
  const canEdit = isSuperAdmin && event && new Date(event.startTime).getTime() > Date.now();
  const canDelete = isSuperAdmin && event?.status !== "ACTIVE";

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 px-4 py-6">
        <div className="max-w-3xl mx-auto flex min-h-[60vh] flex-col items-center justify-center">
          <div className="h-10 w-10 rounded-full border-4 border-blue-500 border-t-transparent animate-spin" />
          <p className="mt-4 text-sm font-medium text-gray-500">
            Loading session details...
          </p>
        </div>
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="min-h-screen bg-gray-50 px-4 py-6">
        <div className="max-w-3xl mx-auto">
          <button
            type="button"
            onClick={() => navigate("/events")}
            className="mb-4 inline-flex items-center text-sm font-medium text-gray-600"
          >
            <span className="mr-2">←</span>
            Back to Events
          </button>
          <div className="rounded-2xl border border-red-200 bg-white p-6 shadow-sm">
            <h1 className="text-lg font-semibold text-gray-900">
              Unable to load session
            </h1>
            <p className="mt-2 text-sm text-red-600">
              {error || "This session could not be found."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const filteredAbsentees = absenteesList.filter((m) => {
    const q = absenteesSearch.toLowerCase().trim();
    if (!q) return true;
    return (
      m.name.toLowerCase().includes(q) ||
      m.uniqueId.toLowerCase().includes(q) ||
      (m.phoneNumber && m.phoneNumber.toLowerCase().includes(q)) ||
      m.campus.toLowerCase().includes(q) ||
      m.batch.toLowerCase().includes(q)
    );
  });

  return (
    <div className="min-h-screen bg-gray-50 pb-32">
      <div className="mx-auto max-w-3xl px-4 py-5 sm:px-6 sm:py-8">
        <button
          type="button"
          onClick={() => navigate("/events")}
          className="mb-4 inline-flex items-center text-sm font-medium text-gray-600 hover:text-gray-900"
        >
          <span className="mr-2">←</span>
          Back to Events
        </button>

        {/* Success/Error Alerts */}
        {actionSuccess && (
          <div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-4 text-sm font-semibold text-green-800">
            ✓ {actionSuccess}
          </div>
        )}
        {actionError && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">
            {actionError}
          </div>
        )}

        {/* Rescheduled Notice */}
        {event.rescheduledAt && (
          <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-bold flex items-center gap-2">
              ⚠️ Session Rescheduled
            </p>
            <p className="mt-1">
              Reason: <span className="font-medium">{event.rescheduleReason || "Slot modified"}</span>
            </p>
            {event.plannedStartTime && (
              <p className="mt-0.5 text-xs text-amber-700">
                Originally scheduled for: {formatDateTime(event.plannedStartTime)}
              </p>
            )}
          </div>
        )}

        {/* Cancelled Notice */}
        {event.status === "CANCELLED" && (
          <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
            <p className="font-bold flex items-center gap-2">
              ❌ Session Cancelled
            </p>
            <p className="mt-1">
              Reason: <span className="font-medium">{event.cancelReason || "Cancelled by admin"}</span>
            </p>
            {event.cancelledAt && (
              <p className="mt-0.5 text-xs text-red-700">
                Cancelled on: {formatDateTime(event.cancelledAt)} · Excluded from attendance rate calculations
              </p>
            )}
          </div>
        )}

        <div className="space-y-4">
          {/* Main Info Card */}
          <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">
                    Session Details
                  </p>
                  {event.sessionType && (
                    <span
                      className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${
                        event.sessionType === "OVERNIGHT"
                          ? "bg-indigo-50 text-indigo-700 border-indigo-200"
                          : event.sessionType === "EVENING"
                            ? "bg-blue-50 text-blue-700 border-blue-200"
                            : "bg-gray-50 text-gray-600 border-gray-200"
                      }`}
                    >
                      {event.sessionType === "OVERNIGHT"
                        ? "🌙 Overnight Session"
                        : event.sessionType === "EVENING"
                          ? "🌆 Evening Session"
                          : "📅 Standard Session"}
                    </span>
                  )}
                </div>
                <h1 className="mt-2 text-2xl font-bold text-gray-900 sm:text-3xl">
                  {event.title}
                </h1>
                {event.study && (
                  <p className="mt-1 text-sm font-semibold text-blue-700 flex items-center gap-1.5">
                    📖 Study: {event.study.name}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <span
                  className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold ${getStatusClasses(
                    event.status,
                  )}`}
                >
                  {event.status}
                </span>
                <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-semibold text-gray-700">
                  {event.eventType.replace("_", " ")}
                </span>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <InfoRow
                icon={
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                }
                label="Date"
                value={formatDate(event.startTime)}
              />
              <InfoRow
                icon={
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M12 2C8.686 2 6 4.686 6 8c0 5.25 6 12 6 12s6-6.75 6-12c0-3.314-2.686-6-6-6zm0 8a2 2 0 110-4 2 2 0 010 4z"
                  />
                }
                label="Location"
                value={event.location || "—"}
              />
              <InfoRow
                icon={
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                }
                label="Time"
                value={`${formatTime(event.startTime)} - ${formatTime(event.endTime)}`}
              />
              <InfoRow
                icon={
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                }
                label="Lateness Grace"
                value={`${event.lateGraceMinutes ?? event.study?.defaultLateGraceMinutes ?? 15} minutes`}
              />
            </div>
          </section>

          {/* Attendance Summary: Enriched Stats Row */}
          <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-gray-900">
                  Attendance Statistics
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Snapshot calculated based on member eligibility as of session date.
                </p>
              </div>
              <div
                className={`rounded-full px-3 py-1 text-sm font-semibold flex items-center gap-1.5 ${
                  attendanceStats.isCancelled
                    ? "bg-red-50 text-red-700"
                    : "bg-blue-50 text-blue-700"
                }`}
              >
                {attendanceStats.isCancelled ? (
                  "Cancelled"
                ) : (
                  <>
                    <span>{attendanceStats.attendancePercentage}% turnout</span>
                    {attendanceStats.eligiblePercentage !== null && (
                      <span className="text-xs text-blue-600/80 font-normal">
                        ({attendanceStats.eligiblePercentage}% of eligible)
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-7">
              <SummaryCard
                label="Participants"
                value={attendanceStats.participants ?? "—"}
                accent="text-indigo-700"
              />
              <SummaryCard
                label="Eligible"
                value={attendanceStats.totalMembers}
                accent="text-slate-800"
              />
              <SummaryCard
                label="Present"
                value={attendanceStats.present}
                accent="text-emerald-700"
              />
              <SummaryCard
                label="Late"
                value={attendanceStats.late}
                accent="text-amber-700"
              />
              <SummaryCard
                label="Excused"
                value={attendanceStats.excused}
                accent="text-blue-700"
              />
              <SummaryCard
                label="Absent"
                value={attendanceStats.absentees}
                accent="text-rose-700"
              />
              <SummaryCard
                label="Turnout %"
                value={
                  attendanceStats.isCancelled
                    ? "—"
                    : `${attendanceStats.attendancePercentage}%`
                }
                accent="text-indigo-700"
              />
            </div>
          </section>

          {/* Description */}
          <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="text-base font-semibold text-gray-900">
              Description
            </h2>
            <div className="mt-3 rounded-xl bg-gray-50 p-4">
              <p className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6 text-gray-700">
                {event.description || "No description provided."}
              </p>
            </div>
          </section>

          {/* Metadata */}
          <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="text-base font-semibold text-gray-900">Metadata</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <InfoRow
                icon={
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M5.121 17.804A13.937 13.937 0 0112 16c2.504 0 4.847.655 6.879 1.804M15 8a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                }
                label="Created by"
                value={event.createdBy?.name || "Admin User"}
              />
              <InfoRow
                icon={
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                }
                label="Created date"
                value={formatCreatedDate(event.createdAt)}
              />
            </div>
          </section>
        </div>
      </div>

      {/* Admin Action Buttons */}
      <div className="mx-auto max-w-3xl px-4 py-4">
        {isSuperAdmin && (
          <div className="mb-4 flex flex-wrap items-center gap-3">
            {event.status !== "CANCELLED" && (
              <>
                <button
                  type="button"
                  onClick={openRescheduleModal}
                  className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-800 transition hover:bg-amber-100"
                >
                  🔄 Reschedule Session
                </button>
                <button
                  type="button"
                  onClick={openCancelModal}
                  className="rounded-lg border border-red-300 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-800 transition hover:bg-red-100"
                >
                  ❌ Cancel Session
                </button>
              </>
            )}

            {canEdit && (
              <button
                type="button"
                onClick={() => {
                  setActionError("");
                  setIsEditModalOpen(true);
                }}
                className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700 transition hover:bg-blue-100"
              >
                ✏️ Edit Session
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setActionError("");
                setShowDeleteConfirmModal(true);
              }}
              disabled={!canDelete || isDeleting}
              className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition ${
                canDelete && !isDeleting
                  ? "bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300"
                  : "bg-gray-50 text-gray-400 cursor-not-allowed border border-gray-200"
              }`}
            >
              {isDeleting ? "Deleting..." : "Delete Session"}
            </button>
          </div>
        )}
      </div>

      {/* Fixed bottom CTA */}
      <div className="fixed inset-x-0 bottom-0 border-t border-gray-200 bg-white/95 px-4 py-4 backdrop-blur sm:px-6 z-20">
        <div className="mx-auto max-w-3xl flex gap-3">
          <button
            type="button"
            onClick={handleAction}
            className={`w-full rounded-xl px-4 py-3.5 text-sm font-semibold shadow-sm transition-colors ${
              event.attendanceOpen
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "bg-gray-900 text-white hover:bg-gray-800"
            }`}
          >
            {event.attendanceOpen
              ? "Take Attendance"
              : getActionLabel(event.status)}
          </button>
        </div>
      </div>

      {/* Attendance & Absentees Modal */}
      {isAttendanceModalOpen && event && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 px-4 py-4 sm:items-center sm:py-6">
          <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
            {/* Modal Header */}
            <div className="border-b border-slate-100 px-4 py-4 sm:px-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">
                    {event.title}
                  </h2>
                  <p className="mt-0.5 text-sm text-slate-500">
                    {formatDate(event.startTime)} · {formatTime(event.startTime)} -{" "}
                    {formatTime(event.endTime)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsAttendanceModalOpen(false);
                  }}
                  className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                >
                  ✕
                </button>
              </div>

              {/* Tabs: Attendees vs Absentees */}
              <div className="mt-4 flex rounded-full bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => setAttendanceModalTab("ATTENDEES")}
                  className={`flex-1 rounded-full py-2 text-sm font-semibold transition ${
                    attendanceModalTab === "ATTENDEES"
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Attendees ({attendanceTotalCount})
                </button>
                <button
                  type="button"
                  onClick={() => setAttendanceModalTab("ABSENTEES")}
                  className={`flex-1 rounded-full py-2 text-sm font-semibold transition ${
                    attendanceModalTab === "ABSENTEES"
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Absentees ({absenteesList.length})
                </button>
              </div>

              {/* Attendees Actions bar */}
              {attendanceModalTab === "ATTENDEES" && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs text-slate-500 font-medium">
                    Showing {attendanceRecords.length} of {attendanceTotalCount} records
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={`${attendanceSortBy}-${attendanceOrder}`}
                      onChange={(e) => {
                        const parts = e.target.value.split("-") as [AttendanceSortBy, AttendanceSortOrder];
                        void handleAttendanceSortChange(parts[0], parts[1]);
                      }}
                      className="rounded-xl border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 shadow-sm focus:border-blue-500 focus:outline-none"
                    >
                      <option value="time-asc">Time (Earliest)</option>
                      <option value="time-desc">Time (Latest)</option>
                      <option value="name-asc">Name (A-Z)</option>
                      <option value="name-desc">Name (Z-A)</option>
                    </select>

                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => {
                          if (event) {
                            navigate(`/events/${event.id}/attendance`, {
                              state: { event },
                            });
                          }
                        }}
                        className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 shadow-sm hover:bg-blue-100"
                      >
                        + Add Attendee
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleExportAttendanceExcel()}
                      disabled={attendanceLoading || attendanceExporting}
                      className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 shadow-sm hover:bg-emerald-100 disabled:opacity-60"
                    >
                      {attendanceExporting ? "Exporting..." : "Excel Export"}
                    </button>
                  </div>
                </div>
              )}

              {/* Absentees Controls bar: Search + Toggle */}
              {attendanceModalTab === "ABSENTEES" && (
                <div className="mt-3 space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-xl bg-slate-50 border border-slate-200 p-2">
                    <div className="text-xs font-semibold text-slate-700">
                      Showing:{" "}
                      <span className="font-bold text-blue-700">
                        {showAllEligibleAbsentees
                          ? "All Eligible Members Absent"
                          : "Study Cohort Absentees (Default)"}
                      </span>
                      <span className="ml-1 text-slate-400 font-normal">
                        ({filteredAbsentees.length} members)
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
                      <CopyAllPhonesDropdown
                        members={filteredAbsentees}
                        label="Copy All Phones"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const next = !showAllEligibleAbsentees;
                          setShowAllEligibleAbsentees(next);
                          void fetchAbsentees(next);
                        }}
                        className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-bold text-slate-700 shadow-2xs hover:bg-slate-100 transition"
                      >
                        {showAllEligibleAbsentees
                          ? "← Show Participants Only"
                          : "Show All Eligible Members →"}
                      </button>
                      <button
                        type="button"
                        onClick={resetModalFilters}
                        className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-bold text-slate-700 shadow-2xs hover:bg-slate-100 transition inline-flex items-center gap-1"
                        title="Reset absentees filters"
                      >
                        <RotateCcw className="w-3 h-3 text-slate-500" />
                        <span>Reset filters</span>
                      </button>
                    </div>
                  </div>

                  <input
                    type="text"
                    value={absenteesSearch}
                    onChange={(e) => setAbsenteesSearch(e.target.value)}
                    placeholder="Search absentees by name, phone, campus, or batch..."
                    className="w-full rounded-xl border border-gray-200 px-3.5 py-2 text-xs text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </div>
              )}
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
              {/* Attendees Tab Content */}
              {attendanceModalTab === "ATTENDEES" && (
                <div>
                  {attendanceError && (
                    <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {attendanceError}
                    </div>
                  )}

                  {attendanceLoading ? (
                    <div className="space-y-3 animate-pulse">
                      {[1, 2, 3].map((item) => (
                        <div
                          key={item}
                          className="h-20 rounded-2xl border border-slate-100 bg-slate-50"
                        />
                      ))}
                    </div>
                  ) : attendanceRecords.length === 0 ? (
                    <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                      No attendance records found for this session yet.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {attendanceRecords.map((record) => {
                        const status = record.status || "PRESENT";
                        return (
                          <article
                            key={`${record.memberId}-${record.markedAt}`}
                            className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"
                          >
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <h3 className="truncate text-sm font-bold text-slate-900">
                                    {record.name}
                                  </h3>

                                  {/* Status Chip */}
                                  <span
                                    className={`rounded-full px-2.5 py-0.5 text-xs font-bold border ${
                                      status === "PRESENT"
                                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                        : status === "LATE"
                                          ? "bg-amber-50 text-amber-800 border-amber-200"
                                          : "bg-blue-50 text-blue-700 border-blue-200"
                                    }`}
                                  >
                                    {status === "LATE"
                                      ? "⏰ Late"
                                      : status === "EXCUSED"
                                        ? "📝 Excused"
                                        : "✓ Present"}
                                  </span>

                                  {record.excuseReason && (
                                    <span className="text-xs text-blue-600 italic">
                                      ({record.excuseReason})
                                    </span>
                                  )}
                                </div>
                                <p className="mt-1 text-xs text-slate-500">
                                  ID: {record.uniqueId} · Phone: {record.phone || "—"}
                                </p>
                                <p className="text-xs text-slate-400 mt-0.5">
                                  Marked at: {formatDateTime(record.markedAt)}
                                </p>
                              </div>

                              {/* Admin Actions: Change Status & Undo */}
                              {isAdmin && (
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  <select
                                    value={status}
                                    onChange={(e) =>
                                      handleChangeStatus(
                                        record.id!,
                                        e.target.value as AttendanceStatus,
                                      )
                                    }
                                    className="text-xs rounded-lg border border-gray-200 bg-gray-50 py-1 px-2 text-gray-700 font-medium"
                                  >
                                    <option value="PRESENT">Present</option>
                                    <option value="LATE">Late</option>
                                    <option value="EXCUSED">Excused</option>
                                  </select>

                                  <button
                                    type="button"
                                    onClick={() => {
                                      setUndoTarget(record);
                                      setUndoReasonInput("");
                                      setUndoError("");
                                      setIsUndoModalOpen(true);
                                    }}
                                    className="text-xs text-red-600 hover:text-red-800 px-2 py-1 rounded bg-red-50 hover:bg-red-100"
                                    title="Undo attendance (soft remove)"
                                  >
                                    Undo
                                  </button>
                                </div>
                              )}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Absentees Tab Content */}
              {attendanceModalTab === "ABSENTEES" && (
                <div>
                  {absenteesError && (
                    <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {absenteesError}
                    </div>
                  )}

                  {absenteesLoading ? (
                    <div className="space-y-3 animate-pulse">
                      {[1, 2, 3].map((item) => (
                        <div
                          key={item}
                          className="h-20 rounded-2xl border border-slate-100 bg-slate-50"
                        />
                      ))}
                    </div>
                  ) : filteredAbsentees.length === 0 ? (
                    <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                      {absenteesSearch
                        ? "No absentees matched your search."
                        : "No absentees! 100% attendance."}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {filteredAbsentees.map((m) => (
                        <article
                          key={m.id}
                          className="rounded-2xl border border-rose-100 bg-white p-4 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="text-sm font-bold text-slate-900">
                                {m.name}
                              </h3>
                              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-100">
                                Absent
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-slate-500">
                              ID: {m.uniqueId} · {m.campus} · {m.batch}
                            </p>
                            {m.phoneNumber ? (
                              <div className="mt-1 flex items-center gap-1.5">
                                <a
                                  href={`tel:${m.phoneNumber}`}
                                  className="inline-flex items-center text-xs font-semibold text-blue-600 hover:underline"
                                >
                                  📞 {m.phoneNumber}
                                </a>
                                <CopyPhoneButton phoneNumber={m.phoneNumber} />
                              </div>
                            ) : (
                              <p className="mt-1 text-xs text-slate-400">
                                No phone recorded
                              </p>
                            )}
                          </div>

                          {isAdmin && (
                            <button
                              type="button"
                              onClick={() => {
                                setExcuseTarget({ memberId: m.id, memberName: m.name });
                                setExcuseReasonInput("");
                                setExcuseError("");
                                setIsExcuseModalOpen(true);
                              }}
                              className="self-start sm:self-auto rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                            >
                              + Excuse Member
                            </button>
                          )}
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Pagination for Attendees */}
            {attendanceModalTab === "ATTENDEES" && attendanceTotalPages > 1 && (
              <div className="border-t border-slate-100 px-4 py-3 sm:px-6 flex items-center justify-between">
                <span className="text-xs text-slate-500">
                  Page {attendancePage} of {attendanceTotalPages}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void fetchAttendancePage(attendancePage - 1)}
                    disabled={attendancePage <= 1 || attendanceLoading}
                    className="rounded-lg border px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => void fetchAttendancePage(attendancePage + 1)}
                    disabled={attendancePage >= attendanceTotalPages || attendanceLoading}
                    className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Excuse Modal */}
      {isExcuseModalOpen && excuseTarget && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-gray-900/50 px-4 py-6">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-gray-900">
              Excuse Member from Session
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              Mark <strong>{excuseTarget.memberName}</strong> as Excused for this session. Excused members do not count as absent and are excluded from the rate denominator.
            </p>

            <div className="mt-4">
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Reason for Excuse <span className="text-red-500">*</span>
              </label>
              <textarea
                value={excuseReasonInput}
                onChange={(e) => setExcuseReasonInput(e.target.value)}
                rows={3}
                placeholder="e.g. University exam clash, medical excuse..."
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                required
              />
            </div>

            {excuseError && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
                {excuseError}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsExcuseModalOpen(false);
                  setExcuseTarget(null);
                }}
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmExcuse}
                disabled={isExcusing}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {isExcusing ? "Saving..." : "Confirm Excuse"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Undo Modal */}
      {isUndoModalOpen && undoTarget && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-gray-900/50 px-4 py-6">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-gray-900">
              Undo Attendance Record
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              Remove attendance record for <strong>{undoTarget.name}</strong>. The record will be soft-deleted and can be safely re-marked if needed.
            </p>

            <div className="mt-4">
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Reason for Removal (optional)
              </label>
              <input
                type="text"
                value={undoReasonInput}
                onChange={(e) => setUndoReasonInput(e.target.value)}
                placeholder="e.g. Marked by mistake"
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>

            {undoError && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
                {undoError}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsUndoModalOpen(false);
                  setUndoTarget(null);
                }}
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmUndo}
                disabled={isUndoing}
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {isUndoing ? "Removing..." : "Confirm Undo"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reschedule Modal */}
      {isRescheduleModalOpen && event && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 px-4 py-6">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-xl font-bold text-gray-900">Reschedule Session</h2>
            <p className="mt-1 text-sm text-gray-500">
              Shift this session to a new date/time slot. Series linkage and original planned start time are preserved.
            </p>

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
                  placeholder="e.g. Venue booked for university exams, shifted to next day"
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
                  onClick={() => setIsRescheduleModalOpen(false)}
                  className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isRescheduling}
                  className="rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-amber-700 disabled:opacity-60"
                >
                  {isRescheduling ? "Saving..." : "Confirm Reschedule"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Cancel Modal */}
      {isCancelModalOpen && event && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 px-4 py-6">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-xl font-bold text-gray-900">Cancel Session</h2>
            <p className="mt-1 text-sm text-gray-500">
              Cancel <strong>{event.title}</strong>. Cancelled sessions are removed from all attendance rate analytics.
            </p>

            <form className="mt-6 space-y-4" onSubmit={handleCancelSubmit}>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Cancellation Reason <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  rows={3}
                  placeholder="e.g. University holiday, bad weather, or campus closure"
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
                  onClick={() => setIsCancelModalOpen(false)}
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

      {/* Delete Confirmation Modal */}
      {showDeleteConfirmModal && event && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="mb-2 text-center text-lg font-bold text-gray-900">
              Delete Event
            </h3>
            <p className="mb-6 text-center text-sm text-gray-500">
              Are you sure you want to delete <strong>{event.title}</strong>? This action cannot be undone.
            </p>
            <div className="flex space-x-3">
              <button
                type="button"
                onClick={() => setShowDeleteConfirmModal(false)}
                disabled={isDeleting}
                className="flex-1 rounded-xl border border-gray-300 bg-white px-4 py-2.5 font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={isDeleting}
                className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 font-medium text-white shadow-sm hover:bg-red-700 disabled:opacity-60"
              >
                {isDeleting ? "Deleting..." : "Yes, Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {isEditModalOpen && event && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 px-4 py-6">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-xl font-bold text-gray-900">Edit Event</h2>
            <p className="mt-1 text-sm text-gray-500">
              Update session details before it begins.
            </p>

            <form className="mt-6 space-y-4" onSubmit={handleEditSubmit}>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Title <span className="text-red-500">*</span>
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
                  Description <span className="text-red-500">*</span>
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

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Location <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={editForm.location}
                  onChange={(e) =>
                    setEditForm((prev) => ({
                      ...prev,
                      location: e.target.value,
                    }))
                  }
                  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  required
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Start time <span className="text-red-500">*</span>
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
                    End time <span className="text-red-500">*</span>
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

              <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-60"
                >
                  {isSaving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

type InfoRowProps = {
  label: string;
  value: string;
  icon: React.ReactNode;
};

const InfoRow: React.FC<InfoRowProps> = ({ label, value, icon }) => (
  <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
    <div className="flex items-start gap-3">
      <div className="rounded-lg bg-white p-2 text-gray-500 shadow-sm">
        <svg
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          {icon}
        </svg>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          {label}
        </p>
        <p className="mt-1 text-sm font-medium text-gray-800">{value}</p>
      </div>
    </div>
  </div>
);

type SummaryCardProps = {
  label: string;
  value: number | string;
  accent: string;
};

const SummaryCard: React.FC<SummaryCardProps> = ({ label, value, accent }) => (
  <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
    <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
      {label}
    </p>
    <p className={`mt-2 text-2xl font-bold ${accent}`}>{value}</p>
  </div>
);

export default EventDetailsPage;
