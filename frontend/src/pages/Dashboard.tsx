import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { Link } from "react-router-dom";
import formatDate from "../lib/formatDate";

import PageLayout from "../components/layout/PageLayout";
import PageHeader from "../components/layout/PageHeader";
import CopyPhoneButton from "../components/shared/CopyPhoneButton";
import CopyAllPhonesDropdown from "../components/shared/CopyAllPhonesDropdown";

export default function DashboardPage() {
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // TanStack Query for instant cached data and seamless revalidation (Item 3)
  const {
    data,
    isLoading,
    isError,
    error: fetchError,
    refetch,
  } = useQuery({
    queryKey: ["dashboard-analytics"],
    queryFn: () => dashboardApi.getAnalytics(),
    staleTime: 60 * 1000,
  });

  const latestSession = data?.latestCompletedSession;
  const needsAttention = data?.needsAttention ?? [];
  const membersAtRisk = data?.membersAtRisk ?? [];
  const topAttendeesPerStudy = data?.topAttendeesPerStudy ?? [];

  return (
    <PageLayout>
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl bg-slate-900 text-white px-4 py-2.5 text-xs font-bold shadow-2xl transition animate-in fade-in slide-in-from-bottom-2">
          {toastMessage}
        </div>
      )}

      {/* Persistent Page Header (Item 2) */}
      <PageHeader
        title="Department Dashboard"
        subtitle="Hymn Department · Real-time attendance health, risk alerts, and tracking"
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refetch()}
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition shadow-2xs"
          >
            Refresh
          </button>
        </div>
      </PageHeader>

      {isError && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600" />
            <span>{(fetchError as Error)?.message || "Failed to load dashboard data."}</span>
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

      {isLoading && !data ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-28 animate-pulse rounded-3xl border border-slate-200/80 bg-white" />
            ))}
          </div>
          <div className="h-48 animate-pulse rounded-3xl border border-slate-200/80 bg-white" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* KPI Summary Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Total Members */}
            <div className="bg-white p-5 rounded-3xl shadow-2xs border border-slate-200/80">
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
            <div className="bg-white p-5 rounded-3xl shadow-2xs border border-slate-200/80">
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

            {/* Upcoming Sessions */}
            <div className="bg-white p-5 rounded-3xl shadow-2xs border border-slate-200/80">
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
            <div className="bg-white p-5 rounded-3xl shadow-2xs border border-slate-200/80">
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
          {latestSession && (latestSession.event || latestSession.title) ? (
            <div className="rounded-3xl border border-blue-200 bg-gradient-to-br from-blue-50/70 via-white to-indigo-50/50 p-6 shadow-2xs">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-4">
                <div>
                  <span className="inline-block rounded-lg bg-blue-600 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white">
                    Latest Completed Session
                  </span>
                  <h2 className="text-xl font-black text-slate-900 mt-2">
                    {latestSession.event?.title || latestSession.title}
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {(latestSession.event?.studyName || latestSession.studyName)
                      ? `${latestSession.event?.studyName || latestSession.studyName} • `
                      : ""}
                    {formatDate(latestSession.event?.startTime || latestSession.startTime)}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <Link
                    to={`/sessions/${latestSession.event?.id || latestSession.id}`}
                    className="rounded-xl border border-blue-200 bg-white px-4 py-2 text-xs font-bold text-blue-700 shadow-2xs hover:bg-blue-50 transition"
                  >
                    View Session & Absentees →
                  </Link>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-6 pt-3 border-t border-slate-200/60">
                <div className="p-3 bg-white rounded-2xl border border-slate-100">
                  <span className="text-[10px] uppercase font-bold text-slate-400">Turnout Rate</span>
                  <p className="text-xl font-black text-blue-700 mt-0.5">
                    {(latestSession.stats?.turnoutAmongParticipants ?? latestSession.turnoutAmongParticipants ?? latestSession.stats?.attendanceRate ?? latestSession.attendanceRate) !== null &&
                    (latestSession.stats?.turnoutAmongParticipants ?? latestSession.turnoutAmongParticipants ?? latestSession.stats?.attendanceRate ?? latestSession.attendanceRate) !== undefined
                      ? `${Math.round((latestSession.stats?.turnoutAmongParticipants ?? latestSession.turnoutAmongParticipants ?? latestSession.stats?.attendanceRate ?? latestSession.attendanceRate) * 100)}%`
                      : "—"}
                  </p>
                  {(latestSession.stats?.eligibleAttendanceRate ?? latestSession.eligibleAttendanceRate) !== null &&
                    (latestSession.stats?.eligibleAttendanceRate ?? latestSession.eligibleAttendanceRate) !== undefined && (
                      <p className="text-[10px] text-slate-400 font-medium">
                        {Math.round((latestSession.stats?.eligibleAttendanceRate ?? latestSession.eligibleAttendanceRate) * 100)}% of eligible
                      </p>
                    )}
                </div>
                <div className="p-3 bg-white rounded-2xl border border-slate-100">
                  <span className="text-[10px] uppercase font-bold text-slate-400">Participants</span>
                  <p className="text-xl font-black text-indigo-700 mt-0.5">
                    {latestSession.stats?.participants ?? latestSession.participantsCount ?? "—"}
                  </p>
                  <p className="text-[10px] text-slate-400 font-medium">
                    Study cohort
                  </p>
                </div>
                <div className="p-3 bg-white rounded-2xl border border-slate-100">
                  <span className="text-[10px] uppercase font-bold text-slate-400">Eligible</span>
                  <p className="text-xl font-black text-slate-800 mt-0.5">
                    {latestSession.stats?.eligible ?? latestSession.eligibleCount ?? 0}
                  </p>
                  <p className="text-[10px] text-slate-400 font-medium">
                    Audience rule
                  </p>
                </div>
                <div className="p-3 bg-white rounded-2xl border border-slate-100">
                  <span className="text-[10px] uppercase font-bold text-slate-400">Present</span>
                  <p className="text-xl font-black text-emerald-700 mt-0.5">
                    {latestSession.stats?.present ?? (latestSession.turnout ?? 0)}
                  </p>
                </div>
                <div className="p-3 bg-white rounded-2xl border border-slate-100">
                  <span className="text-[10px] uppercase font-bold text-slate-400">Late</span>
                  <p className="text-xl font-black text-amber-700 mt-0.5">
                    {latestSession.stats?.late ?? 0}
                  </p>
                </div>
                <div className="p-3 bg-white rounded-2xl border border-slate-100">
                  <span className="text-[10px] uppercase font-bold text-slate-400">Absentees</span>
                  <p className="text-xl font-black text-red-600 mt-0.5">
                    {latestSession.stats?.absentAmongParticipants ?? latestSession.absenteeCount ?? latestSession.stats?.absent ?? 0}
                  </p>
                  <p className="text-[10px] text-slate-400 font-medium">
                    Among cohort
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {/* NEEDS ATTENTION & MEMBERS AT RISK (2-COLUMN GRID) */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* NEEDS ATTENTION: Sessions below study average */}
            <div className="rounded-3xl border border-amber-200/80 bg-white p-6 shadow-2xs">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2 text-amber-800">
                  <AlertTriangle size={20} className="text-amber-600" />
                  <h2 className="text-base font-bold">Needs Attention (Sessions)</h2>
                </div>
                <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-800 border border-amber-200">
                  Turnout Drop &gt; 20%
                </span>
              </div>
              <p className="text-xs text-slate-500 mb-4">
                Sessions whose turnout among participants dropped &gt;20 percentage points below that study's average.
              </p>

              <div className="space-y-3">
                {needsAttention.length === 0 ? (
                  <div className="rounded-2xl bg-slate-50 p-6 text-center text-xs italic text-slate-400">
                    No sessions currently below study average turnout. Great attendance!
                  </div>
                ) : (
                  needsAttention.map((session: any) => {
                    const sessionTurnout =
                      session.turnoutAmongParticipants ?? session.turnout ?? session.rate ?? 0;
                    const studyAvg =
                      session.studyAverageTurnout ?? session.studyAverage ?? 0;
                    return (
                      <div
                        key={session.eventId || session.id}
                        className="rounded-2xl border border-amber-100 bg-amber-50/30 p-3.5 flex items-center justify-between"
                      >
                        <div>
                          <p className="text-xs font-bold text-slate-900">{session.title}</p>
                          <p className="text-[11px] text-slate-500">
                            {session.studyName} • {formatDate(session.startTime || session.eventDate)}
                          </p>
                          <div className="mt-1 flex items-center gap-2 text-[11px] flex-wrap">
                            <span className="font-bold text-red-600">
                              Cohort Turnout: {Math.round(sessionTurnout * 100)}%
                            </span>
                            {session.eligibleAttendanceRate !== undefined && session.eligibleAttendanceRate !== null && (
                              <span className="text-slate-400 text-[10px]">
                                ({Math.round(session.eligibleAttendanceRate * 100)}% eligible)
                              </span>
                            )}
                            <span className="text-slate-400">•</span>
                            <span className="text-slate-600">
                              Study Avg: {Math.round(studyAvg * 100)}%
                            </span>
                          </div>
                        </div>

                        <Link
                          to={`/sessions/${session.eventId || session.id}`}
                          className="text-xs font-bold text-amber-700 hover:text-amber-900 underline ml-2 shrink-0"
                        >
                          View
                        </Link>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* MEMBERS AT RISK: Trailing misses >= 2 in ongoing studies */}
            <div className="rounded-3xl border border-red-200/80 bg-white p-6 shadow-2xs">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2 text-red-800">
                  <AlertCircle size={20} className="text-red-600" />
                  <h2 className="text-base font-bold">Needs Attention (Members)</h2>
                </div>
                {/* Batch Phone Copy for At-Risk Members (Item 11) */}
                {membersAtRisk.length > 0 && (
                  <CopyAllPhonesDropdown
                    members={membersAtRisk.map((m: any) => ({
                      id: m.memberId || m.id,
                      name: m.memberName || m.name,
                      phoneNumber: m.phoneNumber,
                    }))}
                    onToast={(msg) => showToast(msg)}
                    label="Copy All Phones"
                  />
                )}
              </div>
              <p className="text-xs text-slate-500 mb-4">
                Participants who missed 2+ trailing held sessions of an ongoing study after their last attended session.
              </p>

              <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                {membersAtRisk.length === 0 ? (
                  <div className="rounded-2xl bg-slate-50 p-6 text-center text-xs italic text-slate-400">
                    No study participants currently have 2+ trailing misses.
                  </div>
                ) : (
                  membersAtRisk.map((member: any) => {
                    const misses = member.trailingMisses ?? member.missedSessions ?? 2;
                    const isCritical = member.alertLevel === "CRITICAL" || misses >= 3;
                    return (
                      <div
                        key={`${member.memberId || member.id}-${member.studyId}`}
                        className="rounded-2xl border border-red-100 bg-red-50/30 p-3.5 flex items-center justify-between"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-xs font-bold text-slate-900">
                              {member.memberName || member.name}
                            </p>
                            {isCritical ? (
                              <span className="rounded-md bg-red-600 px-1.5 py-0.5 text-[9px] font-black uppercase text-white tracking-wide">
                                Critical (Missed {misses})
                              </span>
                            ) : (
                              <span className="rounded-md bg-amber-500 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white tracking-wide">
                                Warning (Missed {misses})
                              </span>
                            )}
                            {member.attendingOtherStudy && (
                              <span
                                className="rounded-md bg-blue-100 border border-blue-300 px-1.5 py-0.5 text-[9px] font-bold text-blue-700"
                                title="Attended another ongoing study in the last 3 weeks; can be deprioritized"
                              >
                                Attending Other Study
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-slate-500 flex-wrap">
                            {member.uniqueId && <span>{member.uniqueId}</span>}
                            <span>•</span>
                            <span>{member.campus}</span>
                            <span>•</span>
                            <span>{member.batch}</span>
                            {member.phoneNumber && (
                              <div className="flex items-center gap-1">
                                <span>• 📞 {member.phoneNumber}</span>
                                <CopyPhoneButton
                                  phoneNumber={member.phoneNumber}
                                  onCopied={() => showToast(`Copied ${member.memberName || member.name}'s phone`)}
                                />
                              </div>
                            )}
                          </div>
                          <p className="text-[11px] font-medium text-red-700">
                            Missed {misses} trailing held sessions of "{member.studyName}"
                            {member.lastAttendedSessionTitle
                              ? ` (last attended: ${member.lastAttendedSessionTitle})`
                              : ""}
                          </p>
                        </div>

                        <Link
                          to={`/members/${member.memberId || member.id}`}
                          className="text-xs font-bold text-red-700 hover:text-red-900 underline ml-2 shrink-0"
                        >
                          Profile
                        </Link>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* TOP ATTENDEES PER STUDY */}
          {topAttendeesPerStudy.length > 0 && (
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-2xs">
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
                        Matrix →
                      </Link>
                    </div>

                    <div className="space-y-2">
                      {studyGroup.topAttendees.map((m: any, idx: number) => (
                        <div key={m.memberId || m.id} className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-slate-700">
                            <span className="text-slate-400 font-bold mr-1.5">#{idx + 1}</span>
                            {m.memberName || m.name}
                          </span>
                          <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 border border-emerald-200">
                            {m.attendedCount} sessions
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </PageLayout>
  );
}
