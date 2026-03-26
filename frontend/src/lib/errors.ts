import { isAxiosError } from "axios";

export type FriendlyError = {
  title: string;
  message: string;
  status?: number;
  /** Raw server message (useful for debugging) */
  detail?: string;
};

const DEFAULT_ERROR: FriendlyError = {
  title: "Something went wrong",
  message: "Please try again.",
};

const getString = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const coalesceString = (...values: unknown[]) => {
  for (const value of values) {
    const str = getString(value);
    if (str) return str;
  }
  return "";
};

/**
 * Convert unknown thrown values (Axios/server/network errors) into a user-friendly message.
 * Keep it safe for end-users (no stack traces) but still descriptive.
 */
export const toFriendlyError = (
  error: unknown,
  context?: {
    action?: string; // e.g. "sign in", "load events"
    fallbackTitle?: string;
    fallbackMessage?: string;
  },
): FriendlyError => {
  const action = context?.action;
  const fallbackTitle = context?.fallbackTitle ?? DEFAULT_ERROR.title;
  const fallbackMessage = context?.fallbackMessage ?? DEFAULT_ERROR.message;

  if (!isAxiosError(error)) {
    return {
      title: fallbackTitle,
      message: action
        ? `We couldn't ${action}. ${fallbackMessage}`
        : fallbackMessage,
    };
  }

  const status = error.response?.status;
  const responseData = error.response?.data as any;

  const serverMessage = coalesceString(
    responseData?.error,
    responseData?.message,
    responseData?.detail,
    error.message,
  );

  // Network / CORS / offline / DNS
  if (!error.response) {
    // Axios uses these codes for typical network problems
    const code = (error as any).code as string | undefined;

    if (code === "ECONNABORTED") {
      return {
        title: "Request timed out",
        message:
          "The server took too long to respond. Please check your connection and try again.",
        detail: serverMessage,
      };
    }

    return {
      title: "Can't reach the server",
      message:
        "Please check your internet connection (or the server may be down) and try again.",
      detail: serverMessage,
    };
  }

  // Auth & permissions
  if (status === 401) {
    // Prefer backend wording if present, but keep a friendly default.
    const message =
      serverMessage ||
      (action === "sign in"
        ? "The email or password is incorrect. Please try again."
        : "Your session has expired. Please sign in again.");

    return {
      title: action === "sign in" ? "Sign-in failed" : "Session expired",
      message,
      status,
      detail: serverMessage,
    };
  }

  if (status === 403) {
    return {
      title: "Access denied",
      message:
        serverMessage || "You don't have permission to perform this action.",
      status,
      detail: serverMessage,
    };
  }

  if (status === 404) {
    return {
      title: "Not found",
      message: serverMessage || "We couldn't find what you were looking for.",
      status,
      detail: serverMessage,
    };
  }

  if (status === 409) {
    return {
      title: "Already exists",
      message: serverMessage || "That action conflicts with existing data.",
      status,
      detail: serverMessage,
    };
  }

  if (status === 400) {
    return {
      title: "Please check your input",
      message: serverMessage || "Some information looks incorrect.",
      status,
      detail: serverMessage,
    };
  }

  if (status && status >= 500) {
    return {
      title: "Server error",
      message:
        serverMessage ||
        "The server had a problem. Please try again in a moment.",
      status,
      detail: serverMessage,
    };
  }

  return {
    title: fallbackTitle,
    message:
      serverMessage || (action ? `We couldn't ${action}.` : fallbackMessage),
    status,
    detail: serverMessage,
  };
};
