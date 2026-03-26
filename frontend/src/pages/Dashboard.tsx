import { useEffect, useState } from "react";
import { dashboardApi } from "../lib/dashboard.api";
import { AlertCircle, Calendar, Users, TrendingUp } from "lucide-react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { toFriendlyError } from "../lib/errors";

export default function DashboardPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const navigate = useNavigate();
  const location = useLocation();
  const { logout } = useAuth();

  useEffect(() => {
    dashboardApi
      .getAnalytics()
      .then((res) => setData(res))
      .catch((err) => {
        const friendly = toFriendlyError(err, {
          action: "load the dashboard",
          fallbackTitle: "Couldn't load dashboard",
          fallbackMessage: "Please try again.",
        });
        setError(friendly.message);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading)
    return (
      <div className="p-8">
        <div className="animate-pulse flex space-x-4">Loading dashboard...</div>
      </div>
    );
  if (error)
    return (
      <div className="p-8 text-red-500">Error loading dashboard: {error}</div>
    );

  return (
    <div className="min-h-screen bg-gray-50 pb-24 relative">
      {/* Header aligned with Events/Members pages */}
      <header className="bg-white border-b border-gray-200 fixed top-0 w-full z-30">
        <div className="px-4 pt-6 max-w-4xl mx-auto w-full">
          <div className="flex justify-between items-center mb-4">
            <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
            <div className="flex items-center gap-2">
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
      <div className="max-w-4xl mx-auto w-full px-4 pt-32 sm:pt-40 pb-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Summary Cards */}
          <div className="bg-white p-6 rounded-lg shadow-sm border">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-gray-500 text-sm font-medium">
                Total Members
              </h3>
              <Users className="text-blue-500" size={20} />
            </div>
            <div className="text-3xl font-bold">
              {data?.summary.totalMembers}
            </div>
            <div className="text-sm text-green-500 mt-2">
              {data?.summary.activeMembers} active
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow-sm border">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-gray-500 text-sm font-medium">
                Active Events
              </h3>
              <Calendar className="text-green-500" size={20} />
            </div>
            <div className="text-3xl font-bold">
              {data?.summary.activeEventsCount}
            </div>
            <div className="text-sm text-gray-500 mt-2">
              out of {data?.summary.totalEvents} total
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow-sm border">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-gray-500 text-sm font-medium">
                Avg Attendance
              </h3>
              <TrendingUp className="text-purple-500" size={20} />
            </div>
            <div className="text-3xl font-bold">
              {(data?.summary.attendanceRate * 100).toFixed(1)}%
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
          {/* Alerts Panel */}
          <div className="bg-white p-6 rounded-lg shadow-sm border border-red-100">
            <div className="flex items-center gap-2 mb-4 text-red-600">
              <AlertCircle size={24} />
              <h2 className="text-xl font-semibold">Critical Alerts</h2>
            </div>
            <div className="space-y-4">
              {data?.alerts.absentAlerts
                .filter((a: any) => a.status === "Critical")
                .map((alert: any) => (
                  <div
                    key={alert.id}
                    className="p-3 bg-red-50 rounded-md border border-red-200 flex justify-between"
                  >
                    <div>
                      <div className="font-medium">{alert.name}</div>
                      <div className="text-sm text-red-600">
                        Missed {alert.consecutiveAbsences} consecutive events
                      </div>
                    </div>
                    <Link
                      to={`/members/${alert.id}`}
                      className="text-sm font-medium text-red-700 hover:underline"
                    >
                      View Profile
                    </Link>
                  </div>
                ))}
              {data?.alerts.absentAlerts.filter(
                (a: any) => a.status === "Critical",
              ).length === 0 && (
                <div className="text-gray-500 text-sm">No critical alerts.</div>
              )}
            </div>
          </div>

          {/* Warnings Panel */}
          <div className="bg-white p-6 rounded-lg shadow-sm border border-yellow-100">
            <div className="flex items-center gap-2 mb-4 text-yellow-600">
              <AlertCircle size={24} />
              <h2 className="text-xl font-semibold">Warnings</h2>
            </div>
            <div className="space-y-4">
              {data?.alerts.absentAlerts
                .filter((a: any) => a.status === "Warning")
                .map((alert: any) => (
                  <div
                    key={alert.id}
                    className="p-3 bg-yellow-50 rounded-md border border-yellow-200 flex justify-between"
                  >
                    <div>
                      <div className="font-medium">{alert.name}</div>
                      <div className="text-sm text-yellow-700">
                        Missed {alert.consecutiveAbsences} events
                      </div>
                    </div>
                    <Link
                      to={`/members/${alert.id}`}
                      className="text-sm font-medium text-yellow-800 hover:underline"
                    >
                      View Profile
                    </Link>
                  </div>
                ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
          {/* Top Attendees */}
          <div className="bg-white p-6 rounded-lg shadow-sm border">
            <h2 className="text-xl font-semibold mb-4">Top Attendees</h2>
            <div className="space-y-3">
              {data?.analytics.topAttendees.map(
                (member: any, index: number) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between p-2 hover:bg-gray-50 rounded"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center">
                        {index + 1}
                      </div>
                      <div className="font-medium">{member.name}</div>
                    </div>
                    <div className="font-bold">{member._count.attendances}</div>
                  </div>
                ),
              )}
            </div>
          </div>

          {/* Low Attendance Events */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h2 className="text-xl font-semibold mb-4">
              Events Needing Attention
            </h2>
            <div className="space-y-3">
              {data?.alerts.lowAttendanceEvents.map((event: any) => (
                <div
                  key={event.id}
                  onClick={() => navigate(`/events/${event.id}`)}
                  className="p-3 border rounded-md flex justify-between items-center cursor-pointer hover:bg-gray-50 transition"
                >
                  <div>
                    <div className="font-medium text-gray-900 hover:text-blue-600 transition">
                      {event.title}
                    </div>
                    <div className="text-sm text-gray-500">
                      {new Date(event.eventDate).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="text-red-600 font-bold">
                    {(event.rate * 100).toFixed(1)}%
                  </div>
                </div>
              ))}
              {data?.alerts.lowAttendanceEvents.length === 0 && (
                <div className="text-gray-500">
                  All recent events had good attendance.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
