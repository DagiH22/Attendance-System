import { useEffect, useState } from "react";
import { dashboardApi } from "../lib/dashboard.api";
import {
  AlertCircle,
  Calendar,
  Users,
  TrendingUp,
  BookOpen,
  ArrowRight,
  AlertTriangle,
  Award,
} from "lucide-react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { toFriendlyError } from "../lib/errors";
import formatDate from "../lib/formatDate";

const DASHBOARD_CACHE_KEY = "dashboard:analytics:v1";

export default function DashboardPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const navigate = useNavigate();
  const location = useLocation();
  const { logout } = useAuth();

  useEffect(() => {
    let cancelled = false;

    const loadDashboard = async () => {
      try {
        const cachedRaw = sessionStorage.getItem(DASHBOARD_CACHE_KEY);
        if (cachedRaw) {
          const cached = JSON.parse(cachedRaw);
          if (cached?.data) {
            setData(cached.data);
            setLoading(false);
            setRefreshing(true);
          }
        }
      } catch {
        // Ignore cache parse/storage errors.
      }

      try {
        const res = await dashboardApi.getAnalytics();
        if (cancelled) return;

        setData(res);
        setError("");

        try {
          sessionStorage.setItem(
            DASHBOARD_CACHE_KEY,
            JSON.stringify({ data: res, cachedAt: Date.now() }),
          );
        } catch {
          // Ignore cache write errors.
        }
      } catch (err) {
        if (cancelled) return;

        const friendly = toFriendlyError(err, {
          action: "load the dashboard",
          fallbackTitle: "Couldn't load dashboard",
          fallbackMessage: "Please try again.",
        });
        setError(friendly.message);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };

    void loadDashboard();

    return () => {
      cancelled = true;
    };
  }, []);

  const latestSession = data?.latestCompletedSession;
  const needsAttention = data?.needsAttention ?? [];
  const membersAtRisk = data?.membersAtRisk ?? [];
  const topAttendeesPerStudy = data?.topAttendeesPerStudy ?? [];

  return (
    <div className="min-h-screen bg-slate-50 pb-24 relative">
      {/* Top Header */}
      <header className="bg-white border-b border-slate-200 fixed top-0 w-full z-30">
        <div className="px-4 pt-6 max-w-5xl mx-auto w-full">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">Department Dashboard</h1>
              <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">
                Church Hymn & Study Analytics
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={async () => {
                  await logout();
                  navigate("/login", { replace: true });
                }}
                className="text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 px-3 py-2 rounded-xl border border-red-200 transition"
              >
                Logout
              </button>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex space-x-4 border-b border-slate-100 pb-1">
            <button
              onClick={() => navigate("/events")}
              className={`pb-2 px-1 text-sm font-medium border-b-2 transition-colors ${
                location.pathname === "/events"
                  ? "border-blue-600 text-blue-600 font-semibold"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              Events
            </button>
            <button
              onClick={() => navigate("/studies")}
              className={`pb-2 px-1 text-sm font-medium border-b-2 transition-colors ${
                location.pathname === "/studies"
                  ? "border-blue-600 text-blue-600 font-semibold"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              Studies
            </button>
            <button
              onClick={() => navigate("/members")}
              className={`pb-2 px-1 text-sm font-medium border-b-2 transition-colors ${
                location.pathname === "/members"
                  ? "border-blue-600 text-blue-600 font-semibold"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              Members
            </button>
            <button
              onClick={() => navigate("/dashboard")}
              className={`pb-2 px-1 text-sm font-semibold border-b-2 transition-colors ${
                location.pathname === "/dashboard"
                  ? "border-blue-600 text-blue-600 font-bold"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              Dashboard
            </button>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-5xl mx-auto w-full px-4 pt-36 sm:pt-40 pb-6 space-y-6">
        {refreshing && !loading && (
          <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700">
            Updating dashboard data…
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading && !data ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-28 animate-pulse rounded-2xl border bg-white" />
              ))}
            </div>
            <div className="h-48 animate-pulse rounded-2xl border bg-white" />
          </div>
        ) : (
          <>
            {/* KPI Summary Cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {/* Total Members */}
              <div className="bg-white p-5 rounded-3xl shadow-sm border border-slate-200/80">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">
                    Total Members
                  </span>
                  <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
                    <Users size={18} />
                  </div>
                </div>
                <div className="text-3xl font-black text-slate-900">
                  {data?.summary?.totalMembers ?? 0}
                </div>
                <div className="text-xs font-bold text-emerald-600 mt-2">
                  {data?.summary?.activeMembers ?? 0} active members
                </div>
              </div>

              {/* Active Studies */}
              <div className="bg-white p-5 rounded-3xl shadow-sm border border-slate-200/80">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">
                    Active Studies
                  </span>
                  <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                    <BookOpen size={18} />
                  </div>
                </div>
                <div className="text-3xl font-black text-slate-900">
                  {data?.summary?.activeStudiesCount ?? data?.summary?.totalStudies ?? 0}
                </div>
                <Link
                  to="/studies"
                  className="text-xs font-bold text-indigo-600 hover:text-indigo-800 mt-2 inline-flex items-center gap-1"
                >
                  View studies matrix <ArrowRight size={12} />
                </Link>
              </div>

              {/* Active Sessions */}
              <div className="bg-white p-5 rounded-3xl shadow-sm border border-slate-200/80">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">
                    Upcoming Sessions
                  </span>
                  <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl">
                    <Calendar size={18} />
                  </div>
                </div>
                <div className="text-3xl font-black text-slate-900">
                  {data?.summary?.activeEventsCount ?? 0}
                </div>
                <div className="text-xs text-slate-500 mt-2">
                  out of {data?.summary?.totalEvents ?? 0} total sessions
                </div>
              </div>

              {/* Overall Attendance Rate */}
              <div className="bg-white p-5 rounded-3xl shadow-sm border border-slate-200/80">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">
                    Avg Turnout
                  </span>
                  <div className="p-2 bg-purple-50 text-purple-600 rounded-xl">
                    <TrendingUp size={18} />
                  </div>
                </div>
                <div className="text-3xl font-black text-slate-900">
                  {data?.summary?.attendanceRate !== null && data?.summary?.attendanceRate !== undefined
                    ? `${Math.round(data.summary.attendanceRate * 100)}%`
                    : "—"}
                </div>
                <div className="text-xs text-slate-500 mt-2">
                  Excluding cancelled sessions
                </div>
              </div>
            </div>

            {/* LATEST COMPLETED SESSION HERO */}
            {latestSession && latestSession.event ? (
              <div className="rounded-3xl border border-blue-200 bg-gradient-to-br from-blue-50/70 via-white to-indigo-50/50 p-6 shadow-sm">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-4">
                  <div>
                    <span className="inline-block rounded-lg bg-blue-600 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white">
                      Latest Completed Session
                    </span>
                    <h2 className="text-xl font-black text-slate-900 mt-2">
                      {latestSession.event.title}
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {latestSession.event.studyName ? `${latestSession.event.studyName} • ` : ""}
                      {formatDate(latestSession.event.startTime)}
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <Link
                      to={`/events/${latestSession.event.id}`}
                      className="rounded-xl border border-blue-200 bg-white px-4 py-2 text-xs font-bold text-blue-700 shadow-xs hover:bg-blue-50 transition"
                    >
                      View Session & Absentees →
                    </Link>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 pt-3 border-t border-slate-200/60">
                  <div className="p-3 bg-white rounded-2xl border border-slate-100">
                    <span className="text-[10px] uppercase font-bold text-slate-400">Turnout Rate</span>
                    <p className="text-xl font-black text-blue-700 mt-0.5">
                      {latestSession.stats.attendanceRate !== null
                        ? `${Math.round(latestSession.stats.attendanceRate * 100)}%`
                        : "—"}
                    </p>
                  </div>
                  <div className="p-3 bg-white rounded-2xl border border-slate-100">
                    <span className="text-[10px] uppercase font-bold text-slate-400">Eligible</span>
                    <p className="text-xl font-black text-slate-800 mt-0.5">
                      {latestSession.stats.eligible}
                    </p>
                  </div>
                  <div className="p-3 bg-white rounded-2xl border border-slate-100">
                    <span className="text-[10px] uppercase font-bold text-slate-400">Present</span>
                    <p className="text-xl font-black text-emerald-700 mt-0.5">
                      {latestSession.stats.present}
                    </p>
                  </div>
                  <div className="p-3 bg-white rounded-2xl border border-slate-100">
                    <span className="text-[10px] uppercase font-bold text-slate-400">Late</span>
                    <p className="text-xl font-black text-amber-700 mt-0.5">
                      {latestSession.stats.late}
                    </p>
                  </div>
                  <div className="p-3 bg-white rounded-2xl border border-slate-100">
                    <span className="text-[10px] uppercase font-bold text-slate-400">Absentees</span>
                    <p className="text-xl font-black text-red-600 mt-0.5">
                      {latestSession.stats.absent}
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            {/* NEEDS ATTENTION & MEMBERS AT RISK (2-COLUMN GRID) */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* NEEDS ATTENTION: Sessions below study average */}
              <div className="rounded-3xl border border-amber-200/80 bg-white p-6 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2 text-amber-800">
                    <AlertTriangle size={20} className="text-amber-600" />
                    <h2 className="text-base font-bold">Needs Attention</h2>
                  </div>
                  <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-800 border border-amber-200">
                    Turnout Drop
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-4">
                  Sessions whose turnout fell significantly below that study's average turnout.
                </p>

                <div className="space-y-3">
                  {needsAttention.length === 0 ? (
                    <div className="rounded-2xl bg-slate-50 p-6 text-center text-xs italic text-slate-400">
                      No sessions currently below study average turnout. Great attendance!
                    </div>
                  ) : (
                    needsAttention.map((session: any) => (
                      <div
                        key={session.eventId}
                        className="rounded-2xl border border-amber-100 bg-amber-50/30 p-3.5 flex items-center justify-between"
                      >
                        <div>
                          <p className="text-xs font-bold text-slate-900">{session.title}</p>
                          <p className="text-[11px] text-slate-500">
                            {session.studyName} • {formatDate(session.startTime)}
                          </p>
                          <div className="mt-1 flex items-center gap-2 text-[11px]">
                            <span className="font-bold text-red-600">
                              Turnout: {Math.round(session.turnout * 100)}%
                            </span>
                            <span className="text-slate-400">•</span>
                            <span className="text-slate-600">
                              Study Avg: {Math.round(session.studyAverageTurnout * 100)}%
                            </span>
                          </div>
                        </div>

                        <Link
                          to={`/events/${session.eventId}`}
                          className="text-xs font-bold text-amber-700 hover:text-amber-900 underline"
                        >
                          View
                        </Link>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* MEMBERS AT RISK: Missed last 2 sessions of a study */}
              <div className="rounded-3xl border border-red-200/80 bg-white p-6 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2 text-red-800">
                    <AlertCircle size={20} className="text-red-600" />
                    <h2 className="text-base font-bold">Members at Risk</h2>
                  </div>
                  <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-[11px] font-bold text-red-800 border border-red-200">
                    Study Disengagement
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-4">
                  Members who missed the last 2 sessions of an active study.
                </p>

                <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                  {membersAtRisk.length === 0 ? (
                    <div className="rounded-2xl bg-slate-50 p-6 text-center text-xs italic text-slate-400">
                      No members have missed 2 consecutive sessions of any study.
                    </div>
                  ) : (
                    membersAtRisk.map((member: any) => (
                      <div
                        key={`${member.memberId}-${member.studyId}`}
                        className="rounded-2xl border border-red-100 bg-red-50/30 p-3.5 flex items-center justify-between"
                      >
                        <div>
                          <p className="text-xs font-bold text-slate-900">{member.memberName}</p>
                          <p className="text-[11px] text-slate-500">
                            {member.uniqueId} • {member.campus} • {member.batch}
                          </p>
                          <span className="mt-1 inline-block text-[11px] font-bold text-red-600">
                            Missed last 2 sessions of "{member.studyName}"
                          </span>
                        </div>

                        <Link
                          to={`/members/${member.memberId}`}
                          className="text-xs font-bold text-red-700 hover:text-red-900 underline"
                        >
                          Profile
                        </Link>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* TOP ATTENDEES PER STUDY */}
            {topAttendeesPerStudy.length > 0 && (
              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                  <Award size={20} className="text-indigo-600" />
                  <h2 className="text-lg font-bold text-slate-900">Top Attendees per Study</h2>
                </div>

                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  {topAttendeesPerStudy.map((studyGroup: any) => (
                    <div key={studyGroup.studyId} className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
                      <div className="flex items-center justify-between mb-3 border-b border-slate-200/60 pb-2">
                        <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                          {studyGroup.studyName}
                        </h3>
                        <Link
                          to={`/studies`}
                          className="text-[11px] font-bold text-blue-600 hover:underline"
                        >
                          Grid →
                        </Link>
                      </div>

                      <div className="space-y-2">
                        {studyGroup.topMembers.length === 0 ? (
                          <p className="text-xs italic text-slate-400">No attendance data yet.</p>
                        ) : (
                          studyGroup.topMembers.map((m: any, idx: number) => (
                            <div
                              key={m.id}
                              onClick={() => navigate(`/members/${m.id}`)}
                              className="flex items-center justify-between rounded-xl bg-white p-2.5 shadow-2xs border border-slate-100 hover:border-slate-300 transition cursor-pointer"
                            >
                              <div className="flex items-center gap-2.5">
                                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-50 text-[10px] font-bold text-indigo-700">
                                  #{idx + 1}
                                </span>
                                <div>
                                  <p className="text-xs font-bold text-slate-900">{m.name}</p>
                                  <p className="text-[10px] text-slate-500">
                                    {m.campus} • {m.effectiveBatch}
                                  </p>
                                </div>
                              </div>
                              <span className="text-xs font-bold text-indigo-700">
                                {m.attendedCount} sessions
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
