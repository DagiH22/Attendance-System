import React, { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api, {
  getStudies,
  getStudyStats,
  getStudyNotParticipating,
  exportStudyNotParticipatingExcel,
  updateStudy,
  deleteStudy,
} from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import formatDate from "../lib/formatDate";
import type {
  Study,
  StudyStatsResponse,
  NotParticipatingResponse,
} from "../types/events";
import { usePersistedViewState } from "../hooks/usePersistedViewState";

import PageLayout from "../components/layout/PageLayout";
import PageHeader from "../components/layout/PageHeader";
import NewSplitButton from "../components/shared/NewSplitButton";
import EmptyState from "../components/shared/EmptyState";
import CopyPhoneButton from "../components/shared/CopyPhoneButton";
import CopyAllPhonesDropdown from "../components/shared/CopyAllPhonesDropdown";
import StudyFormDrawer from "../components/studies/StudyFormDrawer";
import SessionFormDrawer from "../components/sessions/SessionFormDrawer";

import {
  BookOpen,
  Download,
  Plus,
  Edit,
  Archive,
  Trash2,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Search,
  RotateCcw,
} from "lucide-react";

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

const formatBatch = (batch?: string | null) => {
  if (!batch) return "—";
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

export const StudiesPage: React.FC = () => {
  const navigate = useNavigate();
  const { admin } = useAuth();
  const queryClient = useQueryClient();
  const isSuperAdmin = admin?.role === "SUPER_ADMIN";

  // Item 4: Persisted View State Hook
  const { viewState, setField, resetFilters } = usePersistedViewState("studies", {
    defaults: {
      studyId: "",
      gridSearch: "",
      gridCampus: "ALL",
      gridBatch: "ALL",
      notPartSearch: "",
      notPartCampus: "ALL",
      notPartBatch: "ALL",
      notPartDept: "ALL",
      notPartHideOther: false,
      notPartPage: 1,
    },
  });

  // Drawers & Modals
  const [isStudyDrawerOpen, setIsStudyDrawerOpen] = useState(false);
  const [studyToEdit, setStudyToEdit] = useState<Study | null>(null);
  const [isSessionDrawerOpen, setIsSessionDrawerOpen] = useState(false);
  const [deleteConfirmStudy, setDeleteConfirmStudy] = useState<{
    study: Study;
    sessionCount: number;
  } | null>(null);

  const [toastMessage, setToastMessage] = useState<{
    text: string;
    tone: "success" | "error";
  } | null>(null);

  const showToast = (text: string, tone: "success" | "error" = "success") => {
    setToastMessage({ text, tone });
    setTimeout(() => setToastMessage(null), 3500);
  };

  // 1. Fetch Studies list with TanStack Query (Item 3)
  const { data: studies = [], isLoading: isLoadingStudies } = useQuery<Study[]>({
    queryKey: ["studies"],
    queryFn: getStudies,
  });

  // Item 4: Default selection logic:
  // "A user's chosen study overrides the default until that study no longer exists or has ended."
  const activeStudyId = useMemo(() => {
    if (viewState.studyId) {
      const chosen = studies.find((s) => s.id === viewState.studyId);
      if (chosen && chosen.isActive && new Date(chosen.endDate) >= new Date()) {
        return chosen.id;
      }
    }
    if (studies.length === 0) return "";
    // Default to first active ongoing study or first study
    const ongoing = studies.find((s) => s.isActive && new Date(s.endDate) >= new Date());
    return ongoing ? ongoing.id : studies[0].id;
  }, [viewState.studyId, studies]);

  useEffect(() => {
    if (activeStudyId && activeStudyId !== viewState.studyId) {
      setField("studyId", activeStudyId);
    }
  }, [activeStudyId, viewState.studyId, setField]);

  const selectedStudy = useMemo(() => {
    return studies.find((s) => s.id === activeStudyId) || null;
  }, [studies, activeStudyId]);

  // 2. Fetch Study Stats & Grid with TanStack Query
  const { data: statsData, isLoading: isLoadingStats } = useQuery<StudyStatsResponse>({
    queryKey: ["study-stats", activeStudyId],
    queryFn: () => getStudyStats(activeStudyId),
    enabled: Boolean(activeStudyId),
  });

  // 3. Fetch Not Participating Members with TanStack Query
  const notPartParams = useMemo(() => {
    return {
      search: viewState.notPartSearch.trim() || undefined,
      campus: viewState.notPartCampus !== "ALL" ? viewState.notPartCampus : undefined,
      batch: viewState.notPartBatch !== "ALL" ? viewState.notPartBatch : undefined,
      department: viewState.notPartDept !== "ALL" ? viewState.notPartDept : undefined,
      hideOther: viewState.notPartHideOther ? "true" : undefined,
      page: viewState.notPartPage,
      limit: 15,
    };
  }, [
    viewState.notPartSearch,
    viewState.notPartCampus,
    viewState.notPartBatch,
    viewState.notPartDept,
    viewState.notPartHideOther,
    viewState.notPartPage,
  ]);

  const { data: notPartData, isLoading: isLoadingNotPart } = useQuery<NotParticipatingResponse>({
    queryKey: ["study-not-participating", activeStudyId, notPartParams],
    queryFn: () => getStudyNotParticipating(activeStudyId, notPartParams),
    enabled: Boolean(activeStudyId),
  });

  // Study progress calculation
  const progressInfo = useMemo(() => {
    if (!statsData) return { completedSessions: 0, totalSessions: 0, percent: 0 };
    const total = statsData.study.totalSessions ?? statsData.study.sessionCount ?? statsData.sessionSeries.length;
    const now = new Date();
    const completed = statsData.sessionSeries.filter(
      (s) => new Date(s.endTime) <= now && !s.isCancelled,
    ).length;
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { completedSessions: completed, totalSessions: total, percent };
  }, [statsData]);

  // Filtered Study Grid rows
  const filteredGridRows = useMemo(() => {
    if (!statsData?.grid) return [];
    return statsData.grid.filter((row) => {
      if (viewState.gridSearch.trim()) {
        const q = viewState.gridSearch.toLowerCase();
        const matchesName = row.name.toLowerCase().includes(q);
        const matchesId = row.uniqueId.toLowerCase().includes(q);
        if (!matchesName && !matchesId) return false;
      }
      if (viewState.gridCampus !== "ALL" && row.campus !== viewState.gridCampus) {
        return false;
      }
      if (viewState.gridBatch !== "ALL" && row.effectiveBatch !== viewState.gridBatch) {
        return false;
      }
      return true;
    });
  }, [statsData?.grid, viewState.gridSearch, viewState.gridCampus, viewState.gridBatch]);

  // Member phone numbers for "Not participating" section copy
  const notParticipatingPhoneList = useMemo(() => {
    if (!notPartData?.members) return [];
    return notPartData.members.map((m) => ({
      name: m.name,
      phoneNumber: m.phoneNumber,
    }));
  }, [notPartData?.members]);

  // Actions
  const handleToggleArchive = async () => {
    if (!selectedStudy) return;
    try {
      const nextActive = !selectedStudy.isActive;
      await updateStudy(selectedStudy.id, { isActive: nextActive });
      void queryClient.invalidateQueries({ queryKey: ["studies"] });
      showToast(nextActive ? "Study unarchived." : "Study archived successfully.");
    } catch (e: any) {
      showToast(e.message || "Failed to update study status.", "error");
    }
  };

  const handleDeleteRequest = () => {
    if (!selectedStudy) return;
    const count = selectedStudy.sessionCount ?? statsData?.study.totalSessions ?? 0;
    setDeleteConfirmStudy({ study: selectedStudy, sessionCount: count });
  };

  const handleConfirmDelete = async (moveSessionsToStandalone: boolean) => {
    if (!deleteConfirmStudy) return;
    try {
      await deleteStudy(deleteConfirmStudy.study.id, moveSessionsToStandalone);
      setDeleteConfirmStudy(null);
      void queryClient.invalidateQueries({ queryKey: ["studies"] });
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
      showToast("Study deleted successfully.");
    } catch (e: any) {
      showToast(e.message || "Failed to delete study.", "error");
    }
  };

  const handleExportStudyExcel = async () => {
    if (!selectedStudy) return;
    try {
      const res = await api.get(`/studies/${selectedStudy.id}/export/excel`, {
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `${selectedStudy.name.replace(/\s+/g, "_")}_grid.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      showToast("Study grid exported to Excel.");
    } catch (e: any) {
      showToast("Failed to export Excel.", "error");
    }
  };

  const handleExportNotPartExcel = async () => {
    if (!selectedStudy) return;
    try {
      const blob = await exportStudyNotParticipatingExcel(selectedStudy.id, notPartParams);
      const url = window.URL.createObjectURL(new Blob([blob]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `${selectedStudy.name.replace(/\s+/g, "_")}_not_participating.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      showToast("Not participating report exported to Excel.");
    } catch (e: any) {
      showToast("Failed to export Excel.", "error");
    }
  };

  useEffect(() => {
    document.title = "Studies";
  }, []);

  return (
    <PageLayout>
      {/* Shared Page Header (Item 2 & 5) */}
      <PageHeader
        title="Studies"
      >
        <NewSplitButton
          primaryLabel="New Study"
          onNewStudy={() => {
            setStudyToEdit(null);
            setIsStudyDrawerOpen(true);
          }}
          onNewSession={() => setIsSessionDrawerOpen(true)}
          isSuperAdmin={isSuperAdmin}
        />
      </PageHeader>

      {/* Toast Feedback */}
      {toastMessage && (
        <div
          className={`rounded-2xl border p-4 text-xs font-bold shadow-sm transition animate-in fade-in ${
            toastMessage.tone === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-800"
          }`}
        >
          {toastMessage.text}
        </div>
      )}

      {/* Studies Navigation & Action Bar */}
      <div className="flex flex-col gap-4 rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 items-center gap-3 flex-wrap">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Select Study:
          </label>
          <select
            value={activeStudyId}
            onChange={(e) => setField("studyId", e.target.value)}
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-900 focus:border-blue-500 focus:outline-none"
          >
            {studies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} {!s.isActive ? "(Archived)" : ""} ({formatDate(s.startDate)} -{" "}
                {formatDate(s.endDate)})
              </option>
            ))}
          </select>

          {selectedStudy && (
            <span
              className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${
                selectedStudy.isActive
                  ? "bg-blue-50 text-blue-700 border-blue-200"
                  : "bg-slate-100 text-slate-600 border-slate-200"
              }`}
            >
              {selectedStudy.audienceType === "FINAL_YEAR"
                ? "🎓 Final Year"
                : selectedStudy.audienceType === "BATCHES"
                ? `🏷️ ${selectedStudy.audienceBatches.join(", ")}`
                : "👥 Everyone"}
              {!selectedStudy.isActive && " • Archived"}
            </span>
          )}
        </div>

        {/* Study Management Actions (Item 8) */}
        {selectedStudy && isSuperAdmin && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setIsSessionDrawerOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100 transition shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Session</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setStudyToEdit(selectedStudy);
                setIsStudyDrawerOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition shadow-sm"
              title="Edit study parameters & audience"
            >
              <Edit className="w-3.5 h-3.5 text-slate-500" />
              <span>Edit Study</span>
            </button>

            <button
              type="button"
              onClick={handleToggleArchive}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition shadow-sm"
              title={selectedStudy.isActive ? "Archive study" : "Unarchive study"}
            >
              <Archive className="w-3.5 h-3.5 text-slate-500" />
              <span>{selectedStudy.isActive ? "Archive" : "Unarchive"}</span>
            </button>

            <button
              type="button"
              onClick={handleDeleteRequest}
              className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100 transition shadow-sm"
              title="Delete study"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-600" />
              <span>Delete</span>
            </button>

            <button
              type="button"
              onClick={handleExportStudyExcel}
              className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100 transition shadow-sm"
            >
              <Download className="w-3.5 h-3.5 text-emerald-600" />
              <span>Export (.xlsx)</span>
            </button>

            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition shadow-sm"
              title="Reset all filters on this page to defaults"
            >
              <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
              <span>Reset filters</span>
            </button>
          </div>
        )}
      </div>

      {/* Loading State or No Studies */}
      {isLoadingStudies || isLoadingStats ? (
        <div className="flex h-64 items-center justify-center rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col items-center gap-2">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
            <p className="text-xs font-medium text-slate-500">Loading study analytics & attendance grid...</p>
          </div>
        </div>
      ) : !selectedStudy || !statsData ? (
        <EmptyState
          icon={BookOpen}
          title="No studies created yet"
          description="Create your first study program to schedule sessions and track progress."
          actionLabel="Create Study"
          onAction={() => {
            setStudyToEdit(null);
            setIsStudyDrawerOpen(true);
          }}
        />
      ) : (
        <>
          {/* KPI Stat Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Progress */}
            <div className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Study Progress</p>
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
            <div className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Average Turnout</p>
              <div className="mt-2 flex items-baseline justify-between">
                <p className="text-3xl font-black text-slate-900">
                  {statsData.averageTurnout !== null ? `${Math.round(statsData.averageTurnout * 100)}%` : "—"}
                </p>
                <span className="text-xs font-semibold text-emerald-600">Active</span>
              </div>
              <p className="mt-3 text-xs text-slate-500">Across all completed study sessions</p>
            </div>

            {/* Target Audience */}
            <div className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Target Audience</p>
              <div className="mt-2">
                <span className="inline-flex items-center rounded-lg bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700">
                  {statsData.study.audienceType === "ALL"
                    ? "All Registered Members"
                    : statsData.study.audienceType === "FINAL_YEAR"
                    ? "Final Year (Graduating)"
                    : `Batches: ${statsData.study.audienceBatches.join(", ")}`}
                </span>
              </div>
              <p className="mt-3 text-xs text-slate-500">
                {statsData.study.requiredSessions
                  ? `Completion rule: ${statsData.study.requiredSessions} required sessions`
                  : "No minimum required threshold"}
              </p>
            </div>

            {/* Perfect Attendance */}
            <div className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Perfect Attendance</p>
              <div className="mt-2 flex items-baseline justify-between">
                <p className="text-3xl font-black text-emerald-700">
                  {statsData.attendedAllMembers.length}
                </p>
                <span className="text-xs font-bold text-slate-400">
                  {statsData.attendedNoneMembers.length} missed all
                </span>
              </div>
              <p className="mt-3 text-xs text-slate-500">Attended 100% of study sessions</p>
            </div>
          </div>

          {/* Dedicated "Not Participating" Section with Phone Copying (Item 11) */}
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between border-b border-slate-100 pb-4">
              <div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h2 className="text-lg font-bold text-slate-900">
                    Not Participating
                    {notPartData && (
                      <span className="font-semibold text-slate-600 ml-1.5 text-base">
                        ({notPartData.totalNotParticipating} of {notPartData.totalEligible} eligible)
                      </span>
                    )}
                  </h2>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Eligible members who have not attended any session of this study
                </p>
              </div>

              {/* Copy All Phone Numbers Dropdown (Item 11) */}
              <div className="flex items-center gap-2 flex-wrap">
                <CopyAllPhonesDropdown
                  members={notParticipatingPhoneList}
                  onToast={(msg, tone) => showToast(msg, tone)}
                />
                <button
                  type="button"
                  onClick={handleExportNotPartExcel}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-sm"
                >
                  <Download className="w-3.5 h-3.5 text-slate-500" />
                  <span>Export Excel</span>
                </button>
              </div>
            </div>

            {/* Filter controls */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-[200px] flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={viewState.notPartSearch}
                  onChange={(e) => setField("notPartSearch", e.target.value)}
                  placeholder="Search by name, ID, or phone..."
                  className="w-full rounded-xl border border-slate-200 pl-9 pr-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-blue-500"
                />
              </div>

              <select
                value={viewState.notPartCampus}
                onChange={(e) => setField("notPartCampus", e.target.value)}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700"
              >
                <option value="ALL">All Campuses</option>
                <option value="FOUR_KILO">4 Kilo</option>
                <option value="FIVE_KILO">5 Kilo</option>
                <option value="SIX_KILO">6 Kilo</option>
                <option value="ART">Art</option>
              </select>

              <select
                value={viewState.notPartBatch}
                onChange={(e) => setField("notPartBatch", e.target.value)}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700"
              >
                <option value="ALL">All Batches</option>
                <option value="FRESHMAN">Freshman</option>
                <option value="YEAR_2">Year 2</option>
                <option value="YEAR_3">Year 3</option>
                <option value="YEAR_4">Year 4</option>
                <option value="YEAR_5">Year 5</option>
                <option value="GRADUATE">Graduate</option>
              </select>

              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={viewState.notPartHideOther}
                  onChange={(e) => setField("notPartHideOther", e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span>Hide members attending another study</span>
              </label>
            </div>

            {/* Not Participating List */}
            {isLoadingNotPart ? (
              <div className="h-32 rounded-xl bg-slate-50 animate-pulse" />
            ) : notPartData?.members.length === 0 ? (
              <p className="text-xs italic text-slate-400 py-4 text-center">
                All eligible members have participated in at least one session!
              </p>
            ) : (
              <>
                {/* Mobile Card List (md:hidden) */}
                <div className="md:hidden space-y-3">
                  {notPartData?.members.map((m) => (
                    <div
                      key={m.id}
                      className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-2xs space-y-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() => navigate(`/members/${m.id}`)}
                            className="font-bold text-sm text-slate-900 hover:text-blue-600 text-left truncate block max-w-full"
                          >
                            {m.name}
                          </button>
                          <span className="block text-[11px] text-slate-400 mt-0.5">
                            ID: {m.uniqueId}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap justify-end">
                          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                            {formatCampus(m.campus)}
                          </span>
                          <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700 border border-blue-200/50">
                            {formatBatch(m.effectiveBatch || m.batch)}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 text-xs pt-2 border-t border-slate-100">
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-600 font-mono text-[11px]">
                            {m.phoneNumber || "No phone"}
                          </span>
                          {m.phoneNumber && (
                            <CopyPhoneButton
                              phoneNumber={m.phoneNumber}
                              onCopied={() => showToast(`Copied ${m.name}'s phone`)}
                            />
                          )}
                        </div>

                        <div>
                          {(m.attendedOtherStudies || m.attendingOtherStudy) &&
                          m.otherStudies &&
                          m.otherStudies.length > 0 ? (
                            <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700 border border-blue-200/60 max-w-[150px] truncate">
                              Attending: {m.otherStudies.map((s: { id: string; name: string }) => s.name).join(", ")}
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-400 italic">None</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Desktop Table (hidden md:block) */}
                <div className="hidden md:block overflow-x-auto rounded-2xl border border-slate-200">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase">
                      <tr>
                        <th className="p-3">Member</th>
                        <th className="p-3">Campus</th>
                        <th className="p-3">Batch</th>
                        <th className="p-3">Phone</th>
                        <th className="p-3">Other Studies Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {notPartData?.members.map((m) => (
                        <tr key={m.id} className="hover:bg-slate-50/60 transition">
                          <td className="p-3 font-semibold text-slate-900">
                            <button
                              type="button"
                              onClick={() => navigate(`/members/${m.id}`)}
                              className="hover:text-blue-600 hover:underline"
                            >
                              {m.name}
                            </button>
                            <span className="block text-[10px] text-slate-400 font-normal">
                              {m.uniqueId}
                            </span>
                          </td>
                          <td className="p-3 text-slate-600">{formatCampus(m.campus)}</td>
                          <td className="p-3 text-slate-600">{formatBatch(m.effectiveBatch || m.batch)}</td>
                          <td className="p-3 text-slate-600">
                            <div className="flex items-center gap-1.5">
                              <span>{m.phoneNumber || "—"}</span>
                              {/* Individual Phone Copy Button (Item 11) */}
                              <CopyPhoneButton
                                phoneNumber={m.phoneNumber}
                                onCopied={() => showToast(`Copied ${m.name}'s phone`)}
                              />
                            </div>
                          </td>
                          <td className="p-3 text-slate-600">
                            {(m.attendedOtherStudies || m.attendingOtherStudy) && m.otherStudies && m.otherStudies.length > 0 ? (
                              <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                                Attending: {m.otherStudies.map((s: { id: string; name: string }) => s.name).join(", ")}
                              </span>
                            ) : (
                              <span className="text-[11px] text-slate-400 italic">None</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* Pagination */}
            {notPartData && notPartData.totalPages > 1 && (
              <div className="flex items-center justify-between text-xs text-slate-500 pt-2">
                <span>
                  Page {notPartData.page} of {notPartData.totalPages}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={notPartData.page <= 1}
                    onClick={() => setField("notPartPage", notPartData.page - 1)}
                    className="p-1 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    disabled={notPartData.page >= notPartData.totalPages}
                    onClick={() => setField("notPartPage", notPartData.page + 1)}
                    className="p-1 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Study Attendance Matrix Grid */}
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Attendance Matrix</h2>
                <p className="text-xs text-slate-500">
                  Member check-in statuses across all study sessions
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={viewState.gridSearch}
                  onChange={(e) => setField("gridSearch", e.target.value)}
                  placeholder="Filter matrix by member..."
                  className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-blue-500"
                />
                <select
                  value={viewState.gridCampus}
                  onChange={(e) => setField("gridCampus", e.target.value)}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-700"
                >
                  <option value="ALL">All Campuses</option>
                  <option value="FOUR_KILO">4 Kilo</option>
                  <option value="FIVE_KILO">5 Kilo</option>
                  <option value="SIX_KILO">6 Kilo</option>
                  <option value="ART">Art</option>
                </select>
              </div>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-200 max-h-[500px]">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-50 z-20 border-b border-slate-200 text-slate-500 font-bold uppercase">
                  <tr>
                    <th className="sticky left-0 bg-slate-50 z-30 p-3">Member</th>
                    <th className="p-3">Campus</th>
                    <th className="p-3">Batch</th>
                    {statsData.sessionSeries.map((s, idx) => (
                      <th key={s.eventId} className="p-2 text-center whitespace-nowrap min-w-[40px]">
                        S{idx + 1}
                      </th>
                    ))}
                    <th className="p-3 text-center">Attended</th>
                    <th className="p-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredGridRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={statsData.sessionSeries.length + 5}
                        className="p-8 text-center text-slate-400 italic"
                      >
                        No members found matching filters.
                      </td>
                    </tr>
                  ) : (
                    filteredGridRows.map((row) => (
                      <tr key={row.memberId} className="hover:bg-slate-50/70 transition">
                        <td className="sticky left-0 bg-white hover:bg-slate-50 z-10 p-3 font-semibold text-slate-900 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => navigate(`/members/${row.memberId}`)}
                            className="text-blue-600 hover:underline"
                          >
                            {row.name}
                          </button>
                          <span className="block text-[10px] text-slate-400 font-normal">
                            {row.uniqueId}
                          </span>
                        </td>
                        <td className="p-3 text-slate-600 whitespace-nowrap">{formatCampus(row.campus)}</td>
                        <td className="p-3 text-slate-600 whitespace-nowrap">{formatBatch(row.effectiveBatch)}</td>
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
                            badgeStyle = "bg-rose-100 text-rose-800 font-bold";
                            text = "A";
                          }
                          return (
                            <td key={sess.eventId} className="p-2 text-center whitespace-nowrap">
                              <span
                                title={`${sess.title}: ${sess.status}`}
                                className={`inline-block w-6 h-6 leading-6 rounded-md text-[11px] ${badgeStyle}`}
                              >
                                {text}
                              </span>
                            </td>
                          );
                        })}
                        <td className="p-3 text-center font-bold text-slate-800 whitespace-nowrap">
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
      )}

      {/* Delete Study Confirmation Modal (Item 8) */}
      {deleteConfirmStudy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-rose-600">
              <AlertTriangle className="w-6 h-6" />
              <h3 className="text-lg font-bold text-slate-900">Delete Study</h3>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Are you sure you want to delete{" "}
              <span className="font-bold text-slate-900">{deleteConfirmStudy.study.name}</span>?
            </p>

            {deleteConfirmStudy.sessionCount > 0 ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900 space-y-2">
                <p className="font-bold">
                  ⚠️ This study has {deleteConfirmStudy.sessionCount} scheduled sessions!
                </p>
                <p>
                  Deleting a study with sessions directly is blocked. You can either move its
                  sessions to Standalone and delete the study container, or Archive it instead.
                </p>
                <div className="flex flex-col gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handleConfirmDelete(true)}
                    className="w-full rounded-xl bg-rose-600 py-2 text-xs font-bold text-white hover:bg-rose-700 transition"
                  >
                    Move Sessions to Standalone & Delete Study
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteConfirmStudy(null);
                      void handleToggleArchive();
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-white py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
                  >
                    Archive Study Instead
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setDeleteConfirmStudy(null)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleConfirmDelete(false)}
                  className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-700"
                >
                  Delete Empty Study
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Shared Drawers */}
      <StudyFormDrawer
        isOpen={isStudyDrawerOpen}
        onClose={() => setIsStudyDrawerOpen(false)}
        studyToEdit={studyToEdit}
        hasExistingAttendance={(statsData?.attendedAllMembers.length ?? 0) > 0}
        onSuccess={() => {
          void queryClient.invalidateQueries({ queryKey: ["studies"] });
          void queryClient.invalidateQueries({ queryKey: ["study-stats"] });
          showToast("Study updated successfully.");
        }}
      />

      <SessionFormDrawer
        isOpen={isSessionDrawerOpen}
        onClose={() => setIsSessionDrawerOpen(false)}
        preselectedStudyId={activeStudyId}
        onSuccess={() => {
          void queryClient.invalidateQueries({ queryKey: ["study-stats", activeStudyId] });
          void queryClient.invalidateQueries({ queryKey: ["sessions"] });
          showToast("Session added to study.");
        }}
      />
    </PageLayout>
  );
};

export default StudiesPage;
