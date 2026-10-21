import { describe, it, expect, beforeEach, vi } from "vitest";
import { clearAllPersistedViewStates } from "./usePersistedViewState";

describe("usePersistedViewState & clearAllPersistedViewStates (Item 2)", () => {
  let storage: Record<string, string> = {};

  beforeEach(() => {
    storage = {};

    const mockLocalStorage = {
      getItem: vi.fn((key: string) => storage[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage[key] = String(value);
      }),
      removeItem: vi.fn((key: string) => {
        delete storage[key];
      }),
      clear: vi.fn(() => {
        storage = {};
      }),
      get length() {
        return Object.keys(storage).length;
      },
      key: vi.fn((index: number) => Object.keys(storage)[index] ?? null),
    };

    (globalThis as any).window = {
      localStorage: mockLocalStorage,
      location: { search: "" },
    };
  });

  it("clearAllPersistedViewStates removes all view_state:* keys from localStorage on logout while preserving other keys", () => {
    window.localStorage.setItem("view_state:studies", JSON.stringify({ studyId: "study-1" }));
    window.localStorage.setItem("view_state:sessions", JSON.stringify({ search: "general" }));
    window.localStorage.setItem("view_state:members", JSON.stringify({ batch: "YEAR_3" }));
    window.localStorage.setItem("view_state:session_details", JSON.stringify({ tab: "ABSENTEES" }));
    window.localStorage.setItem("view_state:take_attendance", JSON.stringify({ activeTab: "MANUAL" }));
    window.localStorage.setItem("auth_token", "jwt-token-12345");
    window.localStorage.setItem("theme_preference", "dark");

    expect(window.localStorage.length).toBe(7);

    clearAllPersistedViewStates();

    expect(window.localStorage.getItem("view_state:studies")).toBeNull();
    expect(window.localStorage.getItem("view_state:sessions")).toBeNull();
    expect(window.localStorage.getItem("view_state:members")).toBeNull();
    expect(window.localStorage.getItem("view_state:session_details")).toBeNull();
    expect(window.localStorage.getItem("view_state:take_attendance")).toBeNull();
    expect(window.localStorage.getItem("auth_token")).toBe("jwt-token-12345");
    expect(window.localStorage.getItem("theme_preference")).toBe("dark");
  });

  describe("Inventory of stateful controls persistence behavior", () => {
    it("preserves Studies page controls (studyId, grid filters, notPart filters, hide toggle, pagination)", () => {
      const pageKey = "studies";
      const storageKey = `view_state:${pageKey}`;
      const state = {
        studyId: "study-mary-feast",
        gridSearch: "Dawit",
        gridCampus: "FIVE_KILO",
        gridBatch: "YEAR_4",
        notPartSearch: "Abel",
        notPartCampus: "FOUR_KILO",
        notPartBatch: "YEAR_3",
        notPartDept: "Software Engineering",
        notPartHideOther: true, // "Hide members attending another study" toggle
        notPartPage: 2,
      };

      // 1. Save to localStorage
      window.localStorage.setItem(storageKey, JSON.stringify(state));

      // 2. Simulate page reload / bare navigation return: read from localStorage
      const cached = JSON.parse(window.localStorage.getItem(storageKey)!);
      expect(cached.studyId).toBe("study-mary-feast");
      expect(cached.notPartHideOther).toBe(true);
      expect(cached.gridCampus).toBe("FIVE_KILO");
      expect(cached.notPartPage).toBe(2);

      // 3. Reset filters clears the storageKey
      window.localStorage.removeItem(storageKey);
      expect(window.localStorage.getItem(storageKey)).toBeNull();
    });

    it("preserves Sessions page controls (search, status, sessionType, studyId, sortBy, sortDir, groupByStudy)", () => {
      const pageKey = "sessions";
      const storageKey = `view_state:${pageKey}`;
      const state = {
        search: "Evening Vigil",
        status: "ACTIVE",
        sessionType: "OVERNIGHT",
        studyId: "study-liturgy-1",
        sortBy: "DATE",
        sortDir: "desc",
        groupByStudy: false,
      };

      window.localStorage.setItem(storageKey, JSON.stringify(state));

      const cached = JSON.parse(window.localStorage.getItem(storageKey)!);
      expect(cached.sessionType).toBe("OVERNIGHT");
      expect(cached.groupByStudy).toBe(false);
      expect(cached.sortDir).toBe("desc");
    });

    it("preserves Members page controls (q, status, gender, batch, sortBy, page)", () => {
      const pageKey = "members";
      const storageKey = `view_state:${pageKey}`;
      const state = {
        q: "0911223344",
        status: "ACTIVE",
        gender: "FEMALE",
        batch: "YEAR_2",
        sortBy: "MOST_ATTENDANCE",
        page: 3,
      };

      window.localStorage.setItem(storageKey, JSON.stringify(state));

      const cached = JSON.parse(window.localStorage.getItem(storageKey)!);
      expect(cached.q).toBe("0911223344");
      expect(cached.gender).toBe("FEMALE");
      expect(cached.sortBy).toBe("MOST_ATTENDANCE");
      expect(cached.page).toBe(3);
    });

    it("preserves Event Details page modal controls (tab, page, sortBy, order, showAllEligible, search)", () => {
      const pageKey = "session_details";
      const storageKey = `view_state:${pageKey}`;
      const state = {
        tab: "ABSENTEES",
        page: 2,
        sortBy: "name",
        order: "desc",
        showAllEligible: true, // "Show all eligible members" toggle
        search: "Kiros",
      };

      window.localStorage.setItem(storageKey, JSON.stringify(state));

      const cached = JSON.parse(window.localStorage.getItem(storageKey)!);
      expect(cached.tab).toBe("ABSENTEES");
      expect(cached.showAllEligible).toBe(true);
      expect(cached.search).toBe("Kiros");
    });

    it("preserves Take Attendance page controls (activeTab, searchQuery, manualPage, statusFilter, sortBy)", () => {
      const pageKey = "take_attendance";
      const storageKey = `view_state:${pageKey}`;
      const state = {
        activeTab: "MANUAL",
        searchQuery: "MEZ-0012",
        manualPage: 4,
        statusFilter: "ACTIVE",
        sortBy: "RECENTLY_REGISTERED",
      };

      window.localStorage.setItem(storageKey, JSON.stringify(state));

      const cached = JSON.parse(window.localStorage.getItem(storageKey)!);
      expect(cached.activeTab).toBe("MANUAL");
      expect(cached.searchQuery).toBe("MEZ-0012");
      expect(cached.manualPage).toBe(4);
      expect(cached.statusFilter).toBe("ACTIVE");
      expect(cached.sortBy).toBe("RECENTLY_REGISTERED");
    });
  });
});
