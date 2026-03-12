import React, { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import api from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import type { Member } from "../types/members";

type StatusFilter = "ALL" | "ACTIVE" | "INACTIVE";
type SortOption =
  | "ALPHA_ASC"
  | "ALPHA_DESC"
  | "MOST_ATTENDANCE"
  | "LEAST_ATTENDANCE";

const UI_PAGE_SIZE = 15;

// Extending Member to include attendance count if the backend returns it
export interface DashboardMember extends Member {
  attendanceCount: number;
}

const MembersPage: React.FC = () => {
  const [members, setMembers] = useState<DashboardMember[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Filters and Sorting State
  // Default to ALL
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [sortBy, setSortBy] = useState<SortOption>("ALPHA_ASC");
  const [isSortModalOpen, setIsSortModalOpen] = useState(false);

  // Search State
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");

  const sortDropdownRef = React.useRef<HTMLDivElement>(null);

  const navigate = useNavigate();
  const location = useLocation();
  const { logout } = useAuth();

  // Debounce effect
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    fetchMembers();

    const handleClickOutside = (event: MouseEvent) => {
      if (
        sortDropdownRef.current &&
        !sortDropdownRef.current.contains(event.target as Node)
      ) {
        setIsSortModalOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
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
    if (!successMessage) {
      return;
    }

    const timer = window.setTimeout(() => setSuccessMessage(""), 3500);
    return () => window.clearTimeout(timer);
  }, [successMessage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearchQuery, statusFilter, sortBy]);

  const fetchMembers = async () => {
    setLoading(true);
    try {
      const response = await api.get("/members");
      const fetchedMembers = response.data?.members || response.data || [];

      const mappedMembers: DashboardMember[] = fetchedMembers.map((m: any) => ({
        ...m,
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

  // Filter and Sort Logic
  const filteredMembers = members.filter((m) => {
    const matchStatus =
      statusFilter === "ALL" ||
      (statusFilter === "ACTIVE" && m.isActive) ||
      (statusFilter === "INACTIVE" && !m.isActive);

    const q = debouncedSearchQuery.toLowerCase().trim();
    const matchSearch =
      q === "" ||
      m.name.toLowerCase().includes(q) ||
      m.uniqueId.toLowerCase().includes(q) ||
      (m.phoneNumber && m.phoneNumber.toLowerCase().includes(q)) ||
      (m.email && m.email.toLowerCase().includes(q));

    return matchStatus && matchSearch;
  });

  // When searching, prioritize name matches first, then email, then ID, then phone.
  const getMatchRank = (m: DashboardMember, q: string) => {
    if (!q) return 4; // no search -> lowest priority for ranking
    if (m.name.toLowerCase().includes(q)) return 0;
    if (m.email && m.email.toLowerCase().includes(q)) return 1;
    if (m.uniqueId && m.uniqueId.toLowerCase().includes(q)) return 2;
    if (m.phoneNumber && m.phoneNumber.toLowerCase().includes(q)) return 3;
    return 4;
  };

  const sortedAndFilteredMembers = (() => {
    const q = debouncedSearchQuery.toLowerCase().trim();
    // attach rank
    const withRank = filteredMembers.map((m) => ({
      m,
      rank: getMatchRank(m, q),
    }));

    withRank.sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;

      // if same rank, apply selected sort
      switch (sortBy) {
        case "ALPHA_ASC":
          return a.m.name.localeCompare(b.m.name);
        case "ALPHA_DESC":
          return b.m.name.localeCompare(a.m.name);
        case "MOST_ATTENDANCE":
          return b.m.attendanceCount - a.m.attendanceCount;
        case "LEAST_ATTENDANCE":
          return a.m.attendanceCount - b.m.attendanceCount;
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

  const getSortLabel = (sortValue: SortOption) => {
    switch (sortValue) {
      case "ALPHA_ASC":
        return "Alphabetical (A → Z)";
      case "ALPHA_DESC":
        return "Alphabetical (Z → A)";
      case "MOST_ATTENDANCE":
        return "Most Attendance";
      case "LEAST_ATTENDANCE":
        return "Least Attendance";
      default:
        return "";
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-24 relative">
      {/* Header */}
      <header className="bg-white px-4 pt-6 pb-4 border-b border-gray-200 sticky top-0 z-20">
        <div className="flex justify-between items-center mb-4 max-w-4xl mx-auto w-full">
          <h1 className="text-2xl font-bold text-gray-900">Members</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate("/members/register")}
              className="text-sm font-medium text-white bg-blue-600 px-3 py-1.5 rounded-md shadow-sm hover:bg-blue-700 transition-colors"
            >
              Register
            </button>
            <button
              onClick={async () => {
                await logout();
                navigate("/login", { replace: true });
              }}
              className="text-sm font-medium text-red-600 bg-red-50 px-3 py-1.5 rounded-md"
            >
              Logout
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="max-w-4xl mx-auto w-full mb-4">
          <nav className="flex space-x-4 border-b border-gray-200">
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
              disabled
              className="pb-2 px-1 text-sm font-medium border-b-2 border-transparent text-gray-300 cursor-not-allowed"
            >
              Dashboard
            </button>
          </nav>
        </div>

        <div className="max-w-4xl mx-auto w-full">
          {successMessage && (
            <div className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-700">
              {successMessage}
            </div>
          )}

          {/* Search Bar */}
          <div className="relative mb-4">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg
                className="w-5 h-5 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                ></path>
              </svg>
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, ID, phone, or email..."
              className="w-full pl-10 pr-10 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors placeholder-gray-400 text-gray-900"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
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
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            )}
          </div>

          {/* Filters & Sort */}
          <div className="flex flex-col mb-2 relative">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="flex overflow-x-auto no-scrollbar gap-2 pb-1 flex-1">
                {(["ALL", "ACTIVE", "INACTIVE"] as StatusFilter[]).map(
                  (filter) => (
                    <button
                      key={filter}
                      onClick={() => setStatusFilter(filter)}
                      className={`whitespace-nowrap px-4 py-1.5 rounded-full text-sm font-medium transition-colors border ${
                        statusFilter === filter
                          ? filter === "ACTIVE"
                            ? "bg-green-600 text-white border-green-600"
                            : filter === "INACTIVE"
                              ? "bg-red-600 text-white border-red-600"
                              : "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                      }`}
                    >
                      {filter === "ALL"
                        ? "All"
                        : filter.charAt(0) + filter.slice(1).toLowerCase()}
                    </button>
                  ),
                )}
              </div>

              {/* Sort Button */}
              <div className="relative flex-shrink-0" ref={sortDropdownRef}>
                <button
                  onClick={() => setIsSortModalOpen(!isSortModalOpen)}
                  className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors mb-1"
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
                      d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12"
                    ></path>
                  </svg>
                  <span className="hidden sm:inline">Sort</span>
                </button>

                {isSortModalOpen && (
                  <div className="absolute right-0 mt-2 w-56 bg-white border border-gray-100 rounded-xl shadow-lg z-50 py-2">
                    <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Sort By
                    </div>
                    {(
                      [
                        "ALPHA_ASC",
                        "ALPHA_DESC",
                        "MOST_ATTENDANCE",
                        "LEAST_ATTENDANCE",
                      ] as SortOption[]
                    ).map((option) => (
                      <button
                        key={option}
                        onClick={() => {
                          setSortBy(option);
                          setIsSortModalOpen(false);
                        }}
                        className={`w-full text-left px-4 py-2 text-sm flex items-center justify-between hover:bg-gray-50 transition-colors ${
                          sortBy === option
                            ? "font-semibold text-blue-600"
                            : "text-gray-700"
                        }`}
                      >
                        {getSortLabel(option)}
                        {sortBy === option && (
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
                              d="M5 13l4 4L19 7"
                            ></path>
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto w-full px-4 py-6 space-y-4">
        {error && (
          <div className="bg-red-50 text-red-600 p-4 rounded-xl text-sm border border-red-100">
            {error}
          </div>
        )}

        {loading ? (
          <div className="space-y-4 animate-pulse">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="bg-white rounded-xl h-32 w-full border border-gray-100"
              ></div>
            ))}
          </div>
        ) : sortedAndFilteredMembers.length === 0 ? (
          <div className="text-center py-12 px-4 bg-white rounded-xl border border-gray-100 border-dashed">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-50 mb-4">
              <svg
                className="w-8 h-8 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                ></path>
              </svg>
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-1">
              No Members Found
            </h3>
            <p className="text-gray-500 text-sm">
              We couldn't find any members matching your criteria.
            </p>
          </div>
        ) : (
          paginatedMembers.map((member) => (
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
              className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 transition-shadow hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
            >
              <div className="flex justify-between items-start mb-2 gap-3">
                <div>
                  <h3 className="text-lg font-bold text-gray-900 leading-tight">
                    {member.name}
                  </h3>
                  <div className="text-xs text-gray-500 mt-1">
                    ID: {member.uniqueId}
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <span
                    className={`px-2.5 py-1 text-xs font-bold rounded-full border whitespace-nowrap ${
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
                    className="inline-flex items-center rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors bg-blue-50 text-blue-700 hover:bg-blue-100"
                  >
                    ✏️ Edit
                  </button>
                </div>
              </div>

              <div className="space-y-1.5 text-sm text-gray-600 mt-3 pt-3 border-t border-gray-100">
                {member.phoneNumber && (
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
                        d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                      ></path>
                    </svg>
                    {member.phoneNumber}
                  </div>
                )}
                {member.email && (
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
                        d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                      ></path>
                    </svg>
                    <span className="truncate">{member.email}</span>
                  </div>
                )}
              </div>
            </div>
          ))
        )}

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
            d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
          ></path>
        </svg>
        Register Member
      </button>

      {/* Global override for hiding scrollbar visually in pill filters while retaining functionality */}
      <style>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
};

export default MembersPage;
