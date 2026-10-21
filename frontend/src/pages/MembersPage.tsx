import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api, { getPromotePreview } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import type { Member, PromotePreviewResponse } from "../types/members";
import { usePersistedViewState } from "../hooks/usePersistedViewState";

import PageLayout from "../components/layout/PageLayout";
import PageHeader from "../components/layout/PageHeader";
import FilterBar from "../components/shared/FilterBar";
import EmptyState from "../components/shared/EmptyState";
import CopyPhoneButton from "../components/shared/CopyPhoneButton";
import CopyAllPhonesDropdown from "../components/shared/CopyAllPhonesDropdown";
import MemberFormDrawer from "../components/members/MemberFormDrawer";

import {
  Users,
  UserPlus,
  Download,
  GraduationCap,
  Edit,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  RotateCcw,
} from "lucide-react";

export interface DashboardMember extends Member {
  attendanceCount: number;
}

const UI_PAGE_SIZE = 15;

const sanitizeDownloadFileName = (value: string) =>
  value
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ") || "members";

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
  return extracted || fallback || "members.xlsx";
};

const formatBatchLabel = (b?: string | null) => {
  if (!b) return "—";
  if (b === "FRESHMAN") return "Freshman";
  if (b === "GRADUATE") return "Graduate";
  return b
    .replace("_", " ")
    .split(" ")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
};

const formatCampusLabel = (c?: string | null) => {
  if (!c) return "—";
  return c
    .replace("_", " ")
    .split(" ")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
};

export const MembersPage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { admin } = useAuth();
  const isSuperAdmin = admin?.role === "SUPER_ADMIN";

  // URL-persisted view state (Item 4)
  const { viewState, setViewState, resetFilters } = usePersistedViewState("members", {
    defaults: {
      q: "",
      status: "ALL",
      gender: "ALL",
      batch: "ALL",
      sortBy: "ALPHA_ASC",
      page: 1,
    },
  });

  // Drawer state for Register / Edit (Item 10)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [memberToEdit, setMemberToEdit] = useState<Member | null>(null);

  // Promote Preview Modal state (SUPER_ADMIN)
  const [isPromoteModalOpen, setIsPromoteModalOpen] = useState(false);
  const [promoteLoading, setPromoteLoading] = useState(false);
  const [promoteData, setPromoteData] = useState<PromotePreviewResponse | null>(null);
  const [promoteError, setPromoteError] = useState("");
  const [promoteSearch, setPromoteSearch] = useState("");

  // Toast feedback
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const [isExporting, setIsExporting] = useState<boolean>(false);

  // Data fetching with TanStack Query (cached, zero flicker)
  const {
    data: members = [],
    isLoading,
    isError,
    error: fetchError,
    refetch,
  } = useQuery<DashboardMember[]>({
    queryKey: ["members"],
    queryFn: async () => {
      const response = await api.get("/members");
      const fetched = response.data?.members || response.data || [];
      return fetched.map((m: any) => ({
        ...m,
        effectiveBatch: m.effectiveBatch || m.batch,
        attendanceCount: m._count?.attendances || m.attendanceCount || 0,
      }));
    },
    staleTime: 60 * 1000,
  });

  const handleExportExcel = async () => {
    try {
      setIsExporting(true);
      const response = await api.get("/members/export/excel", {
        responseType: "blob",
        params: {
          status: viewState.status,
          gender: viewState.gender,
          sortBy: viewState.sortBy,
          q: viewState.q,
        },
      });

      const headerFileName = getFileNameFromContentDisposition(
        response.headers["content-disposition"],
      );
      const fileName =
        headerFileName || `${sanitizeDownloadFileName("members")}.xlsx`;
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
      showToast("Excel exported successfully");
    } catch (err: any) {
      showToast(
        err?.response?.data?.error ||
          err?.response?.data?.message ||
          "Failed to export members.",
      );
    } finally {
      setIsExporting(false);
    }
  };

  const handleOpenPromotePreview = async () => {
    setIsPromoteModalOpen(true);
    setPromoteLoading(true);
    setPromoteError("");
    try {
      const data = await getPromotePreview();
      setPromoteData(data);
    } catch (err: any) {
      setPromoteError(
        err.response?.data?.error || "Failed to load promote preview.",
      );
    } finally {
      setPromoteLoading(false);
    }
  };

  // Filter & Search Logic
  const filteredMembers = React.useMemo(() => {
    return members.filter((m) => {
      const matchStatus =
        viewState.status === "ALL" ||
        (viewState.status === "ACTIVE" && m.isActive) ||
        (viewState.status === "INACTIVE" && !m.isActive);

      const matchGender =
        viewState.gender === "ALL" ||
        (viewState.gender === "UNSPECIFIED" && !m.gender) ||
        (viewState.gender !== "UNSPECIFIED" && m.gender === viewState.gender);

      const effectiveB = m.effectiveBatch || m.batch;
      const matchBatch =
        viewState.batch === "ALL" || effectiveB === viewState.batch;

      const q = viewState.q.toLowerCase().trim();
      const matchSearch =
        q === "" ||
        m.name.toLowerCase().includes(q) ||
        m.uniqueId.toLowerCase().includes(q) ||
        Boolean(m.phoneNumber && m.phoneNumber.toLowerCase().includes(q)) ||
        Boolean(m.email && m.email.toLowerCase().includes(q)) ||
        Boolean(m.campus && m.campus.toLowerCase().includes(q));

      return matchStatus && matchGender && matchBatch && matchSearch;
    });
  }, [members, viewState.status, viewState.gender, viewState.batch, viewState.q]);

  const getMatchRank = (m: DashboardMember, q: string) => {
    if (!q) return 4;
    if (m.name.toLowerCase().includes(q)) return 0;
    if (m.email && m.email.toLowerCase().includes(q)) return 1;
    if (m.uniqueId && m.uniqueId.toLowerCase().includes(q)) return 2;
    if (m.phoneNumber && m.phoneNumber.toLowerCase().includes(q)) return 3;
    return 4;
  };

  const sortedAndFilteredMembers = React.useMemo(() => {
    const q = viewState.q.toLowerCase().trim();
    const withRank = filteredMembers.map((m) => ({
      m,
      rank: getMatchRank(m, q),
    }));

    withRank.sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;

      switch (viewState.sortBy) {
        case "ALPHA_ASC":
          return a.m.name.localeCompare(b.m.name);
        case "ALPHA_DESC":
          return b.m.name.localeCompare(a.m.name);
        case "MOST_ATTENDANCE":
          return b.m.attendanceCount - a.m.attendanceCount;
        case "LEAST_ATTENDANCE":
          return a.m.attendanceCount - b.m.attendanceCount;
        case "RECENTLY_REGISTERED":
          return (
            new Date(b.m.createdAt || 0).getTime() -
            new Date(a.m.createdAt || 0).getTime()
          );
        default:
          return 0;
      }
    });

    return withRank.map((x) => x.m);
  }, [filteredMembers, viewState.q, viewState.sortBy]);

  const totalPages = Math.max(
    1,
    Math.ceil(sortedAndFilteredMembers.length / UI_PAGE_SIZE),
  );
  const currentPage = Math.min(Math.max(1, viewState.page), totalPages);

  const paginatedMembers = React.useMemo(() => {
    return sortedAndFilteredMembers.slice(
      (currentPage - 1) * UI_PAGE_SIZE,
      currentPage * UI_PAGE_SIZE,
    );
  }, [sortedAndFilteredMembers, currentPage]);

  const filteredPromoteList = (promoteData?.preview || []).filter((p) => {
    const q = promoteSearch.toLowerCase().trim();
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      p.uniqueId.toLowerCase().includes(q) ||
      p.campus.toLowerCase().includes(q) ||
      p.currentBatch.toLowerCase().includes(q) ||
      p.nextBatch.toLowerCase().includes(q)
    );
  });

  useEffect(() => {
    document.title = "Members";
  }, []);

  return (
    <PageLayout>
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl bg-slate-900 text-white px-4 py-2.5 text-xs font-bold shadow-2xl transition animate-in fade-in slide-in-from-bottom-2">
          {toastMessage}
        </div>
      )}

      {/* Page Header (Item 2 & 5) */}
      <PageHeader
        title="Members"
      >
        <div className="flex flex-wrap items-center gap-2">
          {/* Promote Preview (SUPER_ADMIN) */}
          {isSuperAdmin && (
            <button
              type="button"
              onClick={handleOpenPromotePreview}
              className="inline-flex items-center gap-1.5 rounded-xl border border-purple-200 bg-purple-50 px-3 py-2 text-xs font-bold text-purple-700 hover:bg-purple-100 transition shadow-2xs"
              title="Preview batch auto-promotion and graduation"
            >
              <GraduationCap className="w-3.5 h-3.5" />
              <span>Promote Preview</span>
            </button>
          )}

          {/* Export Excel */}
          <button
            type="button"
            onClick={() => void handleExportExcel()}
            disabled={isLoading || isExporting}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition shadow-2xs disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>{isExporting ? "Exporting..." : "Export Excel"}</span>
          </button>

          {/* Register Member Drawer Trigger (Item 10) */}
          <button
            type="button"
            onClick={() => {
              setMemberToEdit(null);
              setIsDrawerOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-bold text-white shadow-sm hover:bg-blue-700 transition active:scale-[0.98]"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Register Member</span>
          </button>
        </div>
      </PageHeader>

      {/* Filter and Control Bar (Item 4 & 11) */}
      <FilterBar
        searchQuery={viewState.q}
        onSearchChange={(q) => setViewState({ q, page: 1 })}
        searchPlaceholder="Search members by name, ID, phone, or campus..."
        activeFilterCount={
          (viewState.batch !== "ALL" ? 1 : 0) +
          (viewState.status !== "ALL" ? 1 : 0) +
          (viewState.gender !== "ALL" ? 1 : 0) +
          (viewState.sortBy !== "ALPHA_ASC" ? 1 : 0)
        }
        rightActions={
          <div className="flex items-center gap-3">
            <div className="text-xs font-semibold text-slate-500 whitespace-nowrap">
              {sortedAndFilteredMembers.length} {sortedAndFilteredMembers.length === 1 ? "member" : "members"}
            </div>
            <CopyAllPhonesDropdown
              members={sortedAndFilteredMembers}
              onToast={(msg) => showToast(msg)}
              label="Copy Phones"
            />
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition shadow-sm"
              title="Reset all member filters"
            >
              <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
              <span>Reset filters</span>
            </button>
          </div>
        }
      >
        <select
          value={viewState.batch}
          onChange={(e) => setViewState({ batch: e.target.value, page: 1 })}
          className="rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-white focus:border-blue-500 focus:outline-none"
        >
          <option value="ALL">All Batches</option>
          <option value="FRESHMAN">Freshman</option>
          <option value="YEAR_2">Year 2</option>
          <option value="YEAR_3">Year 3</option>
          <option value="YEAR_4">Year 4</option>
          <option value="YEAR_5">Year 5</option>
          <option value="GRADUATE">Graduate</option>
        </select>

        <select
          value={viewState.status}
          onChange={(e) => setViewState({ status: e.target.value, page: 1 })}
          className="rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-white focus:border-blue-500 focus:outline-none"
        >
          <option value="ALL">All Status</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </select>

        <select
          value={viewState.gender}
          onChange={(e) => setViewState({ gender: e.target.value, page: 1 })}
          className="rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-white focus:border-blue-500 focus:outline-none"
        >
          <option value="ALL">All Genders</option>
          <option value="MALE">Male</option>
          <option value="FEMALE">Female</option>
        </select>

        <select
          value={viewState.sortBy}
          onChange={(e) => setViewState({ sortBy: e.target.value, page: 1 })}
          className="rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-white focus:border-blue-500 focus:outline-none"
        >
          <option value="ALPHA_ASC">Name (A-Z)</option>
          <option value="ALPHA_DESC">Name (Z-A)</option>
          <option value="MOST_ATTENDANCE">Most Attendance</option>
          <option value="LEAST_ATTENDANCE">Least Attendance</option>
          <option value="RECENTLY_REGISTERED">Recently Registered</option>
        </select>
      </FilterBar>

      {/* Error state */}
      {isError && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600" />
            <span>{(fetchError as Error)?.message || "Failed to load members."}</span>
          </div>
          <button
            type="button"
            onClick={() => void refetch()}
            className="rounded-lg bg-rose-600 px-2.5 py-1 text-white font-bold hover:bg-rose-700"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading Skeleton */}
      {isLoading && (
        <div className="space-y-3 animate-pulse">
          {[1, 2, 3, 4, 5].map((n) => (
            <div
              key={n}
              className="h-20 rounded-2xl border border-slate-200/80 bg-white"
            />
          ))}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && sortedAndFilteredMembers.length === 0 && (
        <EmptyState
          icon={Users}
          title="No members found"
          description={
            viewState.q || viewState.batch !== "ALL" || viewState.status !== "ALL"
              ? "No members match your current filters. Try resetting or adjusting search keywords."
              : "No members have been registered yet in the system."
          }
          actionLabel={
            viewState.q || viewState.batch !== "ALL" || viewState.status !== "ALL"
              ? "Reset Filters"
              : "Register First Member"
          }
          onAction={() => {
            if (viewState.q || viewState.batch !== "ALL" || viewState.status !== "ALL") {
              setViewState({
                q: "",
                status: "ALL",
                gender: "ALL",
                batch: "ALL",
                sortBy: "ALPHA_ASC",
                page: 1,
              });
            } else {
              setMemberToEdit(null);
              setIsDrawerOpen(true);
            }
          }}
        />
      )}

      {/* Members List */}
      {!isLoading && sortedAndFilteredMembers.length > 0 && (
        <div className="space-y-2.5">
          {paginatedMembers.map((member) => {
            const effectiveBatchStr = member.effectiveBatch || member.batch;
            return (
              <div
                key={member.id}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/members/${member.id}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    navigate(`/members/${member.id}`);
                  }
                }}
                className="group relative rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xs hover:border-blue-400 hover:shadow-md transition cursor-pointer"
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  {/* Left: Info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-base font-bold text-slate-900 group-hover:text-blue-600 transition leading-tight">
                        {member.name}
                      </h3>

                      {/* Effective Cohort Pill */}
                      <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700 border border-blue-200/60">
                        {formatBatchLabel(effectiveBatchStr)}
                      </span>

                      {/* Manual Override Tag */}
                      {member.batchOverride && (
                        <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 border border-amber-200">
                          Override
                        </span>
                      )}

                      {/* Status indicator */}
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold border ${
                          member.isActive
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : "bg-slate-100 text-slate-600 border-slate-200"
                        }`}
                      >
                        {member.isActive ? "Active" : "Inactive"}
                      </span>
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span>ID: <strong className="text-slate-700">{member.uniqueId}</strong></span>
                      <span>·</span>
                      <span>Campus: {formatCampusLabel(member.campus)}</span>
                      {member.department && (
                        <>
                          <span>·</span>
                          <span>Dept: {member.department}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Right: Phone, Stats, Actions */}
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3 justify-between sm:justify-end border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-100">
                    {/* Individual Phone Copy Button (Item 11) */}
                    {member.phoneNumber ? (
                      <div
                        className="flex items-center gap-1 text-xs font-semibold text-slate-700 bg-slate-50 px-2.5 py-1 rounded-xl border border-slate-200/60"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span>{member.phoneNumber}</span>
                        <CopyPhoneButton
                          phoneNumber={member.phoneNumber}
                          onCopied={() => showToast(`Copied ${member.name}'s phone`)}
                        />
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400 italic">No phone</span>
                    )}

                    {/* Attendance count */}
                    <div className="rounded-xl bg-purple-50 px-2.5 py-1 text-xs font-bold text-purple-700 border border-purple-200/60">
                      {member.attendanceCount} {member.attendanceCount === 1 ? "session" : "sessions"}
                    </div>

                    {/* Edit Drawer Trigger (Item 10) */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMemberToEdit(member);
                        setIsDrawerOpen(true);
                      }}
                      className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-slate-100 transition"
                    >
                      <Edit className="w-3 h-3 text-slate-500" />
                      <span>Edit</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination Controls */}
      {!isLoading && totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-slate-200 pt-4">
          <span className="text-xs font-semibold text-slate-500">
            Page {currentPage} of {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setViewState({ page: currentPage - 1 })}
              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition disabled:opacity-40"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Previous</span>
            </button>
            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => setViewState({ page: currentPage + 1 })}
              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition disabled:opacity-40"
            >
              <span>Next</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Member Form Drawer (Item 10) */}
      <MemberFormDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        memberToEdit={memberToEdit}
        onSuccess={(saved) => {
          showToast(`Saved member ${saved.name}`);
          void queryClient.invalidateQueries({ queryKey: ["members"] });
        }}
      />

      {/* Promote Preview Modal (SUPER_ADMIN) */}
      {isPromoteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8 backdrop-blur-xs">
          <div className="w-full max-w-4xl max-h-[85vh] rounded-2xl bg-white shadow-2xl border border-slate-200 flex flex-col overflow-hidden animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <GraduationCap className="w-5 h-5 text-purple-600" />
                  Cohort Auto-Promotion Preview
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Total Active: <strong>{promoteData?.summary?.totalActive ?? 0}</strong> · Graduating: <strong>{promoteData?.summary?.graduatingCount ?? 0}</strong> · Promoting: <strong>{promoteData?.summary?.promotingCount ?? 0}</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsPromoteModalOpen(false)}
                className="rounded-xl px-3 py-1.5 text-xs font-bold text-slate-500 hover:bg-slate-100 transition"
              >
                Close
              </button>
            </div>

            <div className="p-4 border-b border-slate-100 bg-slate-50/50">
              <input
                type="text"
                value={promoteSearch}
                onChange={(e) => setPromoteSearch(e.target.value)}
                placeholder="Search promotion list by name, ID, or campus..."
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-800 shadow-2xs focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
              {promoteLoading ? (
                <div className="space-y-2 animate-pulse">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="h-12 rounded-xl bg-slate-100" />
                  ))}
                </div>
              ) : promoteError ? (
                <div className="rounded-xl bg-rose-50 p-4 text-xs font-semibold text-rose-700 border border-rose-200">
                  {promoteError}
                </div>
              ) : filteredPromoteList.length === 0 ? (
                <div className="text-center py-10 text-xs text-slate-400">
                  No preview records found.
                </div>
              ) : (
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500 font-bold">
                      <th className="pb-2">Name</th>
                      <th className="pb-2">Campus</th>
                      <th className="pb-2">Current Cohort</th>
                      <th className="pb-2">Projected Next Cohort</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredPromoteList.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50">
                        <td className="py-2.5 font-bold text-slate-900">{p.name}</td>
                        <td className="py-2.5 text-slate-600">{p.campus}</td>
                        <td className="py-2.5">
                          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700">
                            {p.currentBatch}
                          </span>
                        </td>
                        <td className="py-2.5">
                          <span
                            className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${
                              p.nextBatch === "GRADUATE"
                                ? "bg-purple-100 text-purple-800"
                                : "bg-blue-100 text-blue-800"
                            }`}
                          >
                            {p.nextBatch}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </PageLayout>
  );
};

export default MembersPage;
