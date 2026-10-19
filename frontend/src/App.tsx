import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import Login from "./pages/Login";
import EventsPage from "./pages/EventsPage";
import MembersPage from "./pages/MembersPage";
import DashboardPage from "./pages/Dashboard";
import MemberDetailsPage from "./pages/MemberDetailsPage";
import EventDetailsPage from "./pages/EventDetailsPage";
import StudiesPage from "./pages/StudiesPage";
import TakeAttendancePage from "./pages/TakeAttendancePage";
import ProtectedRoute from "./components/ProtectedRoute";
import AppLayout from "./components/layout/AppLayout";
import "./App.css";

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />

        {/* Protected Routes */}
        <Route element={<ProtectedRoute />}>
          {/* Main Shell with Persistent Header & Navigation Tabs (Item 3) */}
          <Route element={<AppLayout />}>
            <Route path="/sessions" element={<EventsPage />} />
            <Route path="/events" element={<Navigate to="/sessions" replace />} />
            <Route path="/studies" element={<StudiesPage />} />
            <Route path="/members" element={<MembersPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/sessions/:id" element={<EventDetailsPage />} />
            <Route path="/events/:id" element={<EventDetailsPage />} />
            <Route path="/members/:memberId" element={<MemberDetailsPage />} />
          </Route>

          {/* Standalone Live Attendance Scanner */}
          <Route path="/sessions/:id/attendance" element={<TakeAttendancePage />} />
          <Route path="/events/:id/attendance" element={<TakeAttendancePage />} />

          {/* Redirect legacy standalone creation routes to drawer-driven views */}
          <Route
            path="/events/create"
            element={<Navigate to="/sessions" replace />}
          />
          <Route
            path="/sessions/create"
            element={<Navigate to="/sessions" replace />}
          />
          <Route
            path="/members/register"
            element={<Navigate to="/members" replace />}
          />
          <Route
            path="/members/:memberId/edit"
            element={<Navigate to="/members" replace />}
          />
        </Route>

        {/* Root Redirect to Sessions */}
        <Route path="/" element={<Navigate to="/sessions" replace />} />
        <Route path="*" element={<Navigate to="/sessions" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
