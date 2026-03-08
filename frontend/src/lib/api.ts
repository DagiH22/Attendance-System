import axios, {
  AxiosError,
  AxiosHeaders,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from "axios";

const ACCESS_TOKEN_KEY = "accessToken";
const apiBaseUrl = "http://localhost:4000";

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
