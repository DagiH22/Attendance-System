import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import api from "../lib/api";
import formatDate, { formatDateTime } from "../lib/formatDate";
import type { DashboardEvent } from "../types/events";
import { useAuth } from "../contexts/AuthContext";

type LocationState = {
  event?: DashboardEvent;
};

type EditableStatusOption = "UPCOMING" | "DEACTIVATED";

const EDITABLE_STATUS_OPTIONS: Array<{
  value: EditableStatusOption;
  label: string;
}> = [
  { value: "UPCOMING", label: "Upcoming" },
  { value: "DEACTIVATED", label: "Deactivated" },
];

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
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState(false);
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [actionError, setActionError] = useState("");
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

        setEvent(mapEventToDashboardEvent(rawEvent));
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

  const attendanceStats = useMemo(() => {
    const totalMembers = event?.totalMembers ?? 0;
    const attendees = event?.attendanceCount ?? 0;
    const absentees = Math.max(totalMembers - attendees, 0);
    const attendancePercentage =
      totalMembers > 0 ? Math.round((attendees / totalMembers) * 100) : 0;

    return {
      totalMembers,
      attendees,
      absentees,
      attendancePercentage,
    };
  }, [event]);

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
    if (!event || !event.attendanceOpen) {
      return;
    }

    navigate(`/events/${event.id}/attendance`, {
      state: { event },
    });
  };

  const isSuperAdmin = admin?.role === "SUPER_ADMIN";
  const hasStarted = event
    ? new Date(event.startTime).getTime() <= Date.now()
    : false;
  const canEdit = Boolean(isSuperAdmin && event && !hasStarted);
  const canDelete = Boolean(isSuperAdmin && event && !hasStarted);

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

    if (parsedStartTime.getTime() <= Date.now()) {
      setActionError(
        "Editing is only allowed for events that have not started yet.",
      );
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

            {isSuperAdmin && (
              <div className="mt-5 border-t border-gray-100 pt-4">
                {!canEdit && (
                  <p className="w-full text-sm text-gray-500">
                    Editing and deletion are only available before the event
                    starts.
                  </p>
                )}
              </div>
            )}

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
            disabled={!event.attendanceOpen}
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
