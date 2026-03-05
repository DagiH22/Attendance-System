import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import Login from "./pages/Login";
import ProtectedRoute from "./components/ProtectedRoute";
import "./App.css";

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />

        {/* Protected Routes */}
        <Route element={<ProtectedRoute />}>
          <Route
            path="/events"
            element={
              <div>
                <h1>Events</h1>
                <button
                  onClick={() => {
                    localStorage.removeItem("token");
                    window.location.href = "/login";
                  }}
                >
                  Logout
                </button>
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
