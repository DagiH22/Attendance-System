import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import type { DashboardEvent } from "../types/events";

type StatusFilter = "ALL" | "ACTIVE" | "UPCOMING" | "COMPLETED";
type TypeFilter = "ALL" | "WEEKLY" | "MONTHLY" | "ONE_TIME";
type SortOption =
  | "NEXT_EVENT"
  | "RECENTLY_CREATED"
  | "HIGHEST_ATTENDANCE"
  | "LOWEST_ATTENDANCE";

const EventsPage: React.FC = () => {
  const [events, setEvents] = useState<DashboardEvent[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  // Filters and Sorting State
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("ALL");
  const [sortBy, setSortBy] = useState<SortOption>("NEXT_EVENT");
  const [isSortModalOpen, setIsSortModalOpen] = useState(false);

  // Dropdown states for desktop
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState(false);
  const [isTypeDropdownOpen, setIsTypeDropdownOpen] = useState(false);

  // Click outside handlers ref
  const sortDropdownRef = React.useRef<HTMLDivElement>(null);
  const statusDropdownRef = React.useRef<HTMLDivElement>(null);
  const typeDropdownRef = React.useRef<HTMLDivElement>(null);

  const navigate = useNavigate();

  useEffect(() => {
    fetchEvents();

    // Close dropdowns when clicking outside
    const handleClickOutside = (event: MouseEvent) => {
      if (
        sortDropdownRef.current &&
        !sortDropdownRef.current.contains(event.target as Node)
      ) {
        setIsSortModalOpen(false);
      }
      if (
        statusDropdownRef.current &&
        !statusDropdownRef.current.contains(event.target as Node)
      ) {
        setIsStatusDropdownOpen(false);
      }
      if (
        typeDropdownRef.current &&
        !typeDropdownRef.current.contains(event.target as Node)
      ) {
        setIsTypeDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const fetchEvents = async () => {
    try {
      setLoading(true);
      const response = await api.get("/events");
      const fetchedEvents = response.data?.events || [];

      if (Array.isArray(fetchedEvents)) {
        const transformedEvents: DashboardEvent[] = fetchedEvents.map(
          (event: any) => {
            const now = new Date();
            const eventStart = new Date(event.startTime);
            const eventEnd = event.endTime
              ? new Date(event.endTime)
              : new Date(eventStart.getTime() + 2 * 60 * 60 * 1000);

            let status: DashboardEvent["status"] = "UPCOMING";

            if (now > eventEnd || event.isActive === false) {
              status = "COMPLETED";
            } else if (now >= eventStart && now <= eventEnd) {
              status = "ACTIVE";
            } else {
              status = "UPCOMING";
            }

            return {
              id: event.id,
              title: event.title,
              description: event.description || "",
              startTime: event.startTime,
              endTime: event.endTime,
              status,
              eventType: event.type as DashboardEvent["eventType"],
              createdBy: {
                id: event.admin?.id || event.createdBy?.id || "unknown-admin",
                name:
                  event.admin?.name || event.createdBy?.name || "Admin User",
              },
              attendanceCount: event._count?.attendances || 0,
              createdAt: event.createdAt || eventStart.toISOString(),
              totalMembers: event.totalMembers || 0,
            };
          },
        );
        setEvents(transformedEvents);
      }
    } catch (err: any) {
      console.error("Error fetching events:", err);
      setError(
        err.response?.data?.message ||
          err.response?.data?.error ||
          "Failed to load events.",
      );
    } finally {
      setLoading(false);
    }
  };

  // Filter and Sort Logic
  const filteredEvents = events.filter((e) => {
    const matchStatus = statusFilter === "ALL" || e.status === statusFilter;
    const matchType = typeFilter === "ALL" || e.eventType === typeFilter;
    return matchStatus && matchType;
  });

  const sortedAndFilteredEvents = [...filteredEvents].sort((a, b) => {
    switch (sortBy) {
      case "NEXT_EVENT":
        return (
          new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
        );
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

  // Helpers
  const formatTime = (isoString: string) => {
    return new Date(isoString).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatDate = (isoString: string) => {
    return new Date(isoString).toLocaleDateString([], {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const getStatusColor = (status: DashboardEvent["status"]) => {
    if (status === "ACTIVE")
      return "bg-green-100 text-green-800 border-green-200";
    if (status === "UPCOMING")
      return "bg-blue-100 text-blue-800 border-blue-200";
    return "bg-gray-100 text-gray-800 border-gray-200";
  };

  const getSortLabel = (sortValue: SortOption) => {
    switch (sortValue) {
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

  return (
    <div className="min-h-screen bg-gray-50 pb-24 relative">
      {/* Header */}
      <header className="bg-white px-4 pt-6 pb-4 border-b border-gray-200 sticky top-0 z-20">
        <div className="flex justify-between items-center mb-4 max-w-4xl mx-auto w-full">
          <h1 className="text-2xl font-bold text-gray-900">Events</h1>
          <button
            onClick={() => {
              localStorage.removeItem("token");
              navigate("/login");
            }}
            className="text-sm font-medium text-red-600 bg-red-50 px-3 py-1.5 rounded-md"
          >
            Logout
          </button>
        </div>

        <div className="max-w-4xl mx-auto w-full">
          {/* Mobile view filters (visible only on small screens) */}
          <div className="md:hidden">
            <div className="flex overflow-x-auto no-scrollbar gap-2 mb-3 pb-1">
              {["ALL", "ACTIVE", "UPCOMING", "COMPLETED"].map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status as StatusFilter)}
                  className={`whitespace-nowrap px-4 py-1.5 rounded-full text-sm font-medium transition-colors border ${
                    statusFilter === status
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {status === "ALL"
                    ? "All Status"
                    : status.charAt(0) + status.slice(1).toLowerCase()}
                </button>
              ))}
            </div>

            <div className="flex overflow-x-auto no-scrollbar gap-2 mb-3 pb-1">
              {["ALL", "WEEKLY", "MONTHLY", "ONE_TIME"].map((type) => (
                <button
                  key={type}
                  onClick={() => setTypeFilter(type as TypeFilter)}
                  className={`whitespace-nowrap px-4 py-1.5 rounded-full text-sm font-medium transition-colors border ${
                    typeFilter === type
                      ? "bg-gray-800 text-white border-gray-800"
                      : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {type === "ALL"
                    ? "All Types"
                    : type
                        .replace("_", "-")
                        .split("_")
                        .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
                        .join(" ")}
                </button>
              ))}
            </div>
          </div>

          {/* Desktop view filters (dropdowns) */}
          <div className="hidden md:flex items-center gap-3 mb-4">
            <div className="relative" ref={statusDropdownRef}>
              <button
                onClick={() => setIsStatusDropdownOpen(!isStatusDropdownOpen)}
                className="flex items-center justify-between min-w-[140px] px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <span>
                  {statusFilter === "ALL"
                    ? "All Status"
                    : statusFilter.charAt(0) +
                      statusFilter.slice(1).toLowerCase()}
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
                  ></path>
                </svg>
              </button>

              {isStatusDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-50 overflow-hidden py-1">
                  {["ALL", "ACTIVE", "UPCOMING", "COMPLETED"].map((status) => (
                    <button
                      key={status}
                      onClick={() => {
                        setStatusFilter(status as StatusFilter);
                        setIsStatusDropdownOpen(false);
                      }}
                      className={`w-full text-left px-4 py-2 text-sm ${statusFilter === status ? "bg-blue-50 text-blue-700 font-semibold" : "text-gray-700 hover:bg-gray-50"}`}
                    >
                      {status === "ALL"
                        ? "All Status"
                        : status.charAt(0) + status.slice(1).toLowerCase()}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="relative" ref={typeDropdownRef}>
              <button
                onClick={() => setIsTypeDropdownOpen(!isTypeDropdownOpen)}
                className="flex items-center justify-between min-w-[140px] px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <span>
                  {typeFilter === "ALL"
                    ? "All Types"
                    : typeFilter
                        .replace("_", "-")
                        .split("_")
                        .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
                        .join(" ")}
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
                  ></path>
                </svg>
              </button>

              {isTypeDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-50 overflow-hidden py-1">
                  {["ALL", "WEEKLY", "MONTHLY", "ONE_TIME"].map((type) => (
                    <button
                      key={type}
                      onClick={() => {
                        setTypeFilter(type as TypeFilter);
                        setIsTypeDropdownOpen(false);
                      }}
                      className={`w-full text-left px-4 py-2 text-sm ${typeFilter === type ? "bg-gray-100 text-gray-900 font-semibold" : "text-gray-700 hover:bg-gray-50"}`}
                    >
                      {type === "ALL"
                        ? "All Types"
                        : type
                            .replace("_", "-")
                            .split("_")
                            .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
                            .join(" ")}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Sort By Toggle & Info */}
          <div className="flex justify-between items-center mt-2 border-t md:border-none pt-3 md:pt-0">
            <span className="text-sm text-gray-500 font-medium">
              {sortedAndFilteredEvents.length} events found
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
                {/* On desktop show current sort, on mobile just "Sort" */}
                <span className="hidden md:inline mr-1">Sort by:</span>
                <span className="md:font-semibold">{getSortLabel(sortBy)}</span>
              </button>

              {/* Dropdown list (replaces the modal) */}
              {isSortModalOpen && (
                <div className="absolute top-full right-0 mt-2 w-56 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden py-1 animate-in fade-in">
                  <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 md:hidden flex justify-between items-center">
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">
                      Sort Events
                    </span>
                    <button
                      onClick={() => setIsSortModalOpen(false)}
                      className="text-gray-400 hover:text-gray-600"
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
                          d="M6 18L18 6M6 6l12 12"
                        ></path>
                      </svg>
                    </button>
                  </div>
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
                              ></path>
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
      </header>

      {/* Main Content */}
      <div className="p-4 space-y-4 max-w-4xl mx-auto">
        {loading ? (
          <div className="flex flex-col items-center py-12">
            <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            <p className="mt-4 text-gray-500 text-sm font-medium">
              Loading events...
            </p>
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm text-center">
            {error}
          </div>
        ) : sortedAndFilteredEvents.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-xl shadow-sm border border-gray-100">
            <p className="text-gray-500 text-sm">
              No events match your selected filters.
            </p>
            <button
              onClick={() => {
                setStatusFilter("ALL");
                setTypeFilter("ALL");
              }}
              className="mt-3 text-blue-600 text-sm font-medium hover:underline"
            >
              Clear filters
            </button>
          </div>
        ) : (
          sortedAndFilteredEvents.map((event) => (
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
                  navigate(`/events/${event.id}`, {
                    state: { event },
                  });
                }
              }}
              className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 transition-shadow hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
            >
              <div className="flex justify-between items-start mb-2 gap-3">
                <h3 className="text-lg font-bold text-gray-900 leading-tight">
                  {event.title}
                </h3>
                <span
                  className={`px-2.5 py-1 text-xs font-bold rounded-full border whitespace-nowrap ${getStatusColor(event.status)}`}
                >
                  {event.status}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200">
                  {event.eventType.replace("_", " ")}
                </span>
                {event.status === "COMPLETED" && (
                  <span className="text-xs font-medium px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 flex items-center border border-purple-100">
                    <svg
                      className="w-3.5 h-3.5 mr-1"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z"></path>
                    </svg>
                    {event.attendanceCount} attended
                  </span>
                )}
              </div>

              <div className="space-y-1.5 text-sm text-gray-600 mb-4 bg-gray-50 p-3 rounded-lg border border-gray-100">
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
                    ></path>
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
                    ></path>
                  </svg>
                  {formatTime(event.startTime)} - {formatTime(event.endTime)}
                </div>
              </div>

              <button
                disabled={event.status !== "ACTIVE"}
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/events/${event.id}/attendance`);
                }}
                className={`w-full py-2.5 px-4 rounded-lg font-semibold text-sm transition-colors duration-200 active:scale-[0.98] ${
                  event.status === "ACTIVE"
                    ? "bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
                    : "bg-gray-100 text-gray-400 cursor-not-allowed"
                }`}
              >
                {event.status === "ACTIVE"
                  ? "Take Attendance"
                  : "Attendance Unavailable"}
              </button>
            </div>
          ))
        )}
      </div>

      {/* Floating Action Button */}
      <button
        onClick={() => navigate("/events/create")}
        className="fixed bottom-6 right-4 md:bottom-8 md:right-8 bg-blue-600 shadow-lg text-white rounded-full h-14 px-5 flex items-center justify-center z-10 font-medium active:scale-95 transition-transform"
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
          ></path>
        </svg>
        Create Event
      </button>

      {/* Global override for hiding scrollbar visually in pill filters while retaining functionality */}
      <style>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
};

export default EventsPage;
