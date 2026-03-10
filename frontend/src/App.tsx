import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import Login from "./pages/Login";
import EventsPage from "./pages/EventsPage";
import MembersPage from "./pages/MembersPage";
import CreateEvent from "./pages/CreateEvent";
import EventDetailsPage from "./pages/EventDetailsPage";
import TakeAttendancePage from "./pages/TakeAttendancePage";
import ProtectedRoute from "./components/ProtectedRoute";
import "./App.css";

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />

        {/* Protected Routes */}
        <Route element={<ProtectedRoute />}>
          <Route path="/events" element={<EventsPage />} />
          <Route path="/members" element={<MembersPage />} />
          <Route path="/events/create" element={<CreateEvent />} />
          <Route path="/events/:id" element={<EventDetailsPage />} />
          <Route
            path="/events/:id/attendance"
            element={<TakeAttendancePage />}
          />
        </Route>

        {/* Redirect root to login */}
        <Route path="/" element={<Navigate to="/login" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
