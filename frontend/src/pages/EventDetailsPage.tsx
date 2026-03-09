import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import api from "../lib/api";
import type { DashboardEvent } from "../types/events";

type LocationState = {
  event?: DashboardEvent;
};

const EventDetailsPage: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const state = location.state as LocationState | null;

  const [event, setEvent] = useState<DashboardEvent | null>(
    state?.event ?? null,
  );
  const [loading, setLoading] = useState<boolean>(!state?.event);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (state?.event || !id) {
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

        const now = new Date();
        const eventStart = new Date(rawEvent.startTime);
        const eventEnd = rawEvent.endTime
          ? new Date(rawEvent.endTime)
          : new Date(eventStart.getTime() + 2 * 60 * 60 * 1000);

        let status: DashboardEvent["status"] = "UPCOMING";

        if (rawEvent.isActive === false) {
          status = "DEACTIVATED";
        } else if (now >= eventStart && now <= eventEnd) {
          status = "ACTIVE";
        } else if (now > eventEnd) {
          status = "PAST";
        } else {
          status = "UPCOMING";
        }

        setEvent({
          id: rawEvent.id,
          title: rawEvent.title,
          description: rawEvent.description || "No description provided.",
          startTime: rawEvent.startTime,
          endTime: rawEvent.endTime,
          status,
          eventType: rawEvent.type,
          createdAt: rawEvent.createdAt || eventStart.toISOString(),
          createdBy: {
            id: rawEvent.admin?.id || rawEvent.createdBy?.id || "unknown-admin",
            name:
              rawEvent.admin?.name || rawEvent.createdBy?.name || "Admin User",
          },
          attendanceCount:
            rawEvent._count?.attendances || rawEvent.attendanceCount || 0,
          totalMembers: rawEvent.totalMembers || 0,
        });
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
  }, [id, state?.event]);

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

  const formatDate = (value: string) =>
    new Date(value).toLocaleDateString([], {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });

  const formatTime = (value: string) =>
    new Date(value).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

  const formatCreatedDate = (value: string) =>
    new Date(value).toLocaleString([], {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

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
    if (
      !event ||
      event.status === "UPCOMING" ||
      event.status === "DEACTIVATED"
    ) {
      return;
    }

    navigate(`/events/${event.id}/attendance`, {
      state: { event },
    });
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

      <div className="fixed inset-x-0 bottom-0 border-t border-gray-200 bg-white/95 px-4 py-4 backdrop-blur sm:px-6">
        <div className="mx-auto max-w-3xl">
          <button
            type="button"
            onClick={handleAction}
            disabled={
              event.status === "UPCOMING" || event.status === "DEACTIVATED"
            }
            className={`w-full rounded-xl px-4 py-3.5 text-sm font-semibold shadow-sm transition-colors ${
              event.status === "ACTIVE"
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : event.status === "PAST"
                  ? "bg-gray-900 text-white hover:bg-gray-800"
                  : "bg-gray-100 text-gray-400 cursor-not-allowed"
            }`}
          >
            {getActionLabel(event.status)}
          </button>
        </div>
      </div>
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
