import React, { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import api, { getPromotePreview } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import type { Member, PromotePreviewResponse } from "../types/members";
import { usePersistentState } from "../hooks/usePersistentState";

type StatusFilter = "ALL" | "ACTIVE" | "INACTIVE";
type GenderFilter = "ALL" | "MALE" | "FEMALE" | "UNSPECIFIED";
type BatchFilter =
  | "ALL"
  | "FRESHMAN"
  | "YEAR_2"
  | "YEAR_3"
  | "YEAR_4"
  | "YEAR_5"
  | "GRADUATE";
type SortOption =
  | "ALPHA_ASC"
  | "ALPHA_DESC"
  | "MOST_ATTENDANCE"
  | "LEAST_ATTENDANCE"
  | "RECENTLY_REGISTERED";

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

export interface DashboardMember extends Member {
  attendanceCount: number;
}

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

const MembersPage: React.FC = () => {
  const [members, setMembers] = useState<DashboardMember[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Filters and Sorting State
  const [statusFilter, setStatusFilter] = usePersistentState<StatusFilter>(
    "members-status-filter",
    "ALL",
  );
  const [genderFilter, setGenderFilter] = usePersistentState<GenderFilter>(
    "members-gender-filter",
    "ALL",
  );
  const [batchFilter, setBatchFilter] = usePersistentState<BatchFilter>(
    "members-batch-filter",
    "ALL",
  );
  const [sortBy, setSortBy] = usePersistentState<SortOption>(
    "members-sort-by",
    "ALPHA_ASC",
  );
  // Search State
  const [searchQuery, setSearchQuery] = usePersistentState<string>(
    "members-search-query",
    "",
  );
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(searchQuery);
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);

  const searchInputRef = React.useRef<HTMLInputElement | null>(null);

  // Promote Preview State (SUPER_ADMIN)
  const [isPromoteModalOpen, setIsPromoteModalOpen] = useState(false);
  const [promoteLoading, setPromoteLoading] = useState(false);
  const [promoteData, setPromoteData] = useState<PromotePreviewResponse | null>(null);
  const [promoteError, setPromoteError] = useState("");
  const [promoteSearch, setPromoteSearch] = useState("");

  const navigate = useNavigate();
  const location = useLocation();
  const { logout, admin } = useAuth();
  const isSuperAdmin = admin?.role === "SUPER_ADMIN";

  // Debounce effect
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    fetchMembers();
  }, []);

  useEffect(() => {
    if (
      location.state &&
      (location.state as { registered?: boolean }).registered
    ) {
      setSuccessMessage("Member registered successfully.");
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.pathname, location.state, navigate]);

  useEffect(() => {
    if (!successMessage) return;
    const timer = window.setTimeout(() => setSuccessMessage(""), 3500);
    return () => window.clearTimeout(timer);
  }, [successMessage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearchQuery, statusFilter, genderFilter, batchFilter, sortBy]);

  const fetchMembers = async () => {
    setLoading(true);
    try {
      const response = await api.get("/members");
      const fetchedMembers = response.data?.members || response.data || [];

      const mappedMembers: DashboardMember[] = fetchedMembers.map((m: any) => ({
        ...m,
        effectiveBatch: m.effectiveBatch || m.batch,
        attendanceCount: m._count?.attendances || m.attendanceCount || 0,
      }));
      setMembers(mappedMembers);
    } catch (err: any) {
      console.error("Error fetching members:", err);
      setError("Failed to load members.");
    } finally {
      setLoading(false);
    }
  };

  const handleExportExcel = async () => {
    try {
      setIsExporting(true);
      setError("");

      const response = await api.get("/members/export/excel", {
        responseType: "blob",
        params: {
          status: statusFilter,
          gender: genderFilter,
          sortBy,
          q: debouncedSearchQuery,
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
    } catch (err: any) {
      console.error("Error exporting members excel:", err);
      setError(
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

  // Filter and Sort Logic
  const filteredMembers = members.filter((m) => {
    const matchStatus =
      statusFilter === "ALL" ||
      (statusFilter === "ACTIVE" && m.isActive) ||
      (statusFilter === "INACTIVE" && !m.isActive);

    const matchGender =
      genderFilter === "ALL" ||
      (genderFilter === "UNSPECIFIED" && !m.gender) ||
      (genderFilter !== "UNSPECIFIED" && m.gender === genderFilter);

    const effectiveB = m.effectiveBatch || m.batch;
    const matchBatch =
      batchFilter === "ALL" || effectiveB === batchFilter;

    const q = debouncedSearchQuery.toLowerCase().trim();
    const matchSearch =
      q === "" ||
      m.name.toLowerCase().includes(q) ||
      m.uniqueId.toLowerCase().includes(q) ||
      (m.phoneNumber && m.phoneNumber.toLowerCase().includes(q)) ||
      (m.email && m.email.toLowerCase().includes(q)) ||
      (m.campus && m.campus.toLowerCase().includes(q));

    return matchStatus && matchGender && matchBatch && matchSearch;
  });

  const getMatchRank = (m: DashboardMember, q: string) => {
    if (!q) return 4;
    if (m.name.toLowerCase().includes(q)) return 0;
    if (m.email && m.email.toLowerCase().includes(q)) return 1;
    if (m.uniqueId && m.uniqueId.toLowerCase().includes(q)) return 2;
    if (m.phoneNumber && m.phoneNumber.toLowerCase().includes(q)) return 3;
    return 4;
  };

  const sortedAndFilteredMembers = (() => {
    const q = debouncedSearchQuery.toLowerCase().trim();
    const withRank = filteredMembers.map((m) => ({
      m,
      rank: getMatchRank(m, q),
    }));

    withRank.sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;

      switch (sortBy) {
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
  })();

  const totalPages = Math.max(
    1,
    Math.ceil(sortedAndFilteredMembers.length / UI_PAGE_SIZE),
  );

  const paginatedMembers = sortedAndFilteredMembers.slice(
    (currentPage - 1) * UI_PAGE_SIZE,
    currentPage * UI_PAGE_SIZE,
  );

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

  return (
    <div className="min-h-screen bg-gray-50 pb-24 relative">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 fixed top-0 w-full z-30">
        <div className="px-4 pt-6 max-w-4xl mx-auto w-full">
          <div className="flex justify-between items-center mb-4">
            <h1 className="text-2xl font-bold text-gray-900">Members</h1>
            <div className="flex items-center gap-2">
              <div className="flex items-center">
                <div className="relative flex items-center">
                  <div
                    className={`flex items-center transition-all duration-300 ease-in-out overflow-hidden rounded-md ${
                      isSearchExpanded || searchQuery ? "w-40 sm:w-48" : "w-10"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (!isSearchExpanded) {
                          setIsSearchExpanded(true);
                          setTimeout(() => searchInputRef.current?.focus(), 80);
                        } else {
                          searchInputRef.current?.focus();
                        }
                      }}
                      className="flex-shrink-0 p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md bg-white/0"
                      aria-label="Open search"
                    >
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                        />
                      </svg>
                    </button>

                    <input
                      ref={searchInputRef}
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onBlur={() => {
                        if (!searchQuery) setIsSearchExpanded(false);
                      }}
                      placeholder="Search members..."
                      className={`ml-2 w-full border border-transparent text-sm bg-transparent focus:outline-none focus:ring-0 transition-opacity duration-200 ${
                        isSearchExpanded || searchQuery
                          ? "opacity-100 px-2 py-1.5"
                          : "opacity-0 pointer-events-none p-0"
                      }`}
                    />
                  </div>
                </div>
              </div>
              <button
                onClick={async () => {
                  await logout();
                  navigate("/login", { replace: true });
                }}
                className="text-sm font-medium text-red-600 bg-red-50 px-3 py-1.5 rounded-md flex-shrink-0"
              >
                Logout
              </button>
            </div>
          </div>

          {/* Tab Navigation */}
          <nav className="flex space-x-4">
            <button
              onClick={() => navigate("/events")}
              className={`pb-2 px-1 text-sm font-medium border-b-2 transition-colors ${
                location.pathname === "/events"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              Events
            </button>
            <button
              onClick={() => navigate("/studies")}
              className={`pb-2 px-1 text-sm font-medium border-b-2 transition-colors ${
                location.pathname === "/studies"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              Studies
            </button>
            <button
              onClick={() => navigate("/members")}
              className={`pb-2 px-1 text-sm font-medium border-b-2 transition-colors ${
                location.pathname === "/members"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              Members
            </button>
            <button
              onClick={() => navigate("/dashboard")}
              className={`pb-2 px-1 text-sm font-medium border-b-2 transition-colors ${
                location.pathname === "/dashboard"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              Dashboard
            </button>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto w-full px-4 pt-32 sm:pt-40 pb-6 space-y-4">
        {successMessage && (
          <div className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-700">
            {successMessage}
          </div>
        )}

        {/* Filters & Actions Bar */}
        <div className="flex flex-col mb-2 relative">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            {/* Desktop and Mobile Filters */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Batch Filter */}
              <select
                value={batchFilter}
                onChange={(e) => setBatchFilter(e.target.value as BatchFilter)}
                className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                <option value="ALL">All Batches</option>
                <option value="FRESHMAN">Freshman</option>
                <option value="YEAR_2">Year 2</option>
                <option value="YEAR_3">Year 3</option>
                <option value="YEAR_4">Year 4</option>
                <option value="YEAR_5">Year 5</option>
                <option value="GRADUATE">Graduate</option>
              </select>

              {/* Status Filter */}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                <option value="ALL">All Status</option>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>

              {/* Gender Filter */}
              <select
                value={genderFilter}
                onChange={(e) => setGenderFilter(e.target.value as GenderFilter)}
                className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                <option value="ALL">All Genders</option>
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
              </select>

              {/* Sort Selector */}
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                <option value="ALPHA_ASC">Name (A-Z)</option>
                <option value="ALPHA_DESC">Name (Z-A)</option>
                <option value="MOST_ATTENDANCE">Most Attendance</option>
                <option value="LEAST_ATTENDANCE">Least Attendance</option>
                <option value="RECENTLY_REGISTERED">Recently Registered</option>
              </select>
            </div>

            {/* Action Buttons: Promote Preview & Excel */}
            <div className="flex items-center gap-2">
              {isSuperAdmin && (
                <button
                  type="button"
                  onClick={handleOpenPromotePreview}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-50 border border-purple-200 rounded-lg text-xs font-bold text-purple-700 hover:bg-purple-100 transition shadow-sm"
                  title="Preview batch auto-promotion and graduation"
                >
                  <span>🎓</span>
                  Promote Preview
                </button>
              )}

              <button
                type="button"
                onClick={() => void handleExportExcel()}
                disabled={loading || isExporting}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs font-bold text-emerald-700 hover:bg-emerald-100 transition disabled:opacity-60"
              >
                {isExporting ? (
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-emerald-300 border-t-emerald-700" />
                ) : (
                  <span>⬇</span>
                )}
                Export Excel
              </button>
            </div>
          </div>

          <div className="text-xs text-gray-500 font-medium">
            Showing {sortedAndFilteredMembers.length} of {members.length} members
          </div>
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 p-4 rounded-xl text-sm border border-red-100">
            {error}
          </div>
        )}

        {/* Member Cards List */}
        {loading ? (
          <div className="space-y-4 animate-pulse">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="bg-white rounded-xl h-28 w-full border border-gray-100"
              />
            ))}
          </div>
        ) : sortedAndFilteredMembers.length === 0 ? (
          <div className="text-center py-12 px-4 bg-white rounded-xl border border-gray-100 border-dashed">
            <h3 className="text-lg font-bold text-gray-900 mb-1">
              No Members Found
            </h3>
            <p className="text-gray-500 text-sm">
              We couldn't find any members matching your criteria.
            </p>
          </div>
        ) : (
          paginatedMembers.map((member) => {
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
                className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 transition-all hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
              >
                <div className="flex justify-between items-start mb-2 gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-base sm:text-lg font-bold text-gray-900 leading-tight">
                        {member.name}
                      </h3>
                      {/* Effective Batch Badge */}
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                        {formatBatchLabel(effectiveBatchStr)}
                      </span>

                      {/* Override flag */}
                      {member.batchOverride && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                          Override
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 mt-1 flex items-center gap-2">
                      <span>ID: {member.uniqueId}</span>
                      <span>·</span>
                      <span>Campus: {formatCampusLabel(member.campus)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2.5 py-0.5 text-xs font-bold rounded-full border whitespace-nowrap ${
                        member.isActive
                          ? "bg-green-100 text-green-800 border-green-200"
                          : "bg-red-100 text-red-800 border-red-200"
                      }`}
                    >
                      {member.isActive ? "Active" : "Inactive"}
                    </span>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        navigate(`/members/${member.id}/edit`);
                      }}
                      className="inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-semibold bg-gray-50 text-gray-700 hover:bg-gray-100 border border-gray-200"
                    >
                      ✏️ Edit
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 mt-3 pt-3 border-t border-gray-100 text-xs text-gray-600">
                  <div className="flex items-center gap-3">
                    {member.phoneNumber && (
                      <span className="font-medium text-gray-700">
                        📞 {member.phoneNumber}
                      </span>
                    )}
                    {member.email && (
                      <span className="text-gray-500 truncate max-w-[200px]">
                        ✉️ {member.email}
                      </span>
                    )}
                  </div>
                  <div className="font-semibold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-md border border-purple-100">
                    {member.attendanceCount} attended
                  </div>
                </div>
              </div>
            );
          })
        )}

        {/* Pagination */}
        {!loading && totalPages > 1 && sortedAndFilteredMembers.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex items-center justify-between gap-3 mt-4">
            <button
              type="button"
              onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>

            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span className="font-semibold text-gray-900">
                Page {currentPage}
              </span>
              <span>of {totalPages}</span>
            </div>

            <button
              type="button"
              onClick={() =>
                setCurrentPage((prev) => Math.min(totalPages, prev + 1))
              }
              disabled={currentPage === totalPages}
              className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        )}
      </div>

      {/* Floating Action Button */}
      <button
        onClick={() => navigate("/members/register")}
        className="fixed bottom-6 right-4 md:bottom-8 md:right-8 bg-blue-600 shadow-lg hover:bg-blue-700 text-white rounded-full h-14 px-5 flex items-center justify-center z-10 font-medium active:scale-95 transition-all"
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
          />
        </svg>
        Register Member
      </button>

      {/* Promote Preview Modal (SUPER_ADMIN) */}
      {isPromoteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 px-4 py-6">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl flex flex-col">
            <div className="flex items-start justify-between gap-4 border-b border-gray-100 pb-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                  <span>🎓</span> Academic Year Batch Upgrade Preview
                </h2>
                <p className="mt-1 text-xs text-gray-500">
                  Batches are dynamically computed from each member's entry academic year and campus program duration (4 vs 5 years). This preview is read-only.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsPromoteModalOpen(false)}
                className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            {promoteLoading ? (
              <div className="py-16 flex flex-col items-center justify-center">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
                <p className="mt-3 text-sm text-gray-500 font-medium">
                  Calculating progression rules...
                </p>
              </div>
            ) : promoteError ? (
              <div className="my-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                {promoteError}
              </div>
            ) : promoteData ? (
              <div className="mt-4 space-y-4">
                {/* Summary Metrics */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 text-center">
                    <p className="text-xs font-semibold uppercase text-gray-400">
                      Active Members
                    </p>
                    <p className="mt-1 text-2xl font-bold text-gray-900">
                      {promoteData.summary.totalActive}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-center">
                    <p className="text-xs font-semibold uppercase text-blue-500">
                      Advancing Next Year
                    </p>
                    <p className="mt-1 text-2xl font-bold text-blue-700">
                      {promoteData.summary.promotingCount}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-purple-100 bg-purple-50 p-4 text-center">
                    <p className="text-xs font-semibold uppercase text-purple-500">
                      Graduating Next Year
                    </p>
                    <p className="mt-1 text-2xl font-bold text-purple-700">
                      {promoteData.summary.graduatingCount}
                    </p>
                  </div>
                </div>

                {/* Search */}
                <div>
                  <input
                    type="text"
                    value={promoteSearch}
                    onChange={(e) => setPromoteSearch(e.target.value)}
                    placeholder="Search preview by name, campus, or batch..."
                    className="w-full rounded-xl border border-gray-200 px-3.5 py-2 text-xs text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </div>

                {/* Table */}
                <div className="overflow-x-auto rounded-2xl border border-gray-100">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-gray-50 text-gray-500 uppercase tracking-wider font-semibold">
                      <tr>
                        <th className="py-3 px-4">Member</th>
                        <th className="py-3 px-3">Campus</th>
                        <th className="py-3 px-3">Current Effective Batch</th>
                        <th className="py-3 px-3">Next Year's Batch</th>
                        <th className="py-3 px-4 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredPromoteList.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-8 text-center text-gray-400 italic">
                            No member transitions match your search.
                          </td>
                        </tr>
                      ) : (
                        filteredPromoteList.map((row) => (
                          <tr key={row.id} className="hover:bg-gray-50/80">
                            <td className="py-3 px-4 font-bold text-gray-900">
                              <div>{row.name}</div>
                              <div className="text-[10px] text-gray-400 font-normal">
                                {row.uniqueId}
                              </div>
                            </td>
                            <td className="py-3 px-3 text-gray-600">
                              {formatCampusLabel(row.campus)}
                            </td>
                            <td className="py-3 px-3 font-medium text-gray-700">
                              {formatBatchLabel(row.currentBatch)}
                              {row.hasOverride && (
                                <span className="ml-1 text-[9px] bg-amber-100 text-amber-800 px-1 py-0.5 rounded">
                                  override
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-3 font-bold text-blue-700">
                              {formatBatchLabel(row.nextBatch)}
                            </td>
                            <td className="py-3 px-4 text-right">
                              {row.isGraduating ? (
                                <span className="inline-block rounded-full bg-purple-100 px-2.5 py-0.5 text-[11px] font-bold text-purple-800">
                                  🎓 Graduating
                                </span>
                              ) : row.isPromoting ? (
                                <span className="inline-block rounded-full bg-blue-100 px-2.5 py-0.5 text-[11px] font-bold text-blue-800">
                                  ↑ Advancing
                                </span>
                              ) : (
                                <span className="inline-block rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-medium text-gray-600">
                                  Unchanged
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
            ) : null}

            <div className="mt-6 flex justify-end border-t border-gray-100 pt-3">
              <button
                type="button"
                onClick={() => setIsPromoteModalOpen(false)}
                className="rounded-xl bg-gray-900 px-5 py-2 text-sm font-semibold text-white hover:bg-gray-800"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MembersPage;
