import React, { useState, useEffect, useMemo } from "react";
import { RightDrawer } from "../shared/RightDrawer";
import type { DashboardEvent, Study, SessionType } from "../../types/events";
import api, { getStudies } from "../../lib/api";
import { AlertTriangle, Clock, Search } from "lucide-react";
import formatDate from "../../lib/formatDate";
import LocationCombobox from "../shared/LocationCombobox";
import { normalizeLocation } from "../../config/location.config";

export interface SessionFormDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  sessionToEdit?: DashboardEvent | null;
  preselectedStudyId?: string | null;
  onSuccess: (savedSession: any) => void;
}

export const SessionFormDrawer: React.FC<SessionFormDrawerProps> = ({
  isOpen,
  onClose,
  sessionToEdit,
  preselectedStudyId,
  onSuccess,
}) => {
  const isEditing = Boolean(sessionToEdit);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [studyId, setStudyId] = useState<string>("STANDALONE");
  const [sessionType, setSessionType] = useState<SessionType>("EVENING");
  const [lateGraceMinutes, setLateGraceMinutes] = useState<number>(15);

  // Recurrence / timing
  const [mode, setMode] = useState<"one-time" | "weekly">("one-time");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [weeklyEndDate, setWeeklyEndDate] = useState("");

  const [studies, setStudies] = useState<Study[]>([]);
  const [studySearch, setStudySearch] = useState("");
  const [isStudyDropdownOpen, setIsStudyDropdownOpen] = useState(false);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  const isOvernight = sessionType === "OVERNIGHT";
  const effectiveEndDate = isOvernight ? (endDate || startDate) : startDate;

  // Load studies list
  useEffect(() => {
    let active = true;
    getStudies()
      .then((data) => {
        if (active) setStudies(data || []);
      })
      .catch((err) => console.warn("Failed to fetch studies for session form:", err));
    return () => {
      active = false;
    };
  }, [isOpen]);

  // Initialize form state
  useEffect(() => {
    if (sessionToEdit) {
      setTitle(sessionToEdit.title || "");
      setDescription(sessionToEdit.description || "");
      setLocation(sessionToEdit.location || "");
      setStudyId(sessionToEdit.studyId || "STANDALONE");
      setSessionType(sessionToEdit.sessionType || "EVENING");
      setLateGraceMinutes(sessionToEdit.lateGraceMinutes ?? 15);
      setMode("one-time");

      if (sessionToEdit.startTime) {
        const d = new Date(sessionToEdit.startTime);
        setStartDate(d.toISOString().slice(0, 10));
        setStartTime(d.toTimeString().slice(0, 5));
      }
      if (sessionToEdit.endTime) {
        const d = new Date(sessionToEdit.endTime);
        setEndDate(d.toISOString().slice(0, 10));
        setEndTime(d.toTimeString().slice(0, 5));
      }
    } else {
      const todayStr = new Date().toISOString().slice(0, 10);
      setTitle("");
      setDescription("");
      setLocation("");
      setStudyId(preselectedStudyId || "STANDALONE");
      setSessionType("EVENING");
      setLateGraceMinutes(15);
      setMode("one-time");
      setStartDate(todayStr);
      setEndDate(todayStr);
      setStartTime("17:30");
      setEndTime("19:30");
      setWeeklyEndDate("");
    }
    setErrors({});
    setIsDirty(false);
  }, [sessionToEdit, preselectedStudyId, isOpen]);

  const handleSelectSessionType = (type: SessionType) => {
    setSessionType(type);
    setIsDirty(true);
    if (type === "OVERNIGHT") {
      setStartTime("21:00");
      setEndTime("05:00");
      if (startDate) {
        const nextDay = new Date(new Date(`${startDate}T00:00:00`).getTime() + 86400000);
        setEndDate(nextDay.toISOString().slice(0, 10));
      }
    } else {
      setEndDate(startDate);
    }
  };

  const handleStartDateChange = (val: string) => {
    setStartDate(val);
    setIsDirty(true);
    if (sessionType === "OVERNIGHT") {
      const nextDay = new Date(new Date(`${val}T00:00:00`).getTime() + 86400000);
      setEndDate(nextDay.toISOString().slice(0, 10));
    } else {
      setEndDate(val);
    }
  };

  const calculatedDuration = useMemo(() => {
    if (!startDate || !startTime || !endTime) return null;
    const startD = new Date(`${startDate}T${startTime}:00`);
    const endD = new Date(`${effectiveEndDate}T${endTime}:00`);
    if (isNaN(startD.getTime()) || isNaN(endD.getTime())) return null;
    const diffMs = endD.getTime() - startD.getTime();
    if (diffMs <= 0) return { isValid: false, message: "End date and time must be after start date and time." };
    const totalMinutes = Math.floor(diffMs / 60000);
    if (totalMinutes > 24 * 60) return { isValid: false, message: "Session duration cannot exceed 24 hours." };
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    const spansMidnight = startD.toDateString() !== endD.toDateString();
    const formatOpts: Intl.DateTimeFormatOptions = {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    };
    return {
      isValid: true,
      diffMs,
      totalMinutes,
      hours,
      mins,
      spansMidnight,
      formattedRange: `${startD.toLocaleDateString("en-US", formatOpts)} → ${endD.toLocaleDateString("en-US", formatOpts)}`,
    };
  }, [startDate, effectiveEndDate, startTime, endTime]);

  const selectedStudy = useMemo(() => {
    if (studyId === "STANDALONE") return null;
    return studies.find((s) => s.id === studyId);
  }, [studyId, studies]);

  const filteredStudies = useMemo(() => {
    if (!studySearch.trim()) return studies;
    const q = studySearch.toLowerCase();
    return studies.filter((s) => s.name.toLowerCase().includes(q));
  }, [studies, studySearch]);

  // Weekly preview occurrences
  const weeklyOccurrences = useMemo(() => {
    if (mode !== "weekly" || !startDate || !weeklyEndDate || !startTime || !endTime) {
      return [];
    }
    const dates: string[] = [];
    const current = new Date(`${startDate}T${startTime}`);
    const finalDate = new Date(`${weeklyEndDate}T23:59:59`);

    while (current <= finalDate && dates.length < 24) {
      dates.push(current.toISOString());
      current.setDate(current.getDate() + 7);
    }
    return dates;
  }, [mode, startDate, weeklyEndDate, startTime, endTime]);

  const isMovingStudies =
    isEditing &&
    sessionToEdit &&
    (sessionToEdit.studyId || "STANDALONE") !== studyId;

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!title.trim()) errs.title = "Session title is required.";
    if (!startDate) errs.startDate = "Start date is required.";
    if (isOvernight && !endDate) errs.endDate = "End date is required.";
    if (!startTime) errs.startTime = "Start time is required.";
    if (!endTime) errs.endTime = "End time is required.";

    if (startDate && startTime && endTime) {
      const startD = new Date(`${startDate}T${startTime}:00`);
      const endD = new Date(`${effectiveEndDate}T${endTime}:00`);

      if (isNaN(startD.getTime()) || isNaN(endD.getTime()) || endD <= startD) {
        errs.endTime = "End date and time must be after start date and time.";
      } else {
        const durationMinutes = (endD.getTime() - startD.getTime()) / (60 * 1000);
        if (durationMinutes > 24 * 60) {
          errs.endTime = "Session duration cannot exceed 24 hours.";
        }
        if (lateGraceMinutes !== undefined && lateGraceMinutes !== null) {
          if (Number(lateGraceMinutes) < 0) {
            errs.lateGraceMinutes = "Lateness grace period cannot be negative.";
          } else if (Number(lateGraceMinutes) >= durationMinutes) {
            errs.lateGraceMinutes =
              "Lateness grace period must be shorter than session duration.";
          }
        }
      }
    }
    if (mode === "weekly") {
      if (!weeklyEndDate) errs.weeklyEndDate = "Recurrence end date is required.";
      else if (weeklyEndDate <= startDate) {
        errs.weeklyEndDate = "End date must be after start date.";
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!validate()) return;

    try {
      setIsSaving(true);
      const startD = new Date(`${startDate}T${startTime}:00`);
      const endD = new Date(`${effectiveEndDate}T${endTime}:00`);
      const startDateTime = startD.toISOString();
      const endDateTime = endD.toISOString();

      if (isEditing && sessionToEdit) {
        const payload: any = {
          title: title.trim(),
          description: description.trim(),
          location: normalizeLocation(location),
          startTime: startDateTime,
          endTime: endDateTime,
          sessionType,
          studyId: studyId === "STANDALONE" ? null : studyId,
          lateGraceMinutes: Number(lateGraceMinutes) || 15,
        };

        const response = await api.patch(`/events/${sessionToEdit.id}`, payload);
        onSuccess(response.data?.event ?? response.data);
      } else {
        const payload: any = {
          title: title.trim(),
          description: description.trim(),
          location: normalizeLocation(location),
          type: mode === "weekly" ? "WEEKLY" : "ONE_TIME",
          eventDate: startDate,
          startTime: startDateTime,
          endTime: endDateTime,
          endDate: mode === "weekly" ? weeklyEndDate : undefined,
          sessionType,
          studyId: studyId === "STANDALONE" ? null : studyId,
          lateGraceMinutes: Number(lateGraceMinutes) || 15,
        };

        const response = await api.post("/events", payload);
        onSuccess(response.data?.event ?? response.data);
      }

      onClose();
    } catch (err: any) {
      setErrors({
        submit:
          err.response?.data?.error ||
          err.response?.data?.message ||
          "Failed to save session.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <RightDrawer
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? "Edit Session" : "Schedule New Session"}
      subtitle={
        isEditing
          ? "Update session schedule, details, and study assignment"
          : "Schedule a standalone session or assign it to a study"
      }
      onSave={handleSubmit}
      saveLabel={isEditing ? "Update Session" : "Create Session"}
      isSaving={isSaving}
      isDirty={isDirty}
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {errors.submit && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-800">
            {errors.submit}
          </div>
        )}

        {/* Warning if changing study assignment */}
        {isMovingStudies && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3.5 text-xs text-amber-900 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
            <div>
              <span className="font-bold">Study Assignment Changing:</span> Moving this session
              between studies (or to Standalone) alters participation eligibility and study
              completion statistics.
            </div>
          </div>
        )}

        {/* Study Choice (Searchable Select) */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
            Study Assignment
          </label>
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsStudyDropdownOpen((p) => !p)}
              className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-left shadow-sm focus:border-blue-500 focus:outline-none"
            >
              <div>
                <div className="font-bold text-slate-800">
                  {selectedStudy ? selectedStudy.name : "Standalone (no study)"}
                </div>
                <div className="text-[11px] text-slate-500">
                  {selectedStudy
                    ? `Audience: ${selectedStudy.audienceType.replace("_", " ")}`
                    : "Open to all registered campus members"}
                </div>
              </div>
              <span className="text-xs text-blue-600 font-semibold ml-2">Change</span>
            </button>

            {isStudyDropdownOpen && (
              <div className="absolute left-0 right-0 top-full mt-1.5 rounded-2xl bg-white p-2 shadow-2xl border border-slate-200 z-50 max-h-60 overflow-y-auto">
                <div className="p-1 mb-1">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                    <input
                      type="text"
                      value={studySearch}
                      onChange={(e) => setStudySearch(e.target.value)}
                      placeholder="Search studies..."
                      className="w-full rounded-lg border border-slate-200 pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setStudyId("STANDALONE");
                    setIsStudyDropdownOpen(false);
                    setIsDirty(true);
                  }}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-medium transition ${
                    studyId === "STANDALONE"
                      ? "bg-blue-50 text-blue-700 font-bold"
                      : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <span>Standalone (no study)</span>
                  {studyId === "STANDALONE" && <span className="h-1.5 w-1.5 rounded-full bg-blue-600" />}
                </button>

                {filteredStudies.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setStudyId(s.id);
                      setIsStudyDropdownOpen(false);
                      setIsDirty(true);
                    }}
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-medium transition mt-0.5 ${
                      studyId === s.id
                        ? "bg-blue-50 text-blue-700 font-bold"
                        : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <div className="text-left">
                      <div className="font-semibold text-slate-800">{s.name}</div>
                      <div className="text-[10px] text-slate-500">
                        {s.audienceType === "ALL"
                          ? "Audience: Everyone"
                          : s.audienceType === "FINAL_YEAR"
                          ? "Audience: Final-Year"
                          : `Audience: ${s.audienceBatches.join(", ")}`}
                      </div>
                    </div>
                    {studyId === s.id && <span className="h-1.5 w-1.5 rounded-full bg-blue-600" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Title */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
            Session Title *
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setIsDirty(true);
            }}
            placeholder="e.g., General Assembly / Practice Session"
            className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          {errors.title && <p className="mt-1 text-xs text-rose-600 font-medium">{errors.title}</p>}
        </div>

        {/* Description & Location */}
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setIsDirty(true);
              }}
              rows={2}
              placeholder="Session objectives, guest speakers, or materials..."
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
              Location <span className="text-slate-400 font-normal lowercase">(optional)</span>
            </label>
            <LocationCombobox
              value={location}
              onChange={(val) => {
                setLocation(val);
                setIsDirty(true);
              }}
              placeholder="Optional — e.g. ማዕከል 4ኛ ፎቅ"
            />
          </div>
        </div>

        {/* Session Type & Late Grace */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
              Session Type
            </label>
            <div className="flex gap-2">
              {[
                { type: "EVENING" as SessionType, label: "🌆 Evening" },
                { type: "OVERNIGHT" as SessionType, label: "🌙 Overnight" },
                { type: "OTHER" as SessionType, label: "📅 Other" },
              ].map((t) => (
                <button
                  key={t.type}
                  type="button"
                  onClick={() => handleSelectSessionType(t.type)}
                  className={`flex-1 rounded-xl border py-2 text-xs font-bold transition ${
                    sessionType === t.type
                      ? "border-blue-600 bg-blue-50 text-blue-700"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
              Lateness Grace (Minutes)
            </label>
            <input
              type="number"
              min="0"
              max="120"
              value={lateGraceMinutes}
              onChange={(e) => {
                setLateGraceMinutes(Number(e.target.value));
                setIsDirty(true);
              }}
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Recurrence Mode (Only during creation) */}
        {!isEditing && (
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
              Recurrence Mode
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setMode("one-time");
                  setIsDirty(true);
                }}
                className={`rounded-xl border p-2.5 text-xs font-bold transition text-left ${
                  mode === "one-time"
                    ? "border-blue-600 bg-blue-50 text-blue-900"
                    : "border-slate-200 text-slate-700 hover:bg-slate-50"
                }`}
              >
                <div>One-time Session</div>
                <div className="text-[10px] text-slate-500 font-normal mt-0.5">Single scheduled occurrence</div>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("weekly");
                  setIsDirty(true);
                }}
                className={`rounded-xl border p-2.5 text-xs font-bold transition text-left ${
                  mode === "weekly"
                    ? "border-blue-600 bg-blue-50 text-blue-900"
                    : "border-slate-200 text-slate-700 hover:bg-slate-50"
                }`}
              >
                <div>Weekly Recurrence</div>
                <div className="text-[10px] text-slate-500 font-normal mt-0.5">Repeats every 7 days</div>
              </button>
            </div>
          </div>
        )}

        {/* Schedule Timing */}
        <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
              <Clock className="w-4 h-4 text-blue-600" />
              <span>Session Schedule</span>
            </div>
            {isOvernight && (
              <span className="text-[11px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full">
                🌙 Overnight (Spans midnight)
              </span>
            )}
          </div>

          {isOvernight ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">Start Date *</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => handleStartDateChange(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-blue-500"
                />
                {errors.startDate && <p className="mt-1 text-[11px] text-rose-600 font-medium">{errors.startDate}</p>}
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">Start Time *</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => {
                    setStartTime(e.target.value);
                    setIsDirty(true);
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-blue-500"
                />
                {errors.startTime && <p className="mt-1 text-[11px] text-rose-600 font-medium">{errors.startTime}</p>}
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">End Date *</label>
                <input
                  type="date"
                  value={endDate}
                  min={startDate}
                  onChange={(e) => {
                    setEndDate(e.target.value);
                    setIsDirty(true);
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-blue-500"
                />
                {errors.endDate && <p className="mt-1 text-[11px] text-rose-600 font-medium">{errors.endDate}</p>}
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">End Time *</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => {
                    setEndTime(e.target.value);
                    setIsDirty(true);
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-blue-500"
                />
                {errors.endTime && <p className="mt-1 text-[11px] text-rose-600 font-medium">{errors.endTime}</p>}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">Date *</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => handleStartDateChange(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-blue-500"
                />
                {errors.startDate && <p className="mt-1 text-[11px] text-rose-600 font-medium">{errors.startDate}</p>}
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">Start Time *</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => {
                    setStartTime(e.target.value);
                    setIsDirty(true);
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-blue-500"
                />
                {errors.startTime && <p className="mt-1 text-[11px] text-rose-600 font-medium">{errors.startTime}</p>}
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">End Time *</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => {
                    setEndTime(e.target.value);
                    setIsDirty(true);
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-blue-500"
                />
                {errors.endTime && <p className="mt-1 text-[11px] text-rose-600 font-medium">{errors.endTime}</p>}
              </div>
            </div>
          )}

          {/* Time range preview banner */}
          {calculatedDuration && (
            <div
              className={`rounded-xl p-2.5 text-xs flex items-center justify-between border ${
                calculatedDuration.isValid
                  ? calculatedDuration.spansMidnight
                    ? "bg-indigo-50/80 border-indigo-200 text-indigo-900"
                    : "bg-blue-50/80 border-blue-200 text-blue-900"
                  : "bg-rose-50 border-rose-200 text-rose-800"
              }`}
            >
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 shrink-0" />
                <div>
                  {calculatedDuration.isValid ? (
                    <div>
                      <div className="font-semibold">{calculatedDuration.formattedRange}</div>
                      <div className="text-[11px] opacity-75">
                        Duration: {calculatedDuration.hours ?? 0} hr{(calculatedDuration.hours ?? 0) !== 1 ? "s" : ""}{" "}
                        {(calculatedDuration.mins ?? 0) > 0 ? `${calculatedDuration.mins} min` : ""}
                        {calculatedDuration.spansMidnight && " • 🌙 Spans across midnight"}
                      </div>
                    </div>
                  ) : (
                    <div className="font-medium">{calculatedDuration.message}</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {mode === "weekly" && (
            <div className="pt-2 border-t border-slate-200/60">
              <label className="block text-[11px] font-bold text-slate-600 mb-1">Repeat Until *</label>
              <input
                type="date"
                value={weeklyEndDate}
                min={startDate}
                onChange={(e) => {
                  setWeeklyEndDate(e.target.value);
                  setIsDirty(true);
                }}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-blue-500"
              />
              {errors.weeklyEndDate && (
                <p className="mt-1 text-[11px] text-rose-600 font-medium">{errors.weeklyEndDate}</p>
              )}

              {weeklyOccurrences.length > 0 && (
                <div className="mt-3 rounded-xl bg-white p-3 border border-slate-200">
                  <span className="text-[11px] font-bold text-slate-700">
                    Preview: {weeklyOccurrences.length} Weekly Occurrences
                  </span>
                  <div className="mt-1.5 flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                    {weeklyOccurrences.map((occ, i) => (
                      <span
                        key={occ}
                        className="rounded-lg bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700 border border-slate-200"
                      >
                        #{i + 1}: {formatDate(occ)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </form>
    </RightDrawer>
  );
};

export default SessionFormDrawer;
