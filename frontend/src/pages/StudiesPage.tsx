import React, { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import api, {
  getStudies,
  createStudy,
  addSessionsToStudy,
  getStudyStats,
  getStudyNotParticipating,
  exportStudyNotParticipatingExcel,
} from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import formatDate from "../lib/formatDate";
import type {
  Study,
  StudyStatsResponse,
  AudienceType,
  SessionType,
  NotParticipatingResponse,
} from "../types/events";

const formatCampus = (campus: string) => {
  switch (campus) {
    case "FOUR_KILO":
    case "KILO_4":
      return "4 Kilo";
    case "FIVE_KILO":
    case "KILO_5":
      return "5 Kilo";
    case "SIX_KILO":
    case "KILO_6":
      return "6 Kilo";
    case "ART":
      return "Art";
    default:
      return campus;
  }
};

const formatBatch = (batch: string) => {
  switch (batch) {
    case "FRESHMAN":
      return "Freshman";
    case "YEAR_2":
      return "Year 2";
    case "YEAR_3":
      return "Year 3";
    case "YEAR_4":
      return "Year 4";
    case "YEAR_5":
      return "Year 5";
    case "GRADUATE":
      return "Graduate";
    default:
      return batch;
  }
};

const StudiesPage: React.FC = () => {
  const navigate = useNavigate();
  const { admin, logout } = useAuth();
  const isSuperAdmin = admin?.role === "SUPER_ADMIN";

  const [studies, setStudies] = useState<Study[]>([]);
  const [selectedStudyId, setSelectedStudyId] = useState<string>("");
  const [statsData, setStatsData] = useState<StudyStatsResponse | null>(null);
  const [loadingStudies, setLoadingStudies] = useState(true);
  const [loadingStats, setLoadingStats] = useState(false);
  const [error, setError] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");

  // Modals
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isAddSessionsModalOpen, setIsAddSessionsModalOpen] = useState(false);

  // Grid search and filters
  const [gridSearch, setGridSearch] = useState("");
  const [gridCampusFilter, setGridCampusFilter] = useState("ALL");
  const [gridBatchFilter, setGridBatchFilter] = useState("ALL");

  // Not Participating state (Amendment 2)
  const [notPartData, setNotPartData] = useState<NotParticipatingResponse | null>(null);
  const [loadingNotPart, setLoadingNotPart] = useState(false);
  const [notPartSearch, setNotPartSearch] = useState("");
  const [notPartCampus, setNotPartCampus] = useState("ALL");
  const [notPartBatch, setNotPartBatch] = useState("ALL");
  const [notPartDept, setNotPartDept] = useState("ALL");
  const [notPartHideOther, setNotPartHideOther] = useState(false);
  const [notPartPage, setNotPartPage] = useState(1);
  const [copyToast, setCopyToast] = useState("");
  const [exportingNotPartExcel, setExportingNotPartExcel] = useState(false);

  // Create Study Form state
  const [createForm, setCreateForm] = useState({
    name: "",
    description: "",
    startDate: "",
    endDate: "",
    audienceType: "ALL" as AudienceType,
    audienceBatches: [] as string[],
    requiredSessions: "",
    defaultLateGraceMinutes: "15",
  });

  // Add Sessions Form state
  const [sessionMode, setSessionMode] = useState<"one-time" | "weekly" | "custom">("weekly");
  const [oneTimeForm, setOneTimeForm] = useState({
    title: "",
    sessionType: "EVENING" as SessionType,
    startTime: "",
    endTime: "",
    location: "Main Chapel",
  });
  const [weeklyForm, setWeeklyForm] = useState({
    title: "",
    sessionType: "EVENING" as SessionType,
    startTime: "",
    endTime: "",
    recurrenceLengthWeeks: 8,
    location: "Main Chapel",
  });
  const [customFormSessions, setCustomFormSessions] = useState<
    Array<{
      title: string;
      sessionType: SessionType;
      startTime: string;
      endTime: string;
      location: string;
    }>
  >([
    {
      title: "Session 1",
      sessionType: "EVENING",
      startTime: "",
      endTime: "",
      location: "Main Chapel",
    },
    {
      title: "Session 2",
      sessionType: "EVENING",
      startTime: "",
      endTime: "",
      location: "Main Chapel",
    },
  ]);

  const fetchStudies = async () => {
    try {
      setLoadingStudies(true);
      setError("");
      const list = await getStudies();
      setStudies(list || []);
      if (list && list.length > 0 && !selectedStudyId) {
        setSelectedStudyId(list[0].id);
      }
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to load studies");
    } finally {
      setLoadingStudies(false);
    }
  };

  const fetchStats = async (studyId: string) => {
    if (!studyId) return;
    try {
      setLoadingStats(true);
      setError("");
      const stats = await getStudyStats(studyId);
      setStatsData(stats);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to load study statistics");
    } finally {
      setLoadingStats(false);
    }
  };

  const fetchNotParticipating = async (studyId: string, page = notPartPage) => {
    if (!studyId) return;
    try {
      setLoadingNotPart(true);
      const res = await getStudyNotParticipating(studyId, {
        search: notPartSearch.trim() || undefined,
        campus: notPartCampus !== "ALL" ? notPartCampus : undefined,
        batch: notPartBatch !== "ALL" ? notPartBatch : undefined,
        department: notPartDept !== "ALL" ? notPartDept : undefined,
        hideAttendingOther: notPartHideOther ? true : undefined,
        page,
        limit: 25,
      });
      setNotPartData(res);
    } catch (err: any) {
      console.error("Failed to load not-participating members:", err);
    } finally {
      setLoadingNotPart(false);
    }
  };

  const handleNotPartFilterChange = (setter: (val: any) => void, val: any) => {
    setter(val);
    setNotPartPage(1);
  };

  const handleExportNotParticipatingExcel = async () => {
    if (!selectedStudyId) return;
    try {
      setExportingNotPartExcel(true);
      const blob = await exportStudyNotParticipatingExcel(selectedStudyId, {
        search: notPartSearch.trim() || undefined,
        campus: notPartCampus !== "ALL" ? notPartCampus : undefined,
        batch: notPartBatch !== "ALL" ? notPartBatch : undefined,
        department: notPartDept !== "ALL" ? notPartDept : undefined,
        hideAttendingOther: notPartHideOther ? true : undefined,
      });

      const url = window.URL.createObjectURL(new Blob([blob]));
      const link = document.createElement("a");
      link.href = url;
      const safeName = (selectedStudy?.name || "study").replace(/[^a-zA-Z0-9_-]/g, "_");
      link.setAttribute("download", `${safeName}_not_participating.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.parentNode?.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error("Failed to export Excel:", err);
      setError("Failed to export not-participating members to Excel");
    } finally {
      setExportingNotPartExcel(false);
    }
  };

  const handleCopyPhoneNumbers = async () => {
    if (!notPartData?.members || notPartData.members.length === 0) {
      setCopyToast("No members matching current filters");
      setTimeout(() => setCopyToast(""), 3000);
      return;
    }

    const phones = notPartData.members
      .map((m) => m.phoneNumber?.trim())
      .filter((p): p is string => Boolean(p && p.length > 0));

    if (phones.length === 0) {
      setCopyToast("No phone numbers available for current list");
      setTimeout(() => setCopyToast(""), 3000);
      return;
    }

    try {
      await navigator.clipboard.writeText(phones.join(", "));
      setCopyToast(`Copied ${phones.length} phone number${phones.length > 1 ? "s" : ""} to clipboard!`);
    } catch {
      setCopyToast("Failed to copy to clipboard");
    }
    setTimeout(() => setCopyToast(""), 3500);
  };

  useEffect(() => {
    void fetchStudies();
  }, []);

  useEffect(() => {
    if (selectedStudyId) {
      void fetchStats(selectedStudyId);
      setNotPartPage(1);
      setNotPartCampus("ALL");
      setNotPartBatch("ALL");
      setNotPartDept("ALL");
      setNotPartSearch("");
      setNotPartHideOther(false);
    }
  }, [selectedStudyId]);

  useEffect(() => {
    if (!selectedStudyId) return;
    const timer = setTimeout(() => {
      void fetchNotParticipating(selectedStudyId, notPartPage);
    }, 250);
    return () => clearTimeout(timer);
  }, [
    selectedStudyId,
    notPartSearch,
    notPartCampus,
    notPartBatch,
    notPartDept,
    notPartHideOther,
    notPartPage,
  ]);

  const handleCreateStudy = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setError("");
      const payload = {
        name: createForm.name,
        description: createForm.description || undefined,
        startDate: createForm.startDate,
        endDate: createForm.endDate,
        audienceType: createForm.audienceType,
        audienceBatches:
          createForm.audienceType === "BATCHES" ? createForm.audienceBatches : [],
        requiredSessions: createForm.requiredSessions
          ? Number(createForm.requiredSessions)
          : null,
        defaultLateGraceMinutes: Number(createForm.defaultLateGraceMinutes) || 15,
      };

      const res = await createStudy(payload);
      setSuccessMessage("Study created successfully!");
      setIsCreateModalOpen(false);
      await fetchStudies();
      if (res?.study?.id) {
        setSelectedStudyId(res.study.id);
      }
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to create study");
    }
  };

  const handleAddSessions = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStudyId) return;
    try {
      setError("");
      let payload: any = { mode: sessionMode };
      if (sessionMode === "one-time") {
        payload = { ...payload, ...oneTimeForm };
      } else if (sessionMode === "weekly") {
        payload = { ...payload, ...weeklyForm };
      } else {
        payload = { ...payload, sessions: customFormSessions };
      }

      await addSessionsToStudy(selectedStudyId, payload);
      setSuccessMessage("Sessions added to study successfully!");
      setIsAddSessionsModalOpen(false);
      await fetchStats(selectedStudyId);
      await fetchStudies();
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to add sessions");
    }
  };

  const handleExportExcel = () => {
    if (!selectedStudyId) return;
    const url = `${api.defaults.baseURL}/studies/${selectedStudyId}/export/excel`;
    window.open(url, "_blank");
  };

  // Filtered rows for Member x Session Grid
  const filteredGridRows = useMemo(() => {
    if (!statsData?.grid) return [];
    return statsData.grid.filter((row) => {
      const q = gridSearch.trim().toLowerCase();
      const matchSearch =
        !q ||
        row.name.toLowerCase().includes(q) ||
        row.uniqueId.toLowerCase().includes(q) ||
        (row.phoneNumber && row.phoneNumber.includes(q));

      const matchCampus =
        gridCampusFilter === "ALL" || row.campus === gridCampusFilter;

      const matchBatch =
        gridBatchFilter === "ALL" || row.effectiveBatch === gridBatchFilter;

      return matchSearch && matchCampus && matchBatch;
    });
  }, [statsData?.grid, gridSearch, gridCampusFilter, gridBatchFilter]);

  const selectedStudy = useMemo(() => {
    return studies.find((s) => s.id === selectedStudyId) || statsData?.study;
  }, [studies, selectedStudyId, statsData]);

  // Overall progress calculation
  const progressInfo = useMemo(() => {
    if (!statsData) return { completedSessions: 0, totalSessions: 0, percent: 0 };
    const total = statsData.sessionSeries.length;
    const now = new Date();
    const completed = statsData.sessionSeries.filter(
      (s) => new Date(s.endTime) <= now && !s.isCancelled,
    ).length;
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { completedSessions: completed, totalSessions: total, percent };
  }, [statsData]);

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      {/* Top Header */}
      <header className="fixed top-0 z-30 w-full border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 pt-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">
                Liturgical Studies
              </h1>
              <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">
                Church Hymn Department Attendance
              </p>
            </div>

            <div className="flex items-center gap-2">
              {isSuperAdmin && (
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:from-blue-700 hover:to-indigo-700 transition"
                >
                  <span className="text-lg leading-none">+</span> New Study
                </button>
              )}
              <button
                type="button"
                onClick={async () => {
                  await logout();
                  navigate("/login", { replace: true });
                }}
                className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 transition"
              >
                Logout
              </button>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex space-x-4 border-b border-slate-100 pb-1">
            <button
              onClick={() => navigate("/events")}
              className="border-b-2 border-transparent px-1 pb-2 text-sm font-medium text-slate-500 hover:text-slate-700"
            >
              Events
            </button>
            <button
              onClick={() => navigate("/studies")}
              className="border-b-2 border-blue-600 px-1 pb-2 text-sm font-semibold text-blue-600"
            >
              Studies
            </button>
            <button
              onClick={() => navigate("/members")}
              className="border-b-2 border-transparent px-1 pb-2 text-sm font-medium text-slate-500 hover:text-slate-700"
            >
              Members
            </button>
            <button
              onClick={() => navigate("/dashboard")}
              className="border-b-2 border-transparent px-1 pb-2 text-sm font-medium text-slate-500 hover:text-slate-700"
            >
              Dashboard
            </button>
          </nav>
        </div>
      </header>

      {/* Main Container */}
      <main className="mx-auto max-w-7xl px-4 pt-36 sm:pt-40 space-y-6">
        {/* Alerts & Feedback */}
        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800">
            {error}
          </div>
        )}
        {successMessage && (
          <div className="rounded-2xl border border-green-200 bg-green-50 p-4 text-sm font-medium text-green-800">
            {successMessage}
          </div>
        )}

        {/* Study Selector & Action Bar */}
        <div className="flex flex-col gap-4 rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 items-center gap-3">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Active Study:
            </label>
            <select
              value={selectedStudyId}
              onChange={(e) => setSelectedStudyId(e.target.value)}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            >
              {studies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({formatDate(s.startDate)} - {formatDate(s.endDate)})
                </option>
              ))}
            </select>
            {loadingStudies && (
              <span className="text-xs text-slate-400">Loading...</span>
            )}
            {selectedStudy && "audienceType" in selectedStudy && (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-100 text-blue-800 border border-blue-200">
                {selectedStudy.audienceType === "FINAL_YEAR"
                  ? "🎓 Final Year"
                  : selectedStudy.audienceType === "BATCHES"
                    ? "🏷️ Batches"
                    : "👥 Everyone"}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isSuperAdmin && selectedStudyId && (
              <button
                type="button"
                onClick={() => setIsAddSessionsModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100 transition"
              >
                <span>+</span> Add Sessions
              </button>
            )}

            {selectedStudyId && (
              <button
                type="button"
                onClick={handleExportExcel}
                className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 transition"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Export Study Grid (.xlsx)
              </button>
            )}
          </div>
        </div>

        {loadingStats ? (
          <div className="flex h-64 items-center justify-center rounded-3xl border border-slate-200 bg-white">
            <div className="flex flex-col items-center gap-2">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
              <p className="text-xs font-medium text-slate-500">Loading study analytics & attendance grid...</p>
            </div>
          </div>
        ) : statsData ? (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {/* Progress */}
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Study Progress
                </p>
                <div className="mt-2 flex items-baseline justify-between">
                  <p className="text-2xl font-black text-slate-900">
                    Session {progressInfo.completedSessions} of {progressInfo.totalSessions}
                  </p>
                  <span className="text-xs font-bold text-blue-600">{progressInfo.percent}%</span>
                </div>
                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-blue-600 transition-all duration-500"
                    style={{ width: `${progressInfo.percent}%` }}
                  />
                </div>
              </div>

              {/* Average Turnout */}
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Average Turnout
                </p>
                <div className="mt-2 flex items-baseline justify-between">
                  <p className="text-3xl font-black text-slate-900">
                    {statsData.averageTurnout !== null
                      ? `${Math.round(statsData.averageTurnout * 100)}%`
                      : "—"}
                  </p>
                  <span className="text-xs font-semibold text-emerald-600">Active Non-Cancelled</span>
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  Across all completed study sessions
                </p>
              </div>

              {/* Target Audience */}
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Target Audience
                </p>
                <div className="mt-2">
                  <span className="inline-flex items-center rounded-lg bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700">
                    {statsData.study.audienceType === "ALL"
                      ? "All Registered Members"
                      : statsData.study.audienceType === "FINAL_YEAR"
                      ? "Graduating Class (Final Year)"
                      : `Batches: ${statsData.study.audienceBatches.join(", ")}`}
                  </span>
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  {statsData.study.requiredSessions
                    ? `Completion Rule: ${statsData.study.requiredSessions} required sessions`
                    : "No minimum completion threshold"}
                </p>
              </div>

              {/* Completion Count */}
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Perfect Attendance
                </p>
                <div className="mt-2 flex items-baseline justify-between">
                  <p className="text-3xl font-black text-emerald-700">
                    {statsData.attendedAllMembers.length}
                  </p>
                  <span className="text-xs font-bold text-slate-400">
                    {statsData.attendedNoneMembers.length} missed all
                  </span>
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  Members who attended 100% of study sessions
                </p>
              </div>
            </div>

            {/* Session Turnout Bar Chart */}
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-bold text-slate-900">
                Session Turnout Progression
              </h2>
              <p className="text-xs text-slate-500 mb-6">
                Turnout percentage for each session of this study
              </p>

              {statsData.sessionSeries.length === 0 ? (
                <p className="text-sm italic text-slate-400">No sessions scheduled for this study yet.</p>
              ) : (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 md:grid-cols-8">
                  {statsData.sessionSeries.map((s, idx) => {
                    const isUpcoming = new Date(s.startTime) > new Date();
                    const participantRate =
                      s.turnoutAmongParticipants !== null &&
                      s.turnoutAmongParticipants !== undefined
                        ? Math.round(s.turnoutAmongParticipants * 100)
                        : s.attendanceRate !== null &&
                          s.attendanceRate !== undefined
                          ? Math.round(s.attendanceRate * 100)
                          : null;
                    const eligibleRate =
                      s.eligibleAttendanceRate !== null &&
                      s.eligibleAttendanceRate !== undefined
                        ? Math.round(s.eligibleAttendanceRate * 100)
                        : null;
                    return (
                      <div key={s.eventId} className="flex flex-col items-center">
                        <div className="relative flex h-36 w-full flex-col justify-end rounded-2xl bg-slate-50 p-2 border border-slate-100">
                          {s.isCancelled ? (
                            <div className="flex h-full w-full items-center justify-center rounded-xl bg-red-50 text-[10px] font-bold uppercase text-red-600">
                              Cancelled
                            </div>
                          ) : isUpcoming ? (
                            <div className="flex h-full w-full items-center justify-center rounded-xl bg-slate-100 text-[10px] font-bold uppercase text-slate-400">
                              Upcoming
                            </div>
                          ) : (
                            <div
                              className="w-full rounded-xl bg-gradient-to-t from-blue-600 to-indigo-500 transition-all duration-500 flex flex-col items-center justify-center text-xs font-bold text-white p-1 text-center"
                              style={{ height: `${Math.max(22, participantRate ?? 0)}%` }}
                              title={`Participant turnout: ${participantRate !== null ? `${participantRate}%` : "—"}${eligibleRate !== null ? ` (${eligibleRate}% of all eligible)` : ""}`}
                            >
                              <span>{participantRate !== null ? `${participantRate}%` : "—"}</span>
                              {eligibleRate !== null && (
                                <span className="text-[9px] opacity-80 font-normal">
                                  ({eligibleRate}%)
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        <span className="mt-2 text-xs font-bold text-slate-800">
                          S{idx + 1}
                        </span>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                          s.sessionType === "OVERNIGHT"
                            ? "bg-purple-50 text-purple-700"
                            : "bg-blue-50 text-blue-700"
                        }`}>
                          {s.sessionType}
                        </span>
                        <span className="text-[10px] text-slate-400 mt-0.5">
                          {formatDate(s.startTime)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Attended All Sessions (Kept as is) */}
            <div className="rounded-3xl border border-emerald-100 bg-emerald-50/40 p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold uppercase tracking-wider text-emerald-900">
                  ⭐ Attended All Sessions ({statsData.attendedAllMembers.length})
                </h3>
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
                  Exemplary
                </span>
              </div>
              <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                {statsData.attendedAllMembers.length === 0 ? (
                  <p className="text-xs italic text-slate-400">No members have attended every session.</p>
                ) : (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
                    {statsData.attendedAllMembers.map((m) => (
                      <div
                        key={m.id}
                        onClick={() => navigate(`/members/${m.id}`)}
                        className="flex cursor-pointer items-center justify-between rounded-xl bg-white p-2.5 shadow-2xs border border-emerald-100 hover:border-emerald-300 transition"
                      >
                        <div>
                          <p className="text-xs font-bold text-slate-900">{m.name}</p>
                          <p className="text-[10px] text-slate-500">
                            {m.uniqueId} • {formatCampus(m.campus)} • {formatBatch(m.effectiveBatch)}
                          </p>
                        </div>
                        <span className="text-xs font-bold text-emerald-600">100%</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Dedicated "Not participating" Section (Replaces Attended None) */}
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-5">
              {/* Header */}
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between border-b border-slate-100 pb-4">
                <div>
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <h2 className="text-lg font-bold text-slate-900">
                      Not participating
                      {notPartData ? (
                        <span className="font-semibold text-slate-600 ml-1.5 text-base">
                          ({notPartData.totalNotParticipating} of {notPartData.totalEligible} eligible members)
                        </span>
                      ) : null}
                    </h2>
                    {notPartData?.study.audienceLabel && (
                      <span className="inline-flex items-center rounded-full bg-blue-50 px-3 py-0.5 text-xs font-semibold text-blue-700 border border-blue-200">
                        Audience: {notPartData.study.audienceLabel}
                      </span>
                    )}
                    {notPartData && !notPartData.isOngoing && (
                      <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600">
                        Evaluated as of study end ({formatDate(notPartData.evaluationDate)})
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Eligible members who have not attended any session of this study
                  </p>
                </div>

                {/* Actions: Export Excel & Copy Phone Numbers */}
                <div className="flex items-center gap-2 flex-wrap">
                  {copyToast && (
                    <span className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-1.5 text-xs font-semibold text-emerald-800">
                      ✓ {copyToast}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={handleCopyPhoneNumbers}
                    disabled={!notPartData || notPartData.members.length === 0}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 disabled:opacity-50 transition"
                    title="Copy phone numbers for calling"
                  >
                    <span>📞</span> Copy Phone Numbers
                  </button>
                  <button
                    type="button"
                    onClick={handleExportNotParticipatingExcel}
                    disabled={exportingNotPartExcel || !notPartData || notPartData.totalNotParticipating === 0}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white shadow-2xs hover:bg-emerald-700 disabled:opacity-50 transition"
                  >
                    {exportingNotPartExcel ? (
                      <>
                        <span className="animate-spin inline-block h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full" />
                        Exporting...
                      </>
                    ) : (
                      <>
                        <span>📊</span> Export to Excel
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Filters Bar */}
              <div className="flex flex-wrap items-center gap-3">
                {/* Search */}
                <div className="relative min-w-[200px] flex-1">
                  <input
                    type="text"
                    value={notPartSearch}
                    onChange={(e) => handleNotPartFilterChange(setNotPartSearch, e.target.value)}
                    placeholder="Search by name, ID, or phone..."
                    className="w-full rounded-xl border border-slate-200 px-3 py-1.5 text-xs focus:border-blue-500 focus:outline-none"
                  />
                  {notPartSearch && (
                    <button
                      onClick={() => handleNotPartFilterChange(setNotPartSearch, "")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* Campus Filter */}
                <select
                  value={notPartCampus}
                  onChange={(e) => handleNotPartFilterChange(setNotPartCampus, e.target.value)}
                  className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 focus:border-blue-500 focus:outline-none"
                >
                  <option value="ALL">All Campuses</option>
                  <option value="FOUR_KILO">4 Kilo</option>
                  <option value="FIVE_KILO">5 Kilo</option>
                  <option value="SIX_KILO">6 Kilo</option>
                  <option value="ART">Art</option>
                </select>

                {/* Batch Filter - Only batches inside the audience are offered */}
                <select
                  value={notPartBatch}
                  onChange={(e) => handleNotPartFilterChange(setNotPartBatch, e.target.value)}
                  className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 focus:border-blue-500 focus:outline-none"
                >
                  <option value="ALL">All Audience Batches</option>
                  {notPartData?.audienceBatches?.map((b) => (
                    <option key={b} value={b}>
                      {formatBatch(b)}
                    </option>
                  ))}
                </select>

                {/* Department Filter */}
                <select
                  value={notPartDept}
                  onChange={(e) => handleNotPartFilterChange(setNotPartDept, e.target.value)}
                  className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 focus:border-blue-500 focus:outline-none"
                >
                  <option value="ALL">All Departments</option>
                  {notPartData?.departments?.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>

                {/* Hide Attending Other Study Toggle */}
                <label className="flex items-center gap-2 cursor-pointer select-none text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl px-3 py-1.5 transition">
                  <input
                    type="checkbox"
                    checked={notPartHideOther}
                    onChange={(e) => handleNotPartFilterChange(setNotPartHideOther, e.target.checked)}
                    className="rounded text-blue-600 focus:ring-blue-500 h-4 w-4"
                  />
                  <span>Hide members attending another study</span>
                </label>
              </div>

              {/* Table */}
              <div className="overflow-x-auto rounded-2xl border border-slate-100">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-slate-600 border-b border-slate-200 font-bold">
                      <th className="p-3">Name</th>
                      <th className="p-3">Unique ID</th>
                      <th className="p-3">Phone</th>
                      <th className="p-3">Campus</th>
                      <th className="p-3">Effective Batch</th>
                      <th className="p-3">Department</th>
                      <th className="p-3">Badges</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loadingNotPart ? (
                      <tr>
                        <td colSpan={7} className="p-8 text-center text-slate-400">
                          <div className="inline-block animate-spin h-5 w-5 border-2 border-blue-600 border-t-transparent rounded-full mb-2" />
                          <p>Loading not participating members...</p>
                        </td>
                      </tr>
                    ) : !notPartData || notPartData.members.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-8 text-center text-slate-400">
                          No members found matching the specified filters.
                        </td>
                      </tr>
                    ) : (
                      notPartData.members.map((m) => {
                        const isGreyed = m.attendingOtherStudy;
                        return (
                          <tr
                            key={m.id}
                            onClick={() => navigate(`/members/${m.id}`)}
                            className={`cursor-pointer transition ${
                              isGreyed
                                ? "bg-slate-50/70 opacity-70 text-slate-500 hover:bg-slate-100/70"
                                : "bg-white hover:bg-slate-50/70"
                            }`}
                          >
                            <td className="p-3 font-semibold text-slate-900">
                              {m.name}
                            </td>
                            <td className="p-3 font-mono font-medium text-slate-600">
                              {m.uniqueId}
                            </td>
                            <td className="p-3 text-slate-600">
                              {m.phoneNumber ? (
                                <a
                                  href={`tel:${m.phoneNumber}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-blue-600 hover:underline"
                                >
                                  {m.phoneNumber}
                                </a>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                            <td className="p-3 text-slate-600">
                              {formatCampus(m.campus)}
                            </td>
                            <td className="p-3 text-slate-600">
                              <span className="inline-block rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                                {formatBatch(m.effectiveBatch)}
                              </span>
                            </td>
                            <td className="p-3 text-slate-600">
                              {m.department || "—"}
                            </td>
                            <td className="p-3">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {m.isExcusedOnly && (
                                  <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-[10px] font-bold text-blue-700 border border-blue-200">
                                    Excused
                                  </span>
                                )}
                                {m.attendingOtherStudy && (
                                  <span className="inline-flex items-center rounded-full bg-purple-50 px-2.5 py-0.5 text-[10px] font-bold text-purple-700 border border-purple-200">
                                    Attending other study
                                  </span>
                                )}
                                {!m.isExcusedOnly && !m.attendingOtherStudy && (
                                  <span className="text-[11px] text-slate-400 italic">
                                    No attendance
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {notPartData && notPartData.totalPages > 1 && (
                <div className="flex items-center justify-between pt-2">
                  <p className="text-xs text-slate-500">
                    Showing {(notPartData.page - 1) * notPartData.limit + 1} to{" "}
                    {Math.min(notPartData.page * notPartData.limit, notPartData.totalFiltered)} of{" "}
                    {notPartData.totalFiltered} filtered members
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={notPartData.page <= 1}
                      onClick={() => setNotPartPage((p) => Math.max(1, p - 1))}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                    >
                      Previous
                    </button>
                    <span className="text-xs text-slate-600 font-medium">
                      Page {notPartData.page} of {notPartData.totalPages}
                    </span>
                    <button
                      type="button"
                      disabled={notPartData.page >= notPartData.totalPages}
                      onClick={() => setNotPartPage((p) => Math.min(notPartData.totalPages, p + 1))}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Dropped Off Report for Ended Studies */}
            {statsData.droppedOffMembers && statsData.droppedOffMembers.length > 0 && (
              <div className="rounded-3xl border border-amber-200 bg-amber-50/50 p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-amber-900 flex items-center gap-2">
                    <span>⚠️ Dropped Off Participants ({statsData.droppedOffMembers.length})</span>
                  </h3>
                  <span className="rounded-full bg-amber-100 border border-amber-200 px-2.5 py-0.5 text-xs font-bold text-amber-800">
                    Ended Study Cohort Report
                  </span>
                </div>
                <p className="text-xs text-amber-800/80 mb-3">
                  Participants who joined and attended early sessions, but dropped off before the study concluded.
                </p>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-3 max-h-56 overflow-y-auto pr-1">
                  {statsData.droppedOffMembers.map((m) => (
                    <div
                      key={m.id}
                      onClick={() => navigate(`/members/${m.id}`)}
                      className="flex cursor-pointer items-center justify-between rounded-xl bg-white p-2.5 shadow-2xs border border-amber-100 hover:border-amber-300 transition"
                    >
                      <div>
                        <p className="text-xs font-bold text-slate-900">{m.name}</p>
                        <p className="text-[10px] text-slate-500">
                          {m.uniqueId} • {m.campus} • {m.effectiveBatch}
                        </p>
                      </div>
                      <span className="text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
                        Dropped after S{m.droppedOffAfterSession}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Member x Session Grid Section */}
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">
                    Member × Session Attendance Matrix
                  </h2>
                  <p className="text-xs text-slate-500">
                    Comprehensive cross-tabular view of all member attendance records
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={gridSearch}
                    onChange={(e) => setGridSearch(e.target.value)}
                    placeholder="Search member..."
                    className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs focus:border-blue-500 focus:outline-none"
                  />
                  <select
                    value={gridCampusFilter}
                    onChange={(e) => setGridCampusFilter(e.target.value)}
                    className="rounded-xl border border-slate-200 px-2 py-1.5 text-xs font-medium text-slate-700 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="ALL">All Campuses</option>
                    <option value="FOUR_KILO">4 Kilo</option>
                    <option value="FIVE_KILO">5 Kilo</option>
                    <option value="SIX_KILO">6 Kilo</option>
                    <option value="ART">Art</option>
                  </select>
                  <select
                    value={gridBatchFilter}
                    onChange={(e) => setGridBatchFilter(e.target.value)}
                    className="rounded-xl border border-slate-200 px-2 py-1.5 text-xs font-medium text-slate-700 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="ALL">All Batches</option>
                    <option value="FRESHMAN">Freshman</option>
                    <option value="YEAR_2">Year 2</option>
                    <option value="YEAR_3">Year 3</option>
                    <option value="YEAR_4">Year 4</option>
                    <option value="YEAR_5">Year 5</option>
                    <option value="GRADUATE">Graduate</option>
                  </select>
                </div>
              </div>

              {/* Table Container */}
              <div className="overflow-x-auto rounded-2xl border border-slate-100">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                      <th className="sticky left-0 bg-slate-50 z-10 p-3 font-bold">Member</th>
                      <th className="p-3 font-semibold">Campus</th>
                      <th className="p-3 font-semibold">Batch</th>
                      {statsData.sessionSeries.map((s, idx) => (
                        <th key={s.eventId} className="p-2 text-center font-bold whitespace-nowrap">
                          <div>S{idx + 1}</div>
                          <div className="text-[10px] font-normal text-slate-400">
                            {formatDate(s.startTime)}
                          </div>
                        </th>
                      ))}
                      <th className="p-3 text-center font-bold">Attended</th>
                      <th className="p-3 text-center font-bold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredGridRows.length === 0 ? (
                      <tr>
                        <td colSpan={5 + statsData.sessionSeries.length} className="p-6 text-center text-slate-400 italic">
                          No members matched the matrix filters.
                        </td>
                      </tr>
                    ) : (
                      filteredGridRows.map((row) => (
                        <tr key={row.memberId} className="hover:bg-slate-50/70 transition">
                          <td className="sticky left-0 bg-white hover:bg-slate-50 z-10 p-3 font-semibold text-slate-900 whitespace-nowrap">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span
                                onClick={() => navigate(`/members/${row.memberId}`)}
                                className="cursor-pointer text-blue-600 hover:underline"
                              >
                                {row.name}
                              </span>
                              {row.droppedOff && (
                                <span
                                  className="rounded bg-amber-100 border border-amber-200 px-1.5 py-0.5 text-[9px] font-bold text-amber-800"
                                  title={`Dropped off after session ${row.droppedOffAfterSession}`}
                                >
                                  Dropped after S{row.droppedOffAfterSession}
                                </span>
                              )}
                            </div>
                            <span className="block text-[10px] font-normal text-slate-400">
                              {row.uniqueId}
                            </span>
                          </td>
                          <td className="p-3 text-slate-600 whitespace-nowrap">{row.campus}</td>
                          <td className="p-3 text-slate-600 whitespace-nowrap">{row.effectiveBatch}</td>
                          {row.sessions.map((sess) => {
                            let badgeStyle = "bg-slate-100 text-slate-400";
                            let text = "—";
                            if (sess.status === "PRESENT") {
                              badgeStyle = "bg-emerald-100 text-emerald-800 font-bold";
                              text = "P";
                            } else if (sess.status === "LATE") {
                              badgeStyle = "bg-amber-100 text-amber-800 font-bold";
                              text = "L";
                            } else if (sess.status === "EXCUSED") {
                              badgeStyle = "bg-blue-100 text-blue-800 font-bold";
                              text = "E";
                            } else if (sess.status === "ABSENT") {
                              badgeStyle = "bg-red-100 text-red-800 font-bold";
                              text = "A";
                            } else if (sess.status === "CANCELLED") {
                              badgeStyle = "bg-slate-200 text-slate-500 line-through";
                              text = "C";
                            }

                            return (
                              <td key={sess.eventId} className="p-2 text-center whitespace-nowrap">
                                <span
                                  title={`${sess.title}: ${sess.status}${sess.excuseReason ? ` (${sess.excuseReason})` : ""}`}
                                  className={`inline-block w-6 h-6 leading-6 rounded-md text-[11px] ${badgeStyle}`}
                                >
                                  {text}
                                </span>
                              </td>
                            );
                          })}
                          <td className="p-3 text-center font-bold text-slate-800">
                            {row.attendedCount}
                            {row.requiredSessions ? ` / ${row.requiredSessions}` : ""}
                          </td>
                          <td className="p-3 text-center whitespace-nowrap">
                            {row.isCompleted ? (
                              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800">
                                ✓ Completed
                              </span>
                            ) : (
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                                In Progress
                              </span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : null}
      </main>

      {/* CREATE STUDY MODAL */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-xl rounded-3xl bg-white p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-3">
              <h2 className="text-xl font-bold text-slate-900">Create New Liturgical Study</h2>
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateStudy} className="space-y-4 text-xs font-semibold text-slate-700">
              <div>
                <label className="block mb-1">Study Name *</label>
                <input
                  type="text"
                  required
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  placeholder="e.g. Epiphany Mezmur Preparation 2026"
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-sm font-normal text-slate-900 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block mb-1">Description</label>
                <textarea
                  rows={2}
                  value={createForm.description}
                  onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                  placeholder="Goals and spiritual focus for this hymn study..."
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-sm font-normal text-slate-900 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block mb-1">Start Date *</label>
                  <input
                    type="date"
                    required
                    value={createForm.startDate}
                    onChange={(e) => setCreateForm({ ...createForm, startDate: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block mb-1">End Date *</label>
                  <input
                    type="date"
                    required
                    value={createForm.endDate}
                    onChange={(e) => setCreateForm({ ...createForm, endDate: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block mb-1">Audience Eligibility *</label>
                <div className="grid grid-cols-3 gap-2">
                  {(["ALL", "FINAL_YEAR", "BATCHES"] as AudienceType[]).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setCreateForm({ ...createForm, audienceType: type })}
                      className={`rounded-xl border py-2 text-center text-xs font-bold transition ${
                        createForm.audienceType === type
                          ? "border-blue-600 bg-blue-50 text-blue-700 shadow-xs"
                          : "border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {type === "ALL"
                        ? "Everyone"
                        : type === "FINAL_YEAR"
                        ? "Final-Year Only"
                        : "Specific Batches"}
                    </button>
                  ))}
                </div>
              </div>

              {createForm.audienceType === "BATCHES" && (
                <div>
                  <label className="block mb-1 text-[11px] text-slate-500">Select Eligible Batches</label>
                  <div className="flex flex-wrap gap-2">
                    {["FRESHMAN", "YEAR_2", "YEAR_3", "YEAR_4", "YEAR_5", "GRADUATE"].map((b) => {
                      const isSelected = createForm.audienceBatches.includes(b);
                      return (
                        <button
                          key={b}
                          type="button"
                          onClick={() => {
                            const next = isSelected
                              ? createForm.audienceBatches.filter((x) => x !== b)
                              : [...createForm.audienceBatches, b];
                            setCreateForm({ ...createForm, audienceBatches: next });
                          }}
                          className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
                            isSelected
                              ? "bg-blue-600 text-white"
                              : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                          }`}
                        >
                          {b}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block mb-1">Required Sessions for Completion</label>
                  <input
                    type="number"
                    min="1"
                    value={createForm.requiredSessions}
                    onChange={(e) => setCreateForm({ ...createForm, requiredSessions: e.target.value })}
                    placeholder="e.g. 6 (optional)"
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block mb-1">Default Late Grace (Minutes)</label>
                  <input
                    type="number"
                    min="0"
                    value={createForm.defaultLateGraceMinutes}
                    onChange={(e) => setCreateForm({ ...createForm, defaultLateGraceMinutes: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
                >
                  Create Study
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ADD SESSIONS MODAL */}
      {isAddSessionsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-xl rounded-3xl bg-white p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-3">
              <h2 className="text-xl font-bold text-slate-900">Add Sessions to Study</h2>
              <button
                type="button"
                onClick={() => setIsAddSessionsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold"
              >
                ✕
              </button>
            </div>

            {/* Mode Selector */}
            <div className="grid grid-cols-3 gap-2">
              {(["one-time", "weekly", "custom"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setSessionMode(mode)}
                  className={`rounded-xl border py-2 text-xs font-bold capitalize transition ${
                    sessionMode === mode
                      ? "border-blue-600 bg-blue-50 text-blue-700 shadow-xs"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {mode === "one-time" ? "Single Session" : mode === "weekly" ? "Weekly Series" : "Custom Dates"}
                </button>
              ))}
            </div>

            <form onSubmit={handleAddSessions} className="space-y-4 text-xs font-semibold text-slate-700">
              {sessionMode === "one-time" && (
                <>
                  <div>
                    <label className="block mb-1">Session Title</label>
                    <input
                      type="text"
                      required
                      value={oneTimeForm.title}
                      onChange={(e) => setOneTimeForm({ ...oneTimeForm, title: e.target.value })}
                      placeholder="e.g. Study 3: Chanting Practice"
                      className="w-full rounded-xl border border-slate-200 p-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block mb-1">Session Type</label>
                    <select
                      value={oneTimeForm.sessionType}
                      onChange={(e) => setOneTimeForm({ ...oneTimeForm, sessionType: e.target.value as SessionType })}
                      className="w-full rounded-xl border border-slate-200 p-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                    >
                      <option value="EVENING">Evening (Standard)</option>
                      <option value="OVERNIGHT">Overnight Vigil (Sleepover)</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block mb-1">Start Date & Time</label>
                      <input
                        type="datetime-local"
                        required
                        value={oneTimeForm.startTime}
                        onChange={(e) => setOneTimeForm({ ...oneTimeForm, startTime: e.target.value })}
                        className="w-full rounded-xl border border-slate-200 p-2.5 text-sm text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block mb-1">End Date & Time</label>
                      <input
                        type="datetime-local"
                        required
                        value={oneTimeForm.endTime}
                        onChange={(e) => setOneTimeForm({ ...oneTimeForm, endTime: e.target.value })}
                        className="w-full rounded-xl border border-slate-200 p-2.5 text-sm text-slate-900"
                      />
                    </div>
                  </div>
                </>
              )}

              {sessionMode === "weekly" && (
                <>
                  <div>
                    <label className="block mb-1">Series Base Title</label>
                    <input
                      type="text"
                      required
                      value={weeklyForm.title}
                      onChange={(e) => setWeeklyForm({ ...weeklyForm, title: e.target.value })}
                      placeholder="e.g. Weekly Hymn Session"
                      className="w-full rounded-xl border border-slate-200 p-2.5 text-sm text-slate-900"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block mb-1">Session Type</label>
                      <select
                        value={weeklyForm.sessionType}
                        onChange={(e) => setWeeklyForm({ ...weeklyForm, sessionType: e.target.value as SessionType })}
                        className="w-full rounded-xl border border-slate-200 p-2.5 text-sm text-slate-900"
                      >
                        <option value="EVENING">Evening</option>
                        <option value="OVERNIGHT">Overnight</option>
                      </select>
                    </div>
                    <div>
                      <label className="block mb-1">Number of Weeks (Sessions)</label>
                      <input
                        type="number"
                        min="1"
                        max="20"
                        value={weeklyForm.recurrenceLengthWeeks}
                        onChange={(e) => setWeeklyForm({ ...weeklyForm, recurrenceLengthWeeks: Number(e.target.value) })}
                        className="w-full rounded-xl border border-slate-200 p-2.5 text-sm text-slate-900"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block mb-1">Week 1 Start</label>
                      <input
                        type="datetime-local"
                        required
                        value={weeklyForm.startTime}
                        onChange={(e) => setWeeklyForm({ ...weeklyForm, startTime: e.target.value })}
                        className="w-full rounded-xl border border-slate-200 p-2.5 text-sm text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block mb-1">Week 1 End</label>
                      <input
                        type="datetime-local"
                        required
                        value={weeklyForm.endTime}
                        onChange={(e) => setWeeklyForm({ ...weeklyForm, endTime: e.target.value })}
                        className="w-full rounded-xl border border-slate-200 p-2.5 text-sm text-slate-900"
                      />
                    </div>
                  </div>
                </>
              )}

              {sessionMode === "custom" && (
                <div className="space-y-3">
                  <p className="text-xs text-slate-500">Specify explicit dates/times for each session:</p>
                  {customFormSessions.map((item, idx) => (
                    <div key={idx} className="rounded-2xl border border-slate-100 bg-slate-50/50 p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900 text-xs">Session #{idx + 1}</span>
                        {customFormSessions.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setCustomFormSessions(customFormSessions.filter((_, i) => i !== idx))}
                            className="text-red-500 hover:text-red-700 text-xs"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                      <input
                        type="text"
                        value={item.title}
                        onChange={(e) => {
                          const next = [...customFormSessions];
                          next[idx].title = e.target.value;
                          setCustomFormSessions(next);
                        }}
                        placeholder="Session Title"
                        className="w-full rounded-lg border border-slate-200 p-2 text-xs"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="datetime-local"
                          required
                          value={item.startTime}
                          onChange={(e) => {
                            const next = [...customFormSessions];
                            next[idx].startTime = e.target.value;
                            setCustomFormSessions(next);
                          }}
                          className="w-full rounded-lg border border-slate-200 p-2 text-xs"
                        />
                        <input
                          type="datetime-local"
                          required
                          value={item.endTime}
                          onChange={(e) => {
                            const next = [...customFormSessions];
                            next[idx].endTime = e.target.value;
                            setCustomFormSessions(next);
                          }}
                          className="w-full rounded-lg border border-slate-200 p-2 text-xs"
                        />
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      setCustomFormSessions([
                        ...customFormSessions,
                        {
                          title: `Session ${customFormSessions.length + 1}`,
                          sessionType: "EVENING",
                          startTime: "",
                          endTime: "",
                          location: "Main Chapel",
                        },
                      ])
                    }
                    className="w-full rounded-xl border border-dashed border-slate-300 py-2 text-xs font-semibold text-blue-600 hover:bg-blue-50"
                  >
                    + Add Another Session
                  </button>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => setIsAddSessionsModalOpen(false)}
                  className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
                >
                  Generate Sessions
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default StudiesPage;
