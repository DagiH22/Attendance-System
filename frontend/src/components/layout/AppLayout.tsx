import React from "react";
import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { Calendar, BookOpen, Users, LayoutDashboard, LogOut, ShieldCheck } from "lucide-react";
import { clearAllPersistedViewStates } from "../../hooks/usePersistedViewState";

export const AppLayout: React.FC = () => {
  const { admin, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const navItems = [
    { label: "Sessions", path: "/sessions", icon: Calendar, aliasPrefix: ["/sessions", "/events"] },
    { label: "Studies", path: "/studies", icon: BookOpen, aliasPrefix: ["/studies"] },
    { label: "Members", path: "/members", icon: Users, aliasPrefix: ["/members"] },
    { label: "Dashboard", path: "/dashboard", icon: LayoutDashboard, aliasPrefix: ["/dashboard"] },
  ];

  const handleLogout = async () => {
    clearAllPersistedViewStates();
    await logout();
    navigate("/login", { replace: true });
  };

  const isTabActive = (item: typeof navItems[0]) => {
    return item.aliasPrefix.some((prefix) => location.pathname.startsWith(prefix));
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900 selection:bg-blue-100 selection:text-blue-900">
      {/* Top Persistent Header Shell */}
      <header className="fixed top-0 z-40 w-full border-b border-slate-200/90 bg-white/95 backdrop-blur-md transition-all">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-4 sm:pt-5">
          {/* Top Bar: Title & Admin Controls */}
          <div className="mb-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/20 font-black text-lg">
                CS
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900 leading-none">
                  Liturgical Attendance
                </h1>
                <p className="text-[11px] font-bold uppercase tracking-wider text-blue-600 mt-1">
                  Church Hymn Department
                </p>
              </div>
            </div>

            {/* Admin User Info & Logout */}
            <div className="flex items-center gap-2 sm:gap-3">
              {admin && (
                <div className="hidden sm:flex items-center gap-2 rounded-xl bg-slate-100/80 px-3 py-1.5 border border-slate-200/60">
                  <ShieldCheck className="w-4 h-4 text-blue-600" />
                  <span className="text-xs font-bold text-slate-800">{admin.name}</span>
                  <span className="rounded-md bg-white px-1.5 py-0.5 text-[10px] font-black uppercase text-slate-600 border border-slate-200">
                    {admin.role.replace("_", " ")}
                  </span>
                </div>
              )}

              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50/80 px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-100 transition active:scale-[0.98]"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden xs:inline">Sign Out</span>
              </button>
            </div>
          </div>

          {/* Desktop Persistent Navigation Tabs */}
          <nav className="hidden sm:flex space-x-3 overflow-x-auto no-scrollbar border-b border-transparent">
            {navItems.map((item) => {
              const active = isTabActive(item);
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={`group inline-flex items-center gap-2 border-b-2 px-3 pb-2.5 pt-1 text-sm font-bold transition whitespace-nowrap ${
                    active
                      ? "border-blue-600 text-blue-600"
                      : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800"
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 transition ${
                      active ? "text-blue-600" : "text-slate-400 group-hover:text-slate-600"
                    }`}
                  />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </nav>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 pt-20 sm:pt-32 pb-24 sm:pb-20">
        <Outlet />
      </main>

      {/* Mobile Thumb-Reachable Bottom Tab Bar (Safe-area inset aware, >=44px touch targets) */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 sm:hidden border-t border-slate-200/90 bg-white/95 backdrop-blur-md px-2 py-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-lg flex items-center justify-around">
        {navItems.map((item) => {
          const active = isTabActive(item);
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={`flex flex-col items-center justify-center min-h-[44px] min-w-[56px] py-1 px-2 rounded-xl text-[10px] font-bold transition active:scale-95 ${
                active
                  ? "text-blue-600 font-black"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              <Icon
                className={`w-5 h-5 mb-0.5 transition ${
                  active ? "text-blue-600 stroke-[2.5]" : "text-slate-400 stroke-[1.8]"
                }`}
              />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
};

export default AppLayout;
