import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";

export interface EventType {
  id: string;
  title: string;
  description?: string;
  eventDate: string;
  startTime: string;
  endTime: string;
  status: "UPCOMING" | "ACTIVE" | "CLOSED";
}

const EventsPage: React.FC = () => {
  const [events, setEvents] = useState<EventType[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const navigate = useNavigate();

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const response = await api.get("/events");
        // Backend returns { events: [...] }
        const fetchedEvents = response.data?.events || [];

        // Ensure fetchedEvents is an array to prevent "map is not a function" error
        if (Array.isArray(fetchedEvents)) {
          // Transform backend data to match frontend EventType
          const transformedEvents = fetchedEvents.map((event: any) => {
            // Determine status based on dates
            const now = new Date();
            const eventStart = new Date(event.startTime);
            const eventEnd = event.endTime
              ? new Date(event.endTime)
              : new Date(eventStart.getTime() + 2 * 60 * 60 * 1000); // assume 2h if no end time, or just use date

            let status: "UPCOMING" | "ACTIVE" | "CLOSED" = "UPCOMING";

            if (now > eventEnd) {
              status = "CLOSED";
            } else if (now >= eventStart && now <= eventEnd) {
              status = "ACTIVE";
            } else {
              status = "UPCOMING";
            }

            // If the backend has an explicit isActive flag that is false, consider it CLOSED or handle separately?
            // The prompt requirements said status: "UPCOMING" | "ACTIVE" | "CLOSED".
            // The DB has "isActive" boolean. Often "isActive=false" means cancelled/deleted soft.
            // For now, let's stick to time-based status but respect explicit deactivation.
            if (event.isActive === false) {
              status = "CLOSED";
            }

            return {
              ...event,
              status,
            };
          });
          setEvents(transformedEvents);
        } else {
          console.error(
            "Unexpected response format: events is not an array",
            response.data,
          );
          setEvents([]);
        }
      } catch (err: any) {
        console.error("Error fetching events:", err);
        setError(
          err.response?.data?.message ||
            "Failed to load events. Please try again.",
        );
      } finally {
        setLoading(false);
      }
    };

    fetchEvents();
  }, []);

  const getStatusBadgeStyles = (status: EventType["status"]) => {
    switch (status) {
      case "ACTIVE":
        return "bg-green-100 text-green-800 border-green-200";
      case "UPCOMING":
        return "bg-blue-100 text-blue-800 border-blue-200";
      case "CLOSED":
        return "bg-gray-100 text-gray-800 border-gray-200";
      default:
        return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="mt-4 text-gray-500 font-medium">Loading events...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 pb-24 relative md:p-6 lg:p-8">
      <div className="max-w-3xl mx-auto w-full">
        {/* Header */}
        <header className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">
            Events
          </h1>
          <button
            onClick={() => {
              localStorage.removeItem("token");
              navigate("/login");
            }}
            className="text-sm font-medium text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-md transition-colors"
          >
            Logout
          </button>
        </header>

        {/* Error State */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6 shadow-sm">
            {error}
          </div>
        )}

        {/* Empty State */}
        {!error && events.length === 0 && (
          <div className="text-center text-gray-500 mt-10 py-12 px-4 bg-white rounded-xl shadow-sm border border-gray-100">
            <svg
              className="w-12 h-12 mx-auto text-gray-300 mb-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1"
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              ></path>
            </svg>
            <p className="text-lg font-medium text-gray-900">No events found</p>
            <p className="mt-1">Create an event to get started.</p>
          </div>
        )}

        {/* Events List */}
        <div className="space-y-4">
          {events.map((event) => (
            <div
              key={event.id}
              className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-shadow"
            >
              <div className="p-5 md:p-6">
                <div className="flex justify-between items-start mb-3 gap-2">
                  <h2 className="text-xl font-semibold text-gray-900 leading-tight line-clamp-2">
                    {event.title}
                  </h2>
                  <span
                    className={`px-2.5 py-1 text-xs font-bold rounded-full border whitespace-nowrap ${getStatusBadgeStyles(event.status)}`}
                  >
                    {event.status}
                  </span>
                </div>

                {event.description && (
                  <p className="text-gray-600 mb-4 text-sm md:text-base line-clamp-2">
                    {event.description}
                  </p>
                )}

                <div className="space-y-2 mb-6 text-sm md:text-base text-gray-600">
                  <div className="flex items-center">
                    <svg
                      className="w-4 h-4 md:w-5 md:h-5 mr-2.5 text-gray-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                      ></path>
                    </svg>
                    {formatDate(event.eventDate)}
                  </div>
                  <div className="flex items-center">
                    <svg
                      className="w-4 h-4 md:w-5 md:h-5 mr-2.5 text-gray-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                      ></path>
                    </svg>
                    {/* formatting time in case DB stores full ISO string or just HH:mm */}
                    {event.startTime.length > 5
                      ? event.startTime.slice(0, 5)
                      : event.startTime}
                    {" - "}
                    {event.endTime.length > 5
                      ? event.endTime.slice(0, 5)
                      : event.endTime}
                  </div>
                </div>

                <button
                  disabled={event.status !== "ACTIVE"}
                  onClick={() => navigate(`/events/${event.id}/attendance`)}
                  className={`w-full py-3.5 px-4 rounded-lg font-semibold text-base transition-colors duration-200 active:scale-[0.98] ${
                    event.status === "ACTIVE"
                      ? "bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
                      : "bg-gray-100 text-gray-400 cursor-not-allowed"
                  }`}
                >
                  Take Attendance
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Floating Action Button (FAB) */}
      <button
        onClick={() => navigate("/events/create")}
        className="fixed bottom-6 right-4 md:bottom-8 md:right-8 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-full p-4 shadow-lg hover:shadow-xl transition-all flex items-center justify-center z-10 font-semibold active:scale-95"
        style={{ paddingLeft: "1.25rem", paddingRight: "1.25rem" }}
        aria-label="Create Event"
      >
        <svg
          className="w-5 h-5 mr-2"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M12 4v16m8-8H4"
          ></path>
        </svg>
        Create Event
      </button>
    </div>
  );
};

export default EventsPage;
