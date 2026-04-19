import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import api, { getMembersCount } from "../lib/api";
import formatDate, { formatDateTime } from "../lib/formatDate";
import QrAttendanceScanner from "../components/QrAttendanceScanner";
import type {
  AttendanceSortBy,
  AttendanceSortOrder,
  DashboardEvent,
  EventAttendanceRecord,
  EventAttendanceResponse,
} from "../types/events";
import type { Member } from "../types/members";
import { useAuth } from "../contexts/AuthContext";

type LocationState = {
  event?: DashboardEvent;
};

type EditableStatusOption = "UPCOMING" | "DEACTIVATED";

type AddAttendanceTab = "QR" | "MANUAL";
type AttendanceFeedbackTone = "success" | "error" | "info";
type AttendanceFeedback = {
  tone: AttendanceFeedbackTone;
  title: string;
  description?: string;
};

const EDITABLE_STATUS_OPTIONS: Array<{
  value: EditableStatusOption;
  label: string;
}> = [
  { value: "UPCOMING", label: "Upcoming" },
  { value: "DEACTIVATED", label: "Deactivated" },
];

const ATTENDANCE_PAGE_SIZE = 20;
const RECENT_MARK_THRESHOLD_MS = 15 * 60 * 1000;

const attendanceCache = new Map<string, EventAttendanceResponse>();

const sanitizeDownloadFileName = (value: string) =>
  value
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ") || "event";

const getFileNameFromContentDisposition = (header?: string, fallback?: string) => {
  const fileNameMatch = header?.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i);
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
    createdAt: rawEvent.createdAt || eventStart.toISOString(),
    createdBy: {
      id: rawEvent.admin?.id || rawEvent.createdBy?.id || "unknown-admin",
      name: rawEvent.admin?.name || rawEvent.createdBy?.name || "Admin User",
    },
    attendanceCount:
      rawEvent._count?.attendances || rawEvent.attendanceCount || 0,
    totalMembers: rawEvent.totalMembers || 0,
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
const toLocalDateValue = (value: string) =>
  toDateTimeLocalValue(value).slice(0, 10);
const toLocalTimeValue = (value: string) =>
  toDateTimeLocalValue(value).slice(11, 16);

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
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState(false);
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [actionError, setActionError] = useState("");
  const [isAttendanceModalOpen, setIsAttendanceModalOpen] = useState(false);
  const [attendanceRecords, setAttendanceRecords] = useState<
    EventAttendanceRecord[]
  >([]);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [attendanceError, setAttendanceError] = useState("");
  const [attendancePage, setAttendancePage] = useState(1);
  const [attendanceTotalPages, setAttendanceTotalPages] = useState(1);
  const [attendanceTotalCount, setAttendanceTotalCount] = useState(0);
  const [attendanceExporting, setAttendanceExporting] = useState(false);
  const [membersCount, setMembersCount] = useState<number | null>(null);
  const [attendanceSortBy, setAttendanceSortBy] =
    useState<AttendanceSortBy>("time");
  const [attendanceOrder, setAttendanceOrder] =
    useState<AttendanceSortOrder>("asc");
  const [isAttendanceSortOpen, setIsAttendanceSortOpen] = useState(false);
  const [isAddAttendeeOpen, setIsAddAttendeeOpen] = useState(false);
  const [isClusterModalOpen, setIsClusterModalOpen] = useState(false);
  const [clusterLoading, setClusterLoading] = useState(false);
  const [clusterError, setClusterError] = useState("");
  const [clusterForm, setClusterForm] = useState({
    title: "",
    description: "",
    location: "",
  });
  const [clusterEvents, setClusterEvents] = useState<
    Array<{
      id?: string;
      eventDate: string;
      startTime: string;
      endTime: string;
      label: string;
    }>
  >([]);
  const [addAttendeeTab, setAddAttendeeTab] = useState<AddAttendanceTab>("QR");
  const [addAttendeeFeedback, setAddAttendeeFeedback] =
    useState<AttendanceFeedback | null>(null);
  const [addAttendeeError, setAddAttendeeError] = useState<string>("");
  const [addAttendeeLoading, setAddAttendeeLoading] = useState(false);
  const [addMembersLoading, setAddMembersLoading] = useState(false);
  const [addMembersSearch, setAddMembersSearch] = useState("");
  const [addMembers, setAddMembers] = useState<Member[]>([]);
  const [editValidationErrors, setEditValidationErrors] = useState<{
    title?: string;
    description?: string;
    location?: string;
    startTime?: string;
    endTime?: string;
  }>({});
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

  const statusDropdownRef = React.useRef<HTMLDivElement>(null);
  const attendanceSortDropdownRef = React.useRef<HTMLDivElement>(null);

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
      if (!event) {
        return;
      }

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

  useEffect(() => {
    if (!id) {
      return;
    }

    const fetchEvent = async () => {
      try {
        setLoading(true);
        setError("");

        const response = await api.get(`/events/${id}`);
        const rawEvent = response.data?.event ?? response.data;

        if (!rawEvent) {
          throw new Error("Event not found");
        }

        const mapped = mapEventToDashboardEvent(rawEvent);
        setEvent(mapped);

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
    if (!isEditModalOpen || !isStatusDropdownOpen) {
      return;
    }

    const handleClickOutside = (mouseEvent: MouseEvent) => {
      if (
        statusDropdownRef.current &&
        !statusDropdownRef.current.contains(mouseEvent.target as Node)
      ) {
        setIsStatusDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isEditModalOpen, isStatusDropdownOpen]);

  useEffect(() => {
    if (!isAttendanceModalOpen) {
      return;
    }

    const loadAttendance = async () => {
      try {
        await fetchAttendancePage(1, { preferCache: false });
      } catch {
        // handled in fetchAttendancePage
      }
    };

    void loadAttendance();
  }, [fetchAttendancePage, isAttendanceModalOpen]);

  useEffect(() => {
    if (
      !isAttendanceModalOpen ||
      attendancePage >= attendanceTotalPages ||
      !event
    ) {
      return;
    }

    void fetchAttendancePage(attendancePage + 1, { silent: true });
  }, [
    attendancePage,
    attendanceTotalPages,
    event,
    fetchAttendancePage,
    isAttendanceModalOpen,
  ]);

  useEffect(() => {
    if (!isAttendanceModalOpen || !isAttendanceSortOpen) {
      return;
    }

    const handleClickOutside = (mouseEvent: MouseEvent) => {
      if (
        attendanceSortDropdownRef.current &&
        !attendanceSortDropdownRef.current.contains(mouseEvent.target as Node)
      ) {
        setIsAttendanceSortOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isAttendanceModalOpen, isAttendanceSortOpen]);

  const attendanceStats = useMemo(() => {
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
      attendees,
      absentees,
      attendancePercentage,
    };
  }, [event, attendanceTotalCount, membersCount]);

  const formatTime = (value: string) =>
    new Date(value).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

  // show date as dd/mm/yyyy (formatDate is imported)
  const formatCreatedDate = (value: string) => formatDateTime(value);

  const getStatusClasses = (status: DashboardEvent["status"]) => {
    switch (status) {
      case "ACTIVE":
        return "bg-green-100 text-green-800 border-green-200";
      case "UPCOMING":
        return "bg-blue-100 text-blue-800 border-blue-200";
      case "DEACTIVATED":
        return "bg-yellow-50 text-yellow-800 border-yellow-100";
      case "PAST":
        return "bg-gray-100 text-gray-700 border-gray-200";
      default:
        return "bg-gray-100 text-gray-700 border-gray-200";
    }
  };

  const getActionLabel = (status: DashboardEvent["status"]) => {
    switch (status) {
      case "ACTIVE":
        return "Take Attendance";
      case "PAST":
        return "View Attendance";
      case "DEACTIVATED":
        return "Attendance Unavailable";
      default:
        return "Attendance Not Available Yet";
    }
  };

  const handleAction = () => {
    if (!event) {
      return;
    }

    if (event.status === "PAST") {
      setAttendanceError("");
      setAttendancePage(1);
      setAttendanceTotalPages(1);
      setAttendanceTotalCount(0);
      setIsAttendanceSortOpen(false);
      setIsAttendanceModalOpen(true);
      return;
    }

    if (!event.attendanceOpen) {
      return;
    }

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
    setIsAttendanceSortOpen(false);

    if (!event) {
      return;
    }

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
        err.response?.data?.error ||
          err.response?.data?.message ||
          "Failed to load attendance records.",
      );
    } finally {
      setAttendanceLoading(false);
    }
  };

  const handleExportAttendanceExcel = async () => {
    if (!event) return;

    try {
      setAttendanceExporting(true);
      setAttendanceError("");

      const response = await api.get(
        `/events/${event.id}/attendance/export/excel`,
        {
          responseType: "blob",
          params: {
            sortBy: attendanceSortBy,
            order: attendanceOrder,
          },
        },
      );

      const fallbackFileName = `${sanitizeDownloadFileName(event.title)}.xlsx`;
      const fileName = getFileNameFromContentDisposition(
        response.headers["content-disposition"],
        fallbackFileName,
      );

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
      setAttendanceError(
        err.response?.data?.error ||
          err.response?.data?.message ||
          "Failed to export attendance.",
      );
    } finally {
      setAttendanceExporting(false);
    }
  };

  const attendanceSortLabel =
    attendanceSortBy === "time"
      ? attendanceOrder === "asc"
        ? "Time registered (earliest first)"
        : "Time registered (latest first)"
      : attendanceOrder === "asc"
        ? "Name (A–Z)"
        : "Name (Z–A)";

  const isAdmin = admin?.role === "ADMIN" || admin?.role === "SUPER_ADMIN";

  const presentMemberIds = useMemo(() => {
    return new Set(attendanceRecords.map((record) => record.memberId));
  }, [attendanceRecords]);

  const filteredAddMembers = useMemo(() => {
    const query = addMembersSearch.trim().toLowerCase();
    if (!query) return addMembers;

    return addMembers.filter((member) => {
      return (
        member.name.toLowerCase().includes(query) ||
        member.uniqueId.toLowerCase().includes(query) ||
        (member.email ?? "").toLowerCase().includes(query)
      );
    });
  }, [addMembers, addMembersSearch]);

  const loadAddMembers = React.useCallback(async () => {
    try {
      setAddMembersLoading(true);
      const response = await api.get("/members");
      setAddMembers(response.data?.members ?? []);
    } catch (err: any) {
      setAddAttendeeError(
        err.response?.data?.error ||
          err.response?.data?.message ||
          "Failed to load members.",
      );
    } finally {
      setAddMembersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAddAttendeeOpen) return;
    setAddAttendeeError("");
    setAddAttendeeFeedback(null);
    void loadAddMembers();
  }, [isAddAttendeeOpen, loadAddMembers]);

  const handleAddAttendance = async (
    memberId: string,
    method: "QR" | "MANUAL",
  ) => {
    if (!event) return;
    setAddAttendeeLoading(true);
    setAddAttendeeError("");
    setAddAttendeeFeedback(null);

    try {
      const response = await api.post("/attendance", {
        memberId,
        eventId: event.id,
        method,
        allowOverride: true,
      });

      setAddAttendeeFeedback({
        tone: "success",
        title: "Attendance recorded",
        description: response.data?.message,
      });

      await fetchAttendancePage(1, { preferCache: false });
      setAttendancePage(1);
    } catch (err: any) {
      setAddAttendeeError(
        err.response?.data?.error ||
          err.response?.data?.message ||
          "Failed to mark attendance.",
      );
      setAddAttendeeFeedback({
        tone: "error",
        title: "Unable to add attendee",
        description:
          err.response?.data?.error ||
          err.response?.data?.message ||
          "Please try again.",
      });
    } finally {
      setAddAttendeeLoading(false);
    }
  };

  const isSuperAdmin = admin?.role === "SUPER_ADMIN";
  const canEdit = Boolean(isSuperAdmin && event);
  const canDelete = Boolean(isSuperAdmin && event);

  const openClusterModal = async () => {
    if (!event?.cluster?.id) {
      return;
    }

    try {
      setClusterLoading(true);
      setClusterError("");

      const response = await api.get(`/events/cluster/${event.cluster.id}`);
      const cluster = response.data?.cluster;
      const clusterEventsResponse = response.data?.events ?? [];

      if (!cluster) {
        setClusterError("Unable to load cluster details.");
        return;
      }

      setClusterForm({
        title: cluster.title ?? "",
        description: cluster.description ?? "",
        location: cluster.location ?? "",
      });

      setClusterEvents(
        clusterEventsResponse.map((entry: any) => ({
          id: entry.id,
          eventDate: toLocalDateValue(entry.startTime),
          startTime: toLocalTimeValue(entry.startTime),
          endTime: toLocalTimeValue(entry.endTime),
          label: entry.clusterLabel ?? "",
        })),
      );

      setIsClusterModalOpen(true);
    } catch (err: any) {
      setClusterError(
        err.response?.data?.error ||
          err.response?.data?.message ||
          "Failed to load cluster details.",
      );
    } finally {
      setClusterLoading(false);
    }
  };

  const updateClusterEvent = (
    index: number,
    field: "eventDate" | "startTime" | "endTime" | "label",
    value: string,
  ) => {
    setClusterEvents((prev) =>
      prev.map((entry, idx) =>
        idx === index ? { ...entry, [field]: value } : entry,
      ),
    );
  };

  const addClusterEventRow = () => {
    setClusterEvents((prev) => [
      ...prev,
      { eventDate: "", startTime: "", endTime: "", label: "" },
    ]);
  };

  const removeClusterEventRow = (index: number) => {
    setClusterEvents((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleClusterSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!event?.cluster?.id) {
      return;
    }

    setClusterError("");

    if (!clusterForm.title.trim()) {
      setClusterError("Cluster title is required.");
      return;
    }

    if (!clusterForm.description.trim()) {
      setClusterError("Cluster description is required.");
      return;
    }

    if (!clusterForm.location.trim()) {
      setClusterError("Cluster location is required.");
      return;
    }

    if (clusterEvents.length === 0) {
      setClusterError("Add at least one event to the cluster.");
      return;
    }

    for (let i = 0; i < clusterEvents.length; i += 1) {
      const entry = clusterEvents[i];
      if (!entry.eventDate || !entry.startTime || !entry.endTime) {
        setClusterError(
          `Cluster event #${i + 1} must have a date, start time, and end time.`,
        );
        return;
      }

      if (entry.endTime <= entry.startTime) {
        setClusterError(`Cluster event #${i + 1} must end after it starts.`);
        return;
      }
    }

    try {
      setIsSaving(true);
      const payloadEvents = clusterEvents.map((entry) => ({
        id: entry.id,
        eventDate: new Date(entry.eventDate).toISOString(),
        startTime: new Date(
          `${entry.eventDate}T${entry.startTime}`,
        ).toISOString(),
        endTime: new Date(`${entry.eventDate}T${entry.endTime}`).toISOString(),
        label: entry.label.trim() || undefined,
      }));

      const response = await api.patch(`/events/cluster/${event.cluster.id}`, {
        title: clusterForm.title.trim(),
        description: clusterForm.description.trim(),
        location: clusterForm.location.trim(),
        events: payloadEvents,
      });

      const updatedEvents = response.data?.events ?? [];
      const updatedEvent = updatedEvents.find(
        (entry: any) => entry.id === event.id,
      );

      if (updatedEvent) {
        setEvent(mapEventToDashboardEvent(updatedEvent));
      }

      setIsClusterModalOpen(false);
    } catch (err: any) {
      setClusterError(
        err.response?.data?.error ||
          err.response?.data?.message ||
          "Failed to update cluster.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!event) {
      return;
    }

    setActionError("");
    setEditValidationErrors({});

    const nextErrors: {
      title?: string;
      description?: string;
      location?: string;
      startTime?: string;
      endTime?: string;
    } = {};

    if (!editForm.title.trim()) {
      nextErrors.title = "Event title is required";
    }

    if (!editForm.description.trim()) {
      nextErrors.description = "Event description is required";
    }

    if (!editForm.location.trim()) {
      nextErrors.location = "Event location is required";
    }

    if (!editForm.startTime) {
      nextErrors.startTime = "Start time is required";
    }

    if (!editForm.endTime) {
      nextErrors.endTime = "End time is required";
    }

    if (Object.keys(nextErrors).length > 0) {
      setEditValidationErrors(nextErrors);
      return;
    }

    const parsedStartTime = new Date(editForm.startTime);
    const parsedEndTime = new Date(editForm.endTime);

    if (
      Number.isNaN(parsedStartTime.getTime()) ||
      Number.isNaN(parsedEndTime.getTime())
    ) {
      setActionError("Please enter valid start and end times.");
      return;
    }

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

      const updatedEvent = mapEventToDashboardEvent(
        response.data?.event ?? response.data,
      );
      setEvent(updatedEvent);
      setIsEditModalOpen(false);
      setIsStatusDropdownOpen(false);
    } catch (err: any) {
      setActionError(
        err.response?.data?.error ||
          err.response?.data?.message ||
          "Failed to update event.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!event) {
      return;
    }

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
        err.response?.data?.error ||
          err.response?.data?.message ||
          "Failed to delete event.",
      );
    } finally {
      setIsDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 px-4 py-6">
        <div className="max-w-3xl mx-auto flex min-h-[60vh] flex-col items-center justify-center">
          <div className="h-10 w-10 rounded-full border-4 border-blue-500 border-t-transparent animate-spin" />
          <p className="mt-4 text-sm font-medium text-gray-500">
            Loading event details...
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
              Unable to load event
            </h1>
            <p className="mt-2 text-sm text-red-600">
              {error || "This event could not be found."}
            </p>
          </div>
        </div>
      </div>
    );
  }

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

        <div className="space-y-4">
          <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">
                  Event Details
                </p>
                <h1 className="mt-2 text-2xl font-bold text-gray-900 sm:text-3xl">
                  {event.title}
                </h1>
                {event.clusterLabel && (
                  <p className="mt-1 text-sm font-semibold text-blue-700">
                    {event.clusterLabel}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <span
                  className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold ${getStatusClasses(event.status)}`}
                >
                  {event.status}
                </span>
                <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-semibold text-gray-700">
                  {event.eventType.replace("_", " ")}
                </span>
              </div>
            </div>

            {actionError && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {actionError}
              </div>
            )}

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
              {event.cluster && (
                <InfoRow
                  icon={
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M4 7h16M4 12h16M4 17h16"
                    />
                  }
                  label="Cluster"
                  value={event.cluster.title}
                />
              )}
            </div>
          </section>

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

          <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-gray-900">
                  Attendance Summary
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Quick attendance snapshot for this event.
                </p>
              </div>
              <div className="rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-700">
                {attendanceStats.attendancePercentage}% attended
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <SummaryCard
                label="Total members"
                value={attendanceStats.totalMembers}
                accent="text-slate-700"
              />
              <SummaryCard
                label="Attendees"
                value={attendanceStats.attendees}
                accent="text-green-700"
              />
              <SummaryCard
                label="Absentees"
                value={attendanceStats.absentees}
                accent="text-amber-700"
              />
              <SummaryCard
                label="Attendance %"
                value={`${attendanceStats.attendancePercentage}%`}
                accent="text-blue-700"
              />
            </div>
          </section>
        </div>
      </div>

      {/* Non-fixed action row placed at the bottom of the page (not fixed) */}
      <div className="mx-auto max-w-3xl px-4 py-4">
        {isSuperAdmin && (
          <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-start gap-3">
            <button
              type="button"
              onClick={() => {
                setActionError("");
                setIsEditModalOpen(true);
                setIsStatusDropdownOpen(false);
              }}
              disabled={!canEdit}
              className={`rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                canEdit
                  ? "bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200"
                  : "bg-white text-gray-400 cursor-not-allowed border border-gray-200"
              }`}
            >
              Edit Event
            </button>

            {event?.cluster && (
              <button
                type="button"
                onClick={openClusterModal}
                disabled={!canEdit || clusterLoading}
                className={`rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                  canEdit && !clusterLoading
                    ? "bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200"
                    : "bg-white text-gray-400 cursor-not-allowed border border-gray-200"
                }`}
              >
                {clusterLoading ? "Loading..." : "Edit Cluster"}
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setActionError("");
                setShowDeleteConfirmModal(true);
              }}
              disabled={!canDelete || isDeleting}
              className={`rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                canDelete && !isDeleting
                  ? "bg-red-600 text-white hover:bg-red-700"
                  : "bg-red-50 text-red-300 cursor-not-allowed border border-red-100"
              }`}
            >
              {isDeleting ? "Deleting..." : "Delete Event"}
            </button>
          </div>
        )}
      </div>

      {/* Fixed attendance CTA remains fixed at the bottom */}
      <div className="fixed inset-x-0 bottom-0 border-t border-gray-200 bg-white/95 px-4 py-4 backdrop-blur sm:px-6">
        <div className="mx-auto max-w-3xl">
          <button
            type="button"
            onClick={handleAction}
            // allow clicking for PAST events (view-only) even when attendanceOpen is false
            disabled={!(event.attendanceOpen || event.status === "PAST")}
            className={`w-full rounded-xl px-4 py-3.5 text-sm font-semibold shadow-sm transition-colors ${
              event.attendanceOpen
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : event.status === "PAST"
                  ? "bg-gray-900 text-white hover:bg-gray-800"
                  : "bg-gray-100 text-gray-400 cursor-not-allowed"
            }`}
          >
            {event.attendanceOpen
              ? "Take Attendance"
              : getActionLabel(event.status)}
          </button>
        </div>
      </div>

      {isEditModalOpen && event && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 px-4 py-6">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Edit Event</h2>
                <p className="mt-1 text-sm text-gray-500">
                  Update the event details. Changes are only allowed before the
                  event starts.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsEditModalOpen(false);
                  setActionError("");
                  syncEditForm(event);
                }}
                className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                aria-label="Close edit modal"
              >
                ✕
              </button>
            </div>

            <form className="mt-6 space-y-4" onSubmit={handleEditSubmit}>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Title <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={editForm.title}
                  onChange={(e) => {
                    setEditForm((prev) => ({ ...prev, title: e.target.value }));
                    setEditValidationErrors((prev) => ({
                      ...prev,
                      title: undefined,
                    }));
                  }}
                  className={`w-full rounded-xl border px-4 py-2.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 ${editValidationErrors.title ? "border-red-300 bg-red-50" : "border-gray-200"}`}
                  required
                />
                {editValidationErrors.title && (
                  <p className="mt-1 text-xs font-medium text-red-600">
                    {editValidationErrors.title}
                  </p>
                )}
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Description <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={editForm.description}
                  onChange={(e) => {
                    setEditForm((prev) => ({
                      ...prev,
                      description: e.target.value,
                    }));
                    setEditValidationErrors((prev) => ({
                      ...prev,
                      description: undefined,
                    }));
                  }}
                  rows={4}
                  className={`w-full rounded-xl border px-4 py-2.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 ${editValidationErrors.description ? "border-red-300 bg-red-50" : "border-gray-200"}`}
                />
                {editValidationErrors.description && (
                  <p className="mt-1 text-xs font-medium text-red-600">
                    {editValidationErrors.description}
                  </p>
                )}
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Location <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={editForm.location}
                  onChange={(e) => {
                    setEditForm((prev) => ({
                      ...prev,
                      location: e.target.value,
                    }));
                    setEditValidationErrors((prev) => ({
                      ...prev,
                      location: undefined,
                    }));
                  }}
                  className={`w-full rounded-xl border px-4 py-2.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 ${editValidationErrors.location ? "border-red-300 bg-red-50" : "border-gray-200"}`}
                  required
                />
                {editValidationErrors.location && (
                  <p className="mt-1 text-xs font-medium text-red-600">
                    {editValidationErrors.location}
                  </p>
                )}
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Status
                </label>
                <div className="relative" ref={statusDropdownRef}>
                  <button
                    type="button"
                    onClick={() => setIsStatusDropdownOpen((prev) => !prev)}
                    className="flex w-full items-center justify-between rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 shadow-sm transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  >
                    <span>
                      {editForm.status === "DEACTIVATED"
                        ? "Deactivated"
                        : "Upcoming"}
                    </span>
                    <svg
                      className={`h-4 w-4 text-gray-500 transition-transform ${
                        isStatusDropdownOpen ? "rotate-180" : ""
                      }`}
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
                    <div className="absolute z-10 mt-2 w-full rounded-xl border border-gray-200 bg-white p-2 shadow-lg">
                      {EDITABLE_STATUS_OPTIONS.map((option) => {
                        const isSelected = editForm.status === option.value;

                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => {
                              setEditForm((prev) => ({
                                ...prev,
                                status: option.value,
                              }));
                              setIsStatusDropdownOpen(false);
                            }}
                            className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${
                              isSelected
                                ? "bg-blue-50 text-blue-700"
                                : "text-gray-700 hover:bg-gray-50"
                            }`}
                          >
                            <span>{option.label}</span>
                            {isSelected && (
                              <svg
                                className="h-4 w-4"
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
                        );
                      })}
                    </div>
                  )}
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  Upcoming events can only be changed to deactivated here.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Start time <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="datetime-local"
                    value={editForm.startTime}
                    onChange={(e) => {
                      setEditForm((prev) => ({
                        ...prev,
                        startTime: e.target.value,
                      }));
                      setEditValidationErrors((prev) => ({
                        ...prev,
                        startTime: undefined,
                      }));
                    }}
                    className={`w-full rounded-xl border px-4 py-2.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 ${editValidationErrors.startTime ? "border-red-300 bg-red-50" : "border-gray-200"}`}
                    required
                  />
                  {editValidationErrors.startTime && (
                    <p className="mt-1 text-xs font-medium text-red-600">
                      {editValidationErrors.startTime}
                    </p>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    End time <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="datetime-local"
                    value={editForm.endTime}
                    onChange={(e) => {
                      setEditForm((prev) => ({
                        ...prev,
                        endTime: e.target.value,
                      }));
                      setEditValidationErrors((prev) => ({
                        ...prev,
                        endTime: undefined,
                      }));
                    }}
                    className={`w-full rounded-xl border px-4 py-2.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 ${editValidationErrors.endTime ? "border-red-300 bg-red-50" : "border-gray-200"}`}
                    required
                  />
                  {editValidationErrors.endTime && (
                    <p className="mt-1 text-xs font-medium text-red-600">
                      {editValidationErrors.endTime}
                    </p>
                  )}
                </div>
              </div>

              {actionError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {actionError}
                </div>
              )}

              <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setIsEditModalOpen(false);
                    setActionError("");
                    setIsStatusDropdownOpen(false);
                    syncEditForm(event);
                  }}
                  className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className={`rounded-xl px-4 py-2.5 text-sm font-semibold text-white ${
                    isSaving ? "bg-blue-300" : "bg-blue-600 hover:bg-blue-700"
                  }`}
                >
                  {isSaving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isClusterModalOpen && event?.cluster && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 px-4 py-6">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900">
                  Edit Cluster
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Update the cluster details and event schedule.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsClusterModalOpen(false);
                  setClusterError("");
                }}
                className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                aria-label="Close cluster modal"
              >
                ✕
              </button>
            </div>

            <form className="mt-6 space-y-4" onSubmit={handleClusterSubmit}>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Cluster Title <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={clusterForm.title}
                  onChange={(e) =>
                    setClusterForm((prev) => ({
                      ...prev,
                      title: e.target.value,
                    }))
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
                  value={clusterForm.description}
                  onChange={(e) =>
                    setClusterForm((prev) => ({
                      ...prev,
                      description: e.target.value,
                    }))
                  }
                  rows={3}
                  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Location <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={clusterForm.location}
                  onChange={(e) =>
                    setClusterForm((prev) => ({
                      ...prev,
                      location: e.target.value,
                    }))
                  }
                  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  required
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-800">
                    Cluster Events
                  </h3>
                  <button
                    type="button"
                    onClick={addClusterEventRow}
                    className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                  >
                    + Add Event
                  </button>
                </div>

                {clusterEvents.map((entry, index) => (
                  <div
                    key={entry.id ?? `cluster-event-${index}`}
                    className="rounded-xl border border-gray-200 bg-gray-50 p-3"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-xs font-semibold text-gray-600">
                        Event {index + 1}
                      </p>
                      {clusterEvents.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeClusterEventRow(index)}
                          className="text-xs font-semibold text-red-600 hover:text-red-700"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                      <div className="md:col-span-2">
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Label (optional)
                        </label>
                        <input
                          type="text"
                          value={entry.label}
                          onChange={(e) =>
                            updateClusterEvent(index, "label", e.target.value)
                          }
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Date
                        </label>
                        <input
                          type="date"
                          value={entry.eventDate}
                          onChange={(e) =>
                            updateClusterEvent(
                              index,
                              "eventDate",
                              e.target.value,
                            )
                          }
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Start
                        </label>
                        <input
                          type="time"
                          value={entry.startTime}
                          onChange={(e) =>
                            updateClusterEvent(
                              index,
                              "startTime",
                              e.target.value,
                            )
                          }
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          End
                        </label>
                        <input
                          type="time"
                          value={entry.endTime}
                          onChange={(e) =>
                            updateClusterEvent(index, "endTime", e.target.value)
                          }
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {clusterError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {clusterError}
                </div>
              )}

              <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setIsClusterModalOpen(false)}
                  className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-60"
                >
                  {isSaving ? "Saving..." : "Save Cluster"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showDeleteConfirmModal && event && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
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
            <h3 className="mb-2 text-center text-lg font-medium text-gray-900">
              Delete Event
            </h3>
            <p className="mb-6 text-center text-sm text-gray-500">
              Are you sure you want to delete <strong>{event.title}</strong>?
              This action cannot be undone.
            </p>
            <div className="flex space-x-3">
              <button
                type="button"
                onClick={() => setShowDeleteConfirmModal(false)}
                disabled={isDeleting}
                className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={isDeleting}
                className="flex-1 rounded-lg border border-transparent bg-red-600 px-4 py-2 font-medium text-white shadow-sm transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-300"
              >
                {isDeleting ? "Deleting..." : "Yes, Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {isAttendanceModalOpen && event && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 px-4 py-4 sm:items-center sm:py-6">
          <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="border-b border-slate-100 px-4 py-4 sm:px-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600">
                    View Attendance
                  </p>
                  <h2 className="mt-2 text-xl font-bold text-slate-900">
                    {event.title}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {formatDate(event.startTime)} ·{" "}
                    {formatTime(event.startTime)} - {formatTime(event.endTime)}
                  </p>
                  {event.location && (
                    <p className="mt-1 text-sm text-slate-500">
                      📍 {event.location}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsAttendanceModalOpen(false);
                    setIsAttendanceSortOpen(false);
                  }}
                  className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  aria-label="Close attendance modal"
                >
                  ✕
                </button>
              </div>

              <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
                <p className="font-medium text-slate-900">Description</p>
                <p className="mt-1 whitespace-pre-wrap break-words">
                  {event.description || "No description provided."}
                </p>
              </div>

              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-slate-500">
                  {attendanceTotalCount} attendee
                  {attendanceTotalCount === 1 ? "" : "s"}
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => setIsAddAttendeeOpen(true)}
                      className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700 shadow-sm transition hover:bg-blue-100"
                    >
                      Add Attendee
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleExportAttendanceExcel()}
                    disabled={attendanceLoading || attendanceExporting}
                    className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 shadow-sm transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {attendanceExporting ? "Exporting..." : "Export Excel"}
                  </button>
                  <div className="relative" ref={attendanceSortDropdownRef}>
                    <button
                      type="button"
                      onClick={() => setIsAttendanceSortOpen((prev) => !prev)}
                      className="flex w-full items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 sm:min-w-[260px]"
                    >
                      <span className="truncate">{attendanceSortLabel}</span>
                      <svg
                        className={`h-4 w-4 text-slate-500 transition-transform ${isAttendanceSortOpen ? "rotate-180" : ""}`}
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

                    {isAttendanceSortOpen && (
                      <div className="absolute right-0 z-20 mt-2 w-full min-w-[260px] rounded-2xl border border-slate-200 bg-white p-2 shadow-lg">
                        {[
                          {
                            label: "Time registered (earliest first)",
                            sortBy: "time" as AttendanceSortBy,
                            order: "asc" as AttendanceSortOrder,
                          },
                          {
                            label: "Time registered (latest first)",
                            sortBy: "time" as AttendanceSortBy,
                            order: "desc" as AttendanceSortOrder,
                          },
                          {
                            label: "Name (A–Z)",
                            sortBy: "name" as AttendanceSortBy,
                            order: "asc" as AttendanceSortOrder,
                          },
                          {
                            label: "Name (Z–A)",
                            sortBy: "name" as AttendanceSortBy,
                            order: "desc" as AttendanceSortOrder,
                          },
                        ].map((option) => {
                          const isSelected =
                            attendanceSortBy === option.sortBy &&
                            attendanceOrder === option.order;

                          return (
                            <button
                              key={`${option.sortBy}-${option.order}`}
                              type="button"
                              onClick={() =>
                                void handleAttendanceSortChange(
                                  option.sortBy,
                                  option.order,
                                )
                              }
                              className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition ${
                                isSelected
                                  ? "bg-blue-50 font-semibold text-blue-700"
                                  : "text-slate-700 hover:bg-slate-50"
                              }`}
                            >
                              <span>{option.label}</span>
                              {isSelected && (
                                <svg
                                  className="h-4 w-4"
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
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
              {attendanceError && (
                <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {attendanceError}
                </div>
              )}

              {attendanceLoading ? (
                <div className="space-y-3 animate-pulse">
                  {[1, 2, 3].map((item) => (
                    <div
                      key={item}
                      className="h-24 rounded-2xl border border-slate-100 bg-slate-50"
                    />
                  ))}
                </div>
              ) : attendanceRecords.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                  No attendance records found for this event yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {attendanceRecords.map((record) => {
                    const isRecentlyMarked =
                      Date.now() - new Date(record.markedAt).getTime() <=
                      RECENT_MARK_THRESHOLD_MS;

                    return (
                      <article
                        key={`${record.memberId}-${record.markedAt}`}
                        className={`rounded-3xl border p-4 shadow-sm transition ${
                          !record.isActive
                            ? "border-slate-200 bg-slate-50 text-slate-500"
                            : isRecentlyMarked
                              ? "border-blue-200 bg-blue-50/70"
                              : "border-slate-100 bg-white"
                        }`}
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="truncate text-sm font-semibold text-slate-900">
                                {record.name}
                              </h3>
                              {!record.isActive && (
                                <span className="rounded-full bg-slate-200 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                                  Inactive
                                </span>
                              )}
                              {isRecentlyMarked && record.isActive && (
                                <span className="rounded-full bg-blue-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-blue-700">
                                  Recent
                                </span>
                              )}
                            </div>
                            <p className="mt-1 text-sm text-slate-500">
                              {record.uniqueId}
                            </p>
                            <p className="mt-1 text-sm text-slate-500">
                              {record.phone || "Phone unavailable"}
                            </p>
                          </div>

                          <div className="rounded-2xl bg-slate-100 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 sm:min-w-[180px] sm:text-right">
                            <p>Marked present</p>
                            <p className="mt-1 text-sm normal-case tracking-normal text-slate-900">
                              {formatDateTime(record.markedAt)}
                            </p>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="border-t border-slate-100 px-4 py-4 sm:px-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-slate-500">
                  Page {attendancePage} of {attendanceTotalPages}
                </p>
                <div className="grid grid-cols-2 gap-3 sm:flex sm:items-center">
                  <button
                    type="button"
                    onClick={() => void fetchAttendancePage(attendancePage - 1)}
                    disabled={attendancePage <= 1 || attendanceLoading}
                    className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => void fetchAttendancePage(attendancePage + 1)}
                    disabled={
                      attendancePage >= attendanceTotalPages ||
                      attendanceLoading
                    }
                    className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {isAddAttendeeOpen && event && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/50 px-4 py-4 sm:items-center sm:py-6">
          <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="border-b border-slate-100 px-4 py-4 sm:px-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600">
                    Add Attendee
                  </p>
                  <h2 className="mt-2 text-xl font-bold text-slate-900">
                    {event.title}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Manually record attendance for this event.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsAddAttendeeOpen(false);
                    setAddAttendeeFeedback(null);
                    setAddAttendeeError("");
                  }}
                  className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  aria-label="Close add attendee modal"
                >
                  ✕
                </button>
              </div>

              <div className="mt-4 flex rounded-full bg-slate-200 p-1">
                {(["QR", "MANUAL"] as AddAttendanceTab[]).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setAddAttendeeTab(tab)}
                    className={`w-full rounded-full py-2 text-sm font-semibold transition-colors ${
                      addAttendeeTab === tab
                        ? "bg-white text-slate-900"
                        : "text-slate-500"
                    }`}
                  >
                    {tab === "QR" ? "QR Scan" : "Manual"}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
              {addAttendeeError && (
                <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {addAttendeeError}
                </div>
              )}

              {addAttendeeFeedback && (
                <div
                  className={`mb-4 rounded-2xl border px-4 py-3 text-sm ${
                    addAttendeeFeedback.tone === "success"
                      ? "border-green-200 bg-green-50 text-green-800"
                      : addAttendeeFeedback.tone === "error"
                        ? "border-red-200 bg-red-50 text-red-700"
                        : "border-blue-200 bg-blue-50 text-blue-800"
                  }`}
                >
                  <p className="font-semibold">{addAttendeeFeedback.title}</p>
                  {addAttendeeFeedback.description && (
                    <p className="mt-1">{addAttendeeFeedback.description}</p>
                  )}
                </div>
              )}

              {addAttendeeTab === "QR" && (
                <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="relative mx-auto max-w-sm">
                    <QrAttendanceScanner
                      eventId={event.id}
                      allowOverride
                      onScanSuccess={async (result) => {
                        setAddAttendeeFeedback({
                          tone: "success",
                          title: "Attendance recorded",
                          description: result.memberName
                            ? `${result.memberName} has been added.`
                            : undefined,
                        });
                        await fetchAttendancePage(1, { preferCache: false });
                        setAttendancePage(1);
                      }}
                      onApiError={(err) => {
                        setAddAttendeeError(
                          err?.response?.data?.error ||
                            err?.response?.data?.message ||
                            "Failed to mark attendance.",
                        );
                      }}
                      resolveMemberId={(code) => {
                        const match = addMembers.find(
                          (m) => m.uniqueId === code || m.id === code,
                        );
                        return match ? match.id : code;
                      }}
                    />
                  </div>
                  <p className="mt-4 text-center text-sm text-slate-500">
                    Point the camera at a member's QR code to mark attendance.
                  </p>
                </div>
              )}

              {addAttendeeTab === "MANUAL" && (
                <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-4">
                    <input
                      type="text"
                      placeholder="Search members..."
                      value={addMembersSearch}
                      onChange={(e) => setAddMembersSearch(e.target.value)}
                      className="w-full rounded-full border border-slate-200 bg-slate-50 py-2 pl-4 pr-4 text-sm text-slate-800 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
                    />
                  </div>

                  {addMembersLoading ? (
                    <div className="text-sm text-slate-500">
                      Loading members…
                    </div>
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {filteredAddMembers.map((member) => {
                        const isPresent = presentMemberIds.has(member.id);
                        const isInactive = member.isActive === false;
                        const canAdd = !isPresent && !isInactive;

                        return (
                          <li
                            key={member.id}
                            className="flex items-center justify-between py-3"
                          >
                            <div>
                              <p
                                className={`font-medium ${
                                  isInactive
                                    ? "text-slate-400"
                                    : "text-slate-800"
                                }`}
                              >
                                {member.name}
                              </p>
                              <p className="text-sm text-slate-500">
                                {member.uniqueId}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                handleAddAttendance(member.id, "MANUAL")
                              }
                              disabled={!canAdd || addAttendeeLoading}
                              className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                                isPresent
                                  ? "bg-green-100 text-green-700"
                                  : isInactive
                                    ? "cursor-not-allowed bg-slate-100 text-slate-400"
                                    : "bg-blue-50 text-blue-600 hover:bg-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                              }`}
                            >
                              {isPresent ? "Present" : "Add"}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </div>
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
