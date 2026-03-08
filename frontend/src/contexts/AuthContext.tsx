import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import api, {
  clearStoredAccessToken,
  getStoredAccessToken,
  refreshAccessToken,
  setSessionExpiredHandler,
  storeAccessToken,
} from "../lib/api";
import type { AuthAdmin } from "../types/auth";

type AuthContextValue = {
  admin: AuthAdmin | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  sessionMessage: string;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  clearSessionMessage: () => void;
  restoreSession: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [admin, setAdmin] = useState<AuthAdmin | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionMessage, setSessionMessage] = useState("");

  const clearAuthState = useCallback((message?: string) => {
    clearStoredAccessToken();
    setAdmin(null);
    setSessionMessage(message ?? "");
  }, []);

  const restoreSession = useCallback(async () => {
    setIsLoading(true);

    try {
      if (!getStoredAccessToken()) {
        try {
          await refreshAccessToken();
        } catch {
          clearAuthState();
          return;
        }
      }

      const response = await api.get("/auth/me");
      setAdmin(response.data.admin);
      setSessionMessage("");
    } catch {
      try {
        await refreshAccessToken();
        const response = await api.get("/auth/me");
        setAdmin(response.data.admin);
        setSessionMessage("");
      } catch {
        clearAuthState("Session expired. Please sign in again.");
      }
    } finally {
      setIsLoading(false);
    }
  }, [clearAuthState]);

  useEffect(() => {
    setSessionExpiredHandler(() => {
      clearAuthState("Session expired. Please sign in again.");
    });

    void restoreSession();
  }, [clearAuthState, restoreSession]);

  const login = useCallback(async (email: string, password: string) => {
    const response = await api.post("/auth/login", { email, password });
    const { accessToken, admin: adminData } = response.data;

    if (!accessToken) {
      throw new Error("No access token received.");
    }

    storeAccessToken(accessToken);
    setAdmin(adminData);
    setSessionMessage("");
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      // ignore logout network failure and clear client-side session anyway
    } finally {
      clearAuthState();
    }
  }, [clearAuthState]);

  const clearSessionMessage = useCallback(() => {
    setSessionMessage("");
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      admin,
      isAuthenticated: Boolean(admin),
      isLoading,
      sessionMessage,
      login,
      logout,
      clearSessionMessage,
      restoreSession,
    }),
    [
      admin,
      isLoading,
      sessionMessage,
      login,
      logout,
      clearSessionMessage,
      restoreSession,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }

  return context;
};
