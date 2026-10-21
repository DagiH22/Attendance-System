import { describe, it, expect } from "vitest";
import {
  DEFAULT_LOCATION_SUGGESTIONS,
  normalizeLocation,
} from "../../config/location.config";

describe("LocationCombobox suggestions logic (Item 3)", () => {
  it("provides the 3 canonical Amharic presets", () => {
    expect(DEFAULT_LOCATION_SUGGESTIONS).toEqual([
      "ማዕከል 4ኛ ፎቅ",
      "ማዕከል አዲሱ ህንጻ 4ኛ ፎቅ",
      "ማዕከል 3ኛ ፎቅ",
    ]);
  });

  it("orders defaults first, then past locations without duplicates", () => {
    const pastLocations = [
      "ማዕከል 4ኛ ፎቅ", // Already in defaults
      "Choir Room",
      "Chapel",
      "ማዕከል 3ኛ ፎቅ", // Already in defaults
    ];

    const list: Array<{ text: string; isPreset: boolean }> = [];
    const seen = new Set<string>();

    for (const preset of DEFAULT_LOCATION_SUGGESTIONS) {
      const norm = normalizeLocation(preset);
      list.push({ text: preset, isPreset: true });
      seen.add(norm);
    }

    for (const past of pastLocations) {
      const norm = normalizeLocation(past);
      if (norm && !seen.has(norm)) {
        list.push({ text: norm, isPreset: false });
        seen.add(norm);
      }
    }

    expect(list).toHaveLength(5);
    expect(list[0].text).toBe("ማዕከል 4ኛ ፎቅ");
    expect(list[0].isPreset).toBe(true);
    expect(list[1].text).toBe("ማዕከል አዲሱ ህንጻ 4ኛ ፎቅ");
    expect(list[1].isPreset).toBe(true);
    expect(list[2].text).toBe("ማዕከል 3ኛ ፎቅ");
    expect(list[2].isPreset).toBe(true);
    expect(list[3].text).toBe("Choir Room");
    expect(list[3].isPreset).toBe(false);
    expect(list[4].text).toBe("Chapel");
    expect(list[4].isPreset).toBe(false);
  });

  it("filters suggestions case-insensitively and preserves Amharic matches", () => {
    const suggestions = [
      "ማዕከል 4ኛ ፎቅ",
      "ማዕከል አዲሱ ህንጻ 4ኛ ፎቅ",
      "ማዕከል 3ኛ ፎቅ",
      "Main Hall",
      "Choir Room",
    ];

    const filterAmharic = (query: string) =>
      suggestions.filter((s) => s.includes(normalizeLocation(query)));

    expect(filterAmharic("አዲሱ")).toEqual(["ማዕከል አዲሱ ህንጻ 4ኛ ፎቅ"]);
    expect(filterAmharic("3ኛ")).toEqual(["ማዕከል 3ኛ ፎቅ"]);

    const filterEnglish = (query: string) =>
      suggestions.filter((s) =>
        s.toLowerCase().includes(query.trim().toLowerCase()),
      );

    expect(filterEnglish("hall")).toEqual(["Main Hall"]);
    expect(filterEnglish("ROOM")).toEqual(["Choir Room"]);
  });
});
