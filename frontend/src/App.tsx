import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import Login from "./pages/Login";
import EventsPage from "./pages/EventsPage";
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
          <Route
            path="/events/create"
            element={
              <div className="p-4 text-center">
                Create Event Page (Coming Soon)
              </div>
            }
          />
          <Route
            path="/events/:id/attendance"
            element={
              <div className="p-4 text-center">
                Attendance Page (Coming Soon)
              </div>
            }
          />
        </Route>

        {/* Redirect root to login */}
        <Route path="/" element={<Navigate to="/login" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
