import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import formatDate from "../lib/formatDate";

const CreateEvent: React.FC = () => {
  const navigate = useNavigate();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const descriptionRef = useRef<HTMLTextAreaElement | null>(null);

  const MAX_DESCRIPTION_HEIGHT = 240; // (px)

  const adjustDescriptionHeight = () => {
    const el = descriptionRef.current;
    if (!el) return;
    // reset height to allow shrink
    el.style.height = "auto";
    const needed = el.scrollHeight;
    if (needed <= MAX_DESCRIPTION_HEIGHT) {
      el.style.height = `${needed}px`;
      el.style.overflowY = "hidden";
    } else {
      el.style.height = `${MAX_DESCRIPTION_HEIGHT}px`;
      el.style.overflowY = "auto";
    }
  };

  useEffect(() => {
    // adjust when content changes from code or initial render
    adjustDescriptionHeight();
  }, [description]);
  const [type, setType] = useState("one-time");
  const [eventDate, setEventDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [endDate, setEndDate] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [dateError, setDateError] = useState("");
  const [timeError, setTimeError] = useState("");
  const [locationError, setLocationError] = useState("");

  // Get today's string format (YYYY-MM-DD) for min date constraint
  const todayStr = new Date().toLocaleDateString("en-CA"); // 'en-CA' outputs YYYY-MM-DD

  // Custom dropdown state to keep the options list width equal to the control
  const typeWrapperRef = useRef<HTMLDivElement | null>(null);
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [typeMenuWidth, setTypeMenuWidth] = useState<number | undefined>(
    undefined,
  );

  useEffect(() => {
    const updateWidth = () => {
      if (typeWrapperRef.current) {
        const rect = typeWrapperRef.current.getBoundingClientRect();
        setTypeMenuWidth(rect.width);
      }
    };

    updateWidth();
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, []);

  // Close on outside click
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!typeWrapperRef.current) return;
      if (!typeWrapperRef.current.contains(e.target as Node)) {
        setTypeMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // When type or eventDate changes, auto-set endDate if weekly
  React.useEffect(() => {
    if (type === "weekly" && eventDate) {
      const start = new Date(eventDate);
      if (!isNaN(start.getTime())) {
        const end = new Date(start.getTime());
        end.setMonth(end.getMonth() + 1);
        setEndDate(end.toLocaleDateString("en-CA"));
      }
    }
  }, [type, eventDate]);

  // Validation logic
  const validateForm = () => {
    let isValid = true;
    setDateError("");
    setTimeError("");
    setLocationError("");

    if (!eventDate) return false;

    // Event Date Validation (no past dates)
    // We add timezone offset handling to compare dates directly or use the string comparison
    if (eventDate < todayStr) {
      setDateError("Event date cannot be in the past");
      isValid = false;
    }

    if (!startTime || !endTime) return false;

    // Location must be provided
    if (!location || location.trim() === "") {
      setLocationError("Location is required");
      isValid = false;
    }

    // If today, start time cannot be in the past
    if (eventDate === todayStr) {
      const now = new Date();
      const currentHoursStr = now.getHours().toString().padStart(2, "0");
      const currentMinutesStr = now.getMinutes().toString().padStart(2, "0");
      const currentTimeStr = `${currentHoursStr}:${currentMinutesStr}`;

      if (startTime < currentTimeStr) {
        setTimeError("Start time cannot be in the past");
        isValid = false;
      }
    }

    // End time must be after start time
    if (endTime <= startTime) {
      setTimeError("End time must be after start time");
      isValid = false;
    }

    return isValid;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;
    setLoading(true);
    setError("");
    setSuccess("");

    try {
      // combine the date and time strings into an iso format
      // E.g., eventDate "2026-03-10", startTime "14:30" => "2026-03-10T14:30:00.000Z"
      const startDateTime = new Date(`${eventDate}T${startTime}`).toISOString();
      const endDateTime = new Date(`${eventDate}T${endTime}`).toISOString();

      let backendType = "ONE_TIME";
      if (type === "weekly") backendType = "WEEKLY";
      if (type === "custom") backendType = "MONTHLY";

      const payload = {
        title,
        description,
        type: backendType,
        eventDate: new Date(eventDate).toISOString(),
        startTime: startDateTime,
        endTime: endDateTime,
        location: location.trim(),
        ...((type === "weekly" || type === "custom") && endDate
          ? { endDate: new Date(endDate).toISOString() }
          : {}),
      };

      await api.post("/events", payload);

      setSuccess("Event created successfully!");

      // Redirect after a short delay so the user sees the success message
      setTimeout(() => {
        navigate("/events");
      }, 1000);
    } catch (err: any) {
      console.error("Error creating event:", err);
      setError(
        err.response?.data?.error ||
          err.response?.data?.message ||
          "Failed to create event. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-start justify-center p-4 md:p-6 lg:p-8">
      <div className="bg-white w-full max-w-lg rounded-xl shadow-sm border border-gray-100 p-5 md:p-8 mt-4 md:mt-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Create Event</h1>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6 text-sm">
            {error}
          </div>
        )}

        {success && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-6 text-sm font-medium">
            {success}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Title */}
          <div>
            <label
              htmlFor="title"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Event Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="title"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Sunday Service"
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
            />
          </div>

          {/* Description */}
          <div>
            <label
              htmlFor="description"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Description
            </label>
            <textarea
              id="description"
              ref={descriptionRef}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onInput={adjustDescriptionHeight}
              placeholder="Add some details about the event..."
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors resize-none"
              style={{ maxHeight: `${MAX_DESCRIPTION_HEIGHT}px` }}
            />
          </div>

          {/* Location */}
          <div>
            <label
              htmlFor="location"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Location
            </label>
            <input
              type="text"
              id="location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Main Hall, Building A"
              required
              className={`w-full px-4 py-2.5 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${locationError ? "border-red-300 bg-red-50" : "border-gray-300"}`}
            />
            {locationError && (
              <p className="mt-1 text-xs text-red-600 font-medium">
                {locationError}
              </p>
            )}
          </div>

          {/* Event Type */}
          <div>
            <label
              htmlFor="type"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Event Type
            </label>
            {/* Custom select: keeps options list width equal to control width on mobile */}
            <div ref={typeWrapperRef} className="relative w-full">
              <button
                type="button"
                onClick={() => setTypeMenuOpen((s) => !s)}
                aria-haspopup="listbox"
                aria-expanded={typeMenuOpen}
                className="w-full text-left px-4 py-2.5 bg-white border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors flex items-center justify-between"
              >
                <span>
                  {type === "one-time"
                    ? "One-time Event"
                    : type === "weekly"
                      ? "Weekly"
                      : "Custom / Monthly"}
                </span>
                <svg
                  className="w-4 h-4 text-gray-500"
                  viewBox="0 0 20 20"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M5 7l5 5 5-5"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>

              {typeMenuOpen && (
                <ul
                  role="listbox"
                  tabIndex={-1}
                  className="absolute left-0 mt-1 z-50 bg-white border border-gray-200 rounded shadow-sm overflow-hidden"
                  style={{ width: typeMenuWidth || "100%" }}
                >
                  <li
                    role="option"
                    className="px-4 py-2 hover:bg-blue-50 text-sm cursor-pointer"
                    onClick={() => {
                      setType("one-time");
                      setTypeMenuOpen(false);
                    }}
                  >
                    One-time Event
                  </li>
                  <li
                    role="option"
                    className="px-4 py-2 hover:bg-blue-50 text-sm cursor-pointer"
                    onClick={() => {
                      setType("weekly");
                      setTypeMenuOpen(false);
                    }}
                  >
                    Weekly
                  </li>
                  <li
                    role="option"
                    className="px-4 py-2 hover:bg-blue-50 text-sm cursor-pointer"
                    onClick={() => {
                      setType("custom");
                      setTypeMenuOpen(false);
                    }}
                  >
                    Custom / Monthly
                  </li>
                </ul>
              )}
            </div>
          </div>

          {/* Date & Time Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label
                htmlFor="eventDate"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Event Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                id="eventDate"
                required
                min={todayStr}
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                className={`w-full px-4 py-2.5 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${dateError ? "border-red-300 bg-red-50" : "border-gray-300"}`}
              />
              {dateError && (
                <p className="mt-1 text-xs text-red-600 font-medium">
                  {dateError}
                </p>
              )}
            </div>

            {(type === "weekly" || type === "custom") && (
              <div>
                <label
                  htmlFor="endDate"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  End Date <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  id="endDate"
                  min={eventDate || todayStr}
                  required={type === "weekly" || type === "custom"}
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                />
              </div>
            )}

            <div>
              <label
                htmlFor="startTime"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Start Time <span className="text-red-500">*</span>
              </label>
              <input
                type="time"
                id="startTime"
                required
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className={`w-full px-4 py-2.5 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${timeError ? "border-red-300 bg-red-50" : "border-gray-300"}`}
              />
            </div>

            <div>
              <label
                htmlFor="endTime"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                End Time <span className="text-red-500">*</span>
              </label>
              <input
                type="time"
                id="endTime"
                required
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className={`w-full px-4 py-2.5 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${timeError ? "border-red-300 bg-red-50" : "border-gray-300"}`}
              />
            </div>
            {timeError && (
              <div className="md:col-span-2">
                <p className="text-xs text-red-600 font-medium">{timeError}</p>
              </div>
            )}
          </div>

          {/* Weekly Occurrences Preview */}
          {type === "weekly" && eventDate && (
            <div className="bg-blue-50/50 p-4 rounded-lg border border-blue-100">
              <h3 className="text-sm font-semibold text-blue-900 mb-3">
                Next Occurrences
              </h3>
              <ul className="space-y-2">
                {[1, 2, 3].map((weekOffset) => {
                  const d = new Date(eventDate);
                  if (isNaN(d.getTime())) return null;

                  // Add 7 days * offset
                  d.setDate(d.getDate() + 7 * weekOffset);

                  const formattedDate = formatDate(d);

                  return (
                    <li
                      key={weekOffset}
                      className="flex items-center text-sm text-blue-800 bg-white px-3 py-2 rounded border border-blue-100 shadow-sm"
                    >
                      <svg
                        className="w-4 h-4 mr-2 text-blue-500"
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
                      {formattedDate}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="pt-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={() => navigate("/events")}
                className="rounded-lg border border-gray-300 bg-gray-100 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow transition hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center"
              >
                {loading ? (
                  <>
                    <svg
                      className="animate-spin -ml-1 mr-2 h-5 w-5 text-white"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    Creating...
                  </>
                ) : (
                  "Create Event"
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateEvent;
