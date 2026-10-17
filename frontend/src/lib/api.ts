import axios, {
  AxiosError,
  AxiosHeaders,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from "axios";

const ACCESS_TOKEN_KEY = "accessToken";
const apiBaseUrl =(import.meta.env.VITE_API_URL as string) || "http://localhost:4000";

let isRefreshing = false;
let refreshPromise: Promise<string | null> | null = null;
let sessionExpiredHandler: (() => void) | null = null;

type RetryableRequestConfig = InternalAxiosRequestConfig & {
  _retry?: boolean;
};

export const getStoredAccessToken = () =>
  localStorage.getItem(ACCESS_TOKEN_KEY);

export const storeAccessToken = (token: string) => {
  localStorage.setItem(ACCESS_TOKEN_KEY, token);
};

export const clearStoredAccessToken = () => {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
};

export const setSessionExpiredHandler = (handler: (() => void) | null) => {
  sessionExpiredHandler = handler;
};

const api: AxiosInstance = axios.create({
  baseURL: apiBaseUrl,
  withCredentials: true,
});

const applyAccessToken = (
  config: InternalAxiosRequestConfig,
  token: string,
) => {
  const headers =
    config.headers instanceof AxiosHeaders
      ? config.headers
      : new AxiosHeaders(config.headers);

  headers.set("Authorization", `Bearer ${token}`);
  config.headers = headers;
};

export const refreshAccessToken = async (): Promise<string | null> => {
  if (isRefreshing && refreshPromise) {
    return refreshPromise;
  }

  isRefreshing = true;
  refreshPromise = api
    .post("/auth/refresh")
    .then((response) => {
      const nextAccessToken = response.data?.accessToken;
      if (nextAccessToken) {
        storeAccessToken(nextAccessToken);
        return nextAccessToken as string;
      }

      clearStoredAccessToken();
      return null;
    })
    .catch((error) => {
      clearStoredAccessToken();
      throw error;
    })
    .finally(() => {
      isRefreshing = false;
      refreshPromise = null;
    });

  return refreshPromise;
};

api.interceptors.request.use(
  (config) => {
    const token = getStoredAccessToken();
    if (token) {
      applyAccessToken(config, token);
    }
    return config;
  },
  (error) => Promise.reject(error),
);

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetryableRequestConfig | undefined;
    const status = error.response?.status;
    const requestUrl = originalRequest?.url ?? "";
    const isRefreshCall = requestUrl.includes("/auth/refresh");
    const shouldAttemptRefresh =
      status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      !isRefreshCall;

    if (!shouldAttemptRefresh) {
      if (status === 401 && isRefreshCall) {
        sessionExpiredHandler?.();
      }
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    try {
      const newAccessToken = await refreshAccessToken();

      if (!newAccessToken) {
        sessionExpiredHandler?.();
        return Promise.reject(error);
      }

      applyAccessToken(originalRequest, newAccessToken);
      return api(originalRequest);
    } catch (refreshError) {
      sessionExpiredHandler?.();
      return Promise.reject(refreshError);
    }
  },
);

export default api;

export const getMembersCount = async (): Promise<number> => {
  const res = await api.get(`/members/count`);
  return res.data?.count ?? 0;
};

// Studies
export const getStudies = async () => (await api.get("/studies")).data.studies;
export const getStudyById = async (id: string) => (await api.get(`/studies/${id}`)).data;
export const createStudy = async (data: any) => (await api.post("/studies", data)).data;
export const updateStudy = async (id: string, data: any) => (await api.patch(`/studies/${id}`, data)).data;
export const deleteStudy = async (id: string) => (await api.delete(`/studies/${id}`)).data;
export const addSessionsToStudy = async (id: string, data: any) => (await api.post(`/studies/${id}/sessions`, data)).data;
export const getStudyStats = async (id: string) => (await api.get(`/studies/${id}/stats`)).data;
export const getStudyGrid = async (id: string) => (await api.get(`/studies/${id}/grid`)).data;

// Events
export const rescheduleEvent = async (id: string, data: { startTime: string; endTime: string; reason: string }) =>
  (await api.patch(`/events/${id}/reschedule`, data)).data;
export const cancelEvent = async (id: string, data: { reason: string }) =>
  (await api.patch(`/events/${id}/cancel`, data)).data;
export const getEventAbsentees = async (id: string) => (await api.get(`/events/${id}/absentees`)).data;

// Attendance
export const excuseMember = async (data: { eventId: string; memberId: string; reason: string }) =>
  (await api.post("/attendance/excuse", data)).data;
export const undoAttendance = async (id: string, reason?: string) =>
  (await api.patch(`/attendance/${id}/undo`, { reason })).data;
export const updateAttendanceStatus = async (id: string, status: string, excuseReason?: string) =>
  (await api.patch(`/attendance/${id}/status`, { status, excuseReason })).data;

// Members
export const getPromotePreview = async () => (await api.get("/members/promote-preview")).data;

