import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api, { getStudies } from "../lib/api";
import formatDate from "../lib/formatDate";
import type { DashboardEvent, Study } from "../types/events";
import { useAuth } from "../contexts/AuthContext";
import { usePersistedViewState } from "../hooks/usePersistedViewState";
import {
  compareSessions,
  compareStudyGroups,
  type StudyGroupLike,
  type SortMode,
} from "../lib/sessionComparator";

import PageLayout from "../components/layout/PageLayout";
import PageHeader from "../components/layout/PageHeader";
import NewSplitButton from "../components/shared/NewSplitButton";
import FilterBar from "../components/shared/FilterBar";
import SortDropdown from "../components/shared/SortDropdown";
import StatusChip from "../components/shared/StatusChip";
import EmptyState from "../components/shared/EmptyState";
import SessionFormDrawer from "../components/sessions/SessionFormDrawer";
import StudyFormDrawer from "../components/studies/StudyFormDrawer";

import {
  Calendar,
  Layers,
  ChevronDown,
  ChevronRight,
  Plus,
  Clock,
  MapPin,
  Users,
} from "lucide-react";

const SORT_OPTIONS = [
  { value: "SMART", label: "Smart Order" },
  { value: "DATE", label: "Date" },
  { value: "NAME", label: "Name" },
  { value: "ATTENDANCE", label: "Attendance" },
  { value: "STATUS", label: "Status" },
];

const STATUS_FILTERS = [
  { value: "ALL", label: "All Statuses" },
  { value: "ACTIVE", label: "Active" },
  { value: "UPCOMING", label: "Upcoming" },
  { value: "PAST", label: "Past" },
  { value: "CANCELLED", label: "Cancelled" },
];

const mapEventToDashboardEvent = (event: any): DashboardEvent => {
  const startIso = event.startTime ?? event.eventDate;
  const eventStart = startIso ? new Date(startIso) : new Date();
  const eventEnd = event.endTime
    ? new Date(event.endTime)
    : new Date(eventStart.getTime() + 2 * 60 * 60 * 1000);

  return {
    id: event.id,
    title: event.title,
    description: event.description || "",
    startTime: event.startTime ?? eventStart.toISOString(),
    endTime: event.endTime ?? eventEnd.toISOString(),
    status: (event.status as DashboardEvent["status"]) ?? "UPCOMING",
    attendanceOpen: Boolean(event.attendanceOpen),
    location: event.location || "",
    eventType: event.type as DashboardEvent["eventType"],
    sessionType: event.sessionType || "EVENING",
    studyId: event.studyId || null,
    study: event.study || null,
    plannedStartTime: event.plannedStartTime || null,
    rescheduleReason: event.rescheduleReason || null,
    rescheduledAt: event.rescheduledAt || null,
    cancelReason: event.cancelReason || null,
    cancelledAt: event.cancelledAt || null,
    lateGraceMinutes: event.lateGraceMinutes ?? null,
    createdBy: {
      id: event.admin?.id || event.createdBy?.id || "unknown-admin",
      name: event.admin?.name || event.createdBy?.name || "Admin User",
    },
    attendanceCount: event._count?.attendances || event.attendanceCount || 0,
    createdAt: event.createdAt || eventStart.toISOString(),
    totalMembers: event.totalMembers || 0,
  };
};

export const EventsPage: React.FC = () => {
  const navigate = useNavigate();
  const { admin } = useAuth();
  const queryClient = useQueryClient();
  const isSuperAdmin = admin?.role === "SUPER_ADMIN";

  // Item 4: Persisted View State Hook (URL search params -> sessionStorage -> defaults)
  const { viewState, setField } = usePersistedViewState("sessions", {
    defaults: {
      search: "",
      status: "ALL",
      sessionType: "ALL",
      studyId: "ALL",
      sortBy: "SMART",
      sortDir: "asc" as "asc" | "desc",
      groupByStudy: true,
    },
  });

  // Drawer states (Item 10)
  const [isSessionDrawerOpen, setIsSessionDrawerOpen] = useState(false);
  const [sessionToEdit, setSessionToEdit] = useState<DashboardEvent | null>(null);
  const [drawerPreselectedStudyId, setDrawerPreselectedStudyId] = useState<string | null>(null);
  const [isStudyDrawerOpen, setIsStudyDrawerOpen] = useState(false);

  // Group collapse state
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // TanStack Query (Item 3: No full-page flash, cached data, background revalidation)
  const { data: rawEvents = [], isLoading: isLoadingEvents } = useQuery({
    queryKey: ["sessions"],
    queryFn: async () => {
      const res = await api.get("/events");
      const list = res.data?.events ?? res.data ?? [];
      return list.map(mapEventToDashboardEvent);
    },
  });

  const { data: studies = [] } = useQuery<Study[]>({
    queryKey: ["studies"],
    queryFn: getStudies,
  });

  // Filter sessions
  const filteredSessions = useMemo(() => {
    return rawEvents.filter((ev: DashboardEvent) => {
      if (viewState.search.trim()) {
        const q = viewState.search.toLowerCase();
        const matchesTitle = ev.title.toLowerCase().includes(q);
        const matchesDesc = ev.description.toLowerCase().includes(q);
        const matchesLoc = ev.location.toLowerCase().includes(q);
        if (!matchesTitle && !matchesDesc && !matchesLoc) return false;
      }

      if (viewState.status !== "ALL" && ev.status !== viewState.status) {
        return false;
      }

      if (viewState.sessionType !== "ALL" && ev.sessionType !== viewState.sessionType) {
        return false;
      }

      if (viewState.studyId !== "ALL") {
        if (viewState.studyId === "STANDALONE" && ev.studyId) return false;
        if (viewState.studyId !== "STANDALONE" && ev.studyId !== viewState.studyId) return false;
      }

      return true;
    });
  }, [rawEvents, viewState.search, viewState.status, viewState.sessionType, viewState.studyId]);

  // Item 5: Grouping built from STUDIES list (LEFT JOIN)
  const studyGroups = useMemo(() => {
    const map = new Map<string, StudyGroupLike<DashboardEvent>>();

    // Initialize with all studies (even empty ones!)
    for (const study of studies) {
      if (viewState.studyId !== "ALL" && viewState.studyId !== study.id) {
        continue;
      }
      map.set(study.id, {
        id: study.id,
        name: study.name,
        startDate: study.startDate,
        endDate: study.endDate,
        createdAt: study.createdAt,
        sessions: [],
      });
    }

    // Standalone group
    const standaloneGroup: StudyGroupLike<DashboardEvent> = {
      id: "STANDALONE",
      name: "Standalone Sessions",
      sessions: [],
    };

    // Distribute filtered sessions into groups
    for (const session of filteredSessions) {
      if (session.studyId && map.has(session.studyId)) {
        map.get(session.studyId)!.sessions.push(session);
      } else if (!session.studyId) {
        standaloneGroup.sessions.push(session);
      }
    }

    let groups = Array.from(map.values());

    // If Standalone group has sessions (or standalone filter is selected), include it
    if (
      standaloneGroup.sessions.length > 0 ||
      viewState.studyId === "STANDALONE"
    ) {
      groups.push(standaloneGroup);
    }

    // Item 7: in grouped mode, hide groups with no matching sessions UNLESS the filter is empty
    const hasActiveFilters =
      viewState.search.trim() !== "" ||
      viewState.status !== "ALL" ||
      viewState.sessionType !== "ALL";

    if (hasActiveFilters) {
      groups = groups.filter((g) => g.sessions.length > 0);
    }

    // Sort sessions inside each group using comparator (Item 6 & 7)
    for (const group of groups) {
      group.sessions.sort((a, b) =>
        compareSessions(a, b, viewState.sortBy as SortMode, viewState.sortDir),
      );
    }

    // Sort groups themselves using comparator (Item 6 & 7)
    groups.sort((a, b) =>
      compareStudyGroups(a, b, viewState.sortBy as SortMode, viewState.sortDir),
    );

    return groups;
  }, [
    studies,
    filteredSessions,
    viewState.studyId,
    viewState.search,
    viewState.status,
    viewState.sessionType,
    viewState.sortBy,
    viewState.sortDir,
  ]);

  // Flat sorted sessions (for when groupByStudy is toggled OFF)
  const flatSessions = useMemo(() => {
    return [...filteredSessions].sort((a, b) =>
      compareSessions(a, b, viewState.sortBy as SortMode, viewState.sortDir),
    );
  }, [filteredSessions, viewState.sortBy, viewState.sortDir]);

  const toggleGroupCollapse = (groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const openNewSession = (studyId?: string) => {
    setSessionToEdit(null);
    setDrawerPreselectedStudyId(studyId || null);
    setIsSessionDrawerOpen(true);
  };

  const openEditSession = (session: DashboardEvent) => {
    setSessionToEdit(session);
    setDrawerPreselectedStudyId(session.studyId || null);
    setIsSessionDrawerOpen(true);
  };

  const handleSessionSaved = () => {
    void queryClient.invalidateQueries({ queryKey: ["sessions"] });
    void queryClient.invalidateQueries({ queryKey: ["studies"] });
  };

  const handleStudySaved = () => {
    void queryClient.invalidateQueries({ queryKey: ["studies"] });
  };

  return (
    <PageLayout>
      {/* Shared Page Header */}
      <PageHeader
        title="Sessions"
        subtitle="Liturgical Department Schedule & Attendance"
      >
        <NewSplitButton
          primaryLabel="New Session"
          onNewSession={() => openNewSession()}
          onNewStudy={() => setIsStudyDrawerOpen(true)}
          isSuperAdmin={isSuperAdmin}
        />
      </PageHeader>

      {/* Shared Filter Bar */}
      <FilterBar
        searchQuery={viewState.search}
        onSearchChange={(q) => setField("search", q)}
        searchPlaceholder="Search sessions by title, description, or location..."
        rightActions={
          <div className="flex items-center gap-2">
            {/* Group by study toggle */}
            <button
              type="button"
              onClick={() => setField("groupByStudy", !viewState.groupByStudy)}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition shadow-sm ${
                viewState.groupByStudy
                  ? "border-blue-600 bg-blue-50 text-blue-700"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
              title="Toggle Grouping by Study"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Group by study</span>
            </button>

            {/* Shared Sort Dropdown */}
            <SortDropdown
              value={viewState.sortBy}
              direction={viewState.sortDir}
              options={SORT_OPTIONS}
              onChange={(val) => setField("sortBy", val)}
              onDirectionToggle={() =>
                setField("sortDir", viewState.sortDir === "asc" ? "desc" : "asc")
              }
            />
          </div>
        }
      >
        {/* Status Filter Dropdown */}
        <select
          value={viewState.status}
          onChange={(e) => setField("status", e.target.value)}
          className="rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs font-semibold text-slate-700 focus:outline-none focus:border-blue-500"
        >
          {STATUS_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>

        {/* Study Filter Dropdown */}
        <select
          value={viewState.studyId}
          onChange={(e) => setField("studyId", e.target.value)}
          className="rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs font-semibold text-slate-700 focus:outline-none focus:border-blue-500 max-w-[160px] truncate"
        >
          <option value="ALL">All Studies & Standalone</option>
          <option value="STANDALONE">Standalone Only</option>
          {studies.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </FilterBar>

      {/* Sessions Content */}
      {isLoadingEvents ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-28 rounded-2xl border border-slate-200 bg-white p-5 animate-pulse"
            />
          ))}
        </div>
      ) : viewState.groupByStudy ? (
        /* Grouped View (Studies + Standalone) */
        <div className="space-y-6">
          {studyGroups.length === 0 ? (
            <EmptyState
              icon={Calendar}
              title="No matching sessions found"
              description="Try adjusting your filters, search term, or schedule a new session."
              actionLabel="New Session"
              onAction={() => openNewSession()}
            />
          ) : (
            studyGroups.map((group) => {
              const isCollapsed = collapsedGroups.has(group.id);
              const isEmptyStudy = group.sessions.length === 0;

              return (
                <div
                  key={group.id}
                  className="rounded-3xl border border-slate-200/80 bg-white shadow-sm overflow-hidden transition"
                >
                  {/* Group Header */}
                  <div
                    onClick={() => toggleGroupCollapse(group.id)}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 bg-slate-50/60 border-b border-slate-200/70 cursor-pointer hover:bg-slate-100/60 transition"
                  >
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        className="rounded-lg p-1 text-slate-400 hover:text-slate-700"
                      >
                        {isCollapsed ? (
                          <ChevronRight className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </button>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h2 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
                            {group.name}
                          </h2>
                          <span className="rounded-full bg-slate-200/80 px-2.5 py-0.5 text-[11px] font-bold text-slate-700">
                            {group.sessions.length} {group.sessions.length === 1 ? "session" : "sessions"}
                          </span>
                        </div>
                        {group.startDate && (
                          <p className="text-[11px] font-semibold text-slate-500 mt-0.5">
                            Active Period: {formatDate(group.startDate)} —{" "}
                            {group.endDate ? formatDate(group.endDate) : "Ongoing"}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Group Header Actions */}
                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      {group.id !== "STANDALONE" && (
                        <button
                          type="button"
                          onClick={() => openNewSession(group.id)}
                          className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition shadow-sm"
                        >
                          <Plus className="w-3.5 h-3.5 text-blue-600" />
                          <span>Add Session</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Group Sessions Body */}
                  {!isCollapsed && (
                    <div className="p-4 sm:p-5">
                      {isEmptyStudy ? (
                        /* Empty study state (Item 5) */
                        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/40 p-6 text-center">
                          <p className="text-xs font-bold text-slate-600">
                            No sessions scheduled yet for this study.
                          </p>
                          <button
                            type="button"
                            onClick={() => openNewSession(group.id)}
                            className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-blue-700 transition"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Add Session</span>
                          </button>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {group.sessions.map((session) => (
                            <SessionCard
                              key={session.id}
                              session={session}
                              onEdit={() => openEditSession(session)}
                              onClick={() => navigate(`/sessions/${session.id}`)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      ) : (
        /* Flat List View (Item 7) */
        <div className="space-y-4">
          {flatSessions.length === 0 ? (
            <EmptyState
              icon={Calendar}
              title="No matching sessions found"
              description="Try adjusting your filters, search term, or schedule a new session."
              actionLabel="New Session"
              onAction={() => openNewSession()}
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {flatSessions.map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  onEdit={() => openEditSession(session)}
                  onClick={() => navigate(`/sessions/${session.id}`)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Shared Drawers */}
      <SessionFormDrawer
        isOpen={isSessionDrawerOpen}
        onClose={() => setIsSessionDrawerOpen(false)}
        sessionToEdit={sessionToEdit}
        preselectedStudyId={drawerPreselectedStudyId}
        onSuccess={handleSessionSaved}
      />

      <StudyFormDrawer
        isOpen={isStudyDrawerOpen}
        onClose={() => setIsStudyDrawerOpen(false)}
        onSuccess={handleStudySaved}
      />
    </PageLayout>
  );
};

interface SessionCardProps {
  session: DashboardEvent;
  onEdit: () => void;
  onClick: () => void;
}

const SessionCard: React.FC<SessionCardProps> = ({ session, onEdit, onClick }) => {
  const formatTime = (iso: string) => {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div
      onClick={onClick}
      className="group relative flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm transition hover:shadow-md hover:border-slate-300 cursor-pointer"
    >
      <div>
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-bold text-slate-900 group-hover:text-blue-600 transition leading-snug truncate">
              {session.title}
            </h3>
            {session.study && (
              <span className="text-[11px] font-semibold text-blue-600">
                {session.study.name}
              </span>
            )}
          </div>
          <StatusChip status={session.status} size="sm" />
        </div>

        {session.description && (
          <p className="text-xs text-slate-500 line-clamp-2 mb-3">
            {session.description}
          </p>
        )}

        <div className="space-y-1.5 text-xs text-slate-600 bg-slate-50/70 p-3 rounded-xl border border-slate-100 mb-3">
          <div className="flex items-center gap-2">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <span>{formatDate(session.startTime)}</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <span>
              {formatTime(session.startTime)} – {formatTime(session.endTime)}
            </span>
          </div>
          {session.location && (
            <div className="flex items-center gap-2 truncate">
              <MapPin className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
              <span className="truncate">{session.location}</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
        <span className="inline-flex items-center gap-1 font-semibold text-slate-600">
          <Users className="w-3.5 h-3.5 text-slate-400" />
          <span>{session.attendanceCount} attended</span>
        </span>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className="rounded-lg px-2.5 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-100 transition"
        >
          ✏️ Edit
        </button>
      </div>
    </div>
  );
};

export default EventsPage;
