/**
 * Canonical default session location suggestions (Item 3).
 * Preserved with exact Amharic characters and single spaces.
 */
export const DEFAULT_LOCATION_SUGGESTIONS = [
  "ማዕከል 4ኛ ፎቅ",
  "ማዕከል አዲሱ ህንጻ 4ኛ ፎቅ",
  "ማዕከል 3ኛ ፎቅ",
] as const;

export type DefaultLocationSuggestion =
  (typeof DEFAULT_LOCATION_SUGGESTIONS)[number];

/**
 * Normalizes location string: trims whitespace and collapses multiple consecutive spaces.
 */
export function normalizeLocation(location?: unknown): string {
  if (typeof location !== "string") return "";
  return location.trim().replace(/\s+/g, " ");
}
