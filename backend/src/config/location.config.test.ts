import { describe, it, expect } from "vitest";
import {
  DEFAULT_LOCATION_SUGGESTIONS,
  normalizeLocation,
} from "./location.config";

describe("Session Location Config & Normalization (Item 3)", () => {
  it("contains the exact 3 Amharic default presets with single spaces", () => {
    expect(DEFAULT_LOCATION_SUGGESTIONS).toHaveLength(3);
    expect(DEFAULT_LOCATION_SUGGESTIONS[0]).toBe("ማዕከል 4ኛ ፎቅ");
    expect(DEFAULT_LOCATION_SUGGESTIONS[1]).toBe("ማዕከል አዲሱ ህንጻ 4ኛ ፎቅ");
    expect(DEFAULT_LOCATION_SUGGESTIONS[2]).toBe("ማዕከል 3ኛ ፎቅ");
  });

  it("normalizeLocation trims leading and trailing whitespace", () => {
    expect(normalizeLocation("  ማዕከል 4ኛ ፎቅ  ")).toBe("ማዕከል 4ኛ ፎቅ");
    expect(normalizeLocation("\tMain Hall\n")).toBe("Main Hall");
  });

  it("normalizeLocation collapses multiple consecutive spaces into a single space", () => {
    expect(normalizeLocation("ማዕከል   አዲሱ    ህንጻ   4ኛ   ፎቅ")).toBe(
      "ማዕከል አዲሱ ህንጻ 4ኛ ፎቅ",
    );
    expect(normalizeLocation("Hall   Room    101")).toBe("Hall Room 101");
  });

  it("normalizeLocation returns empty string for null, undefined, empty, or whitespace-only inputs", () => {
    expect(normalizeLocation(null)).toBe("");
    expect(normalizeLocation(undefined)).toBe("");
    expect(normalizeLocation("")).toBe("");
    expect(normalizeLocation("   \t  \n ")).toBe("");
    expect(normalizeLocation(12345 as any)).toBe("");
  });
});
