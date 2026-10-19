import { describe, it, expect } from "vitest";
import {
  compareSessions,
  compareStudyGroups,
  type SessionLike,
  type StudyGroupLike,
} from "./sessionComparator";

describe("compareSessions (Item 6)", () => {
  const now = new Date("2026-10-20T12:00:00Z");

  const activeSession: SessionLike = {
    id: "s-active",
    title: "Active Session",
    startTime: "2026-10-20T11:00:00Z",
    endTime: "2026-10-20T13:00:00Z",
    status: "ACTIVE",
    attendanceOpen: true,
  };

  const upcomingSoon: SessionLike = {
    id: "s-up-soon",
    title: "Upcoming Tomorrow",
    startTime: "2026-10-21T10:00:00Z",
    endTime: "2026-10-21T12:00:00Z",
    status: "UPCOMING",
  };

  const upcomingLater: SessionLike = {
    id: "s-up-later",
    title: "Upcoming Next Week",
    startTime: "2026-10-27T10:00:00Z",
    endTime: "2026-10-27T12:00:00Z",
    status: "UPCOMING",
  };

  const pastRecent: SessionLike = {
    id: "s-past-recent",
    title: "Past Yesterday",
    startTime: "2026-10-19T10:00:00Z",
    endTime: "2026-10-19T12:00:00Z",
    status: "PAST",
  };

  const pastOld: SessionLike = {
    id: "s-past-old",
    title: "Past Last Month",
    startTime: "2026-09-19T10:00:00Z",
    endTime: "2026-09-19T12:00:00Z",
    status: "PAST",
  };

  const cancelledSession: SessionLike = {
    id: "s-cancelled",
    title: "Cancelled Session",
    startTime: "2026-10-20T14:00:00Z",
    endTime: "2026-10-20T16:00:00Z",
    status: "CANCELLED",
    cancelledAt: "2026-10-19T00:00:00Z",
  };

  it("orders sessions inside group: ACTIVE first -> UPCOMING soonest -> PAST most recent -> CANCELLED last", () => {
    const list = [
      pastOld,
      cancelledSession,
      upcomingLater,
      pastRecent,
      activeSession,
      upcomingSoon,
    ];

    const sorted = [...list].sort((a, b) => compareSessions(a, b, "SMART", "asc", now));

    expect(sorted.map((s) => s.id)).toEqual([
      "s-active",
      "s-up-soon",
      "s-up-later",
      "s-past-recent",
      "s-past-old",
      "s-cancelled",
    ]);
  });
});

describe("compareStudyGroups (Item 6 & Item 7)", () => {
  const now = new Date("2026-10-20T12:00:00Z");

  const studyWithActive: StudyGroupLike = {
    id: "g-active",
    name: "Study With Active Session",
    sessions: [
      {
        id: "s1",
        title: "Active",
        startTime: "2026-10-20T11:00:00Z",
        endTime: "2026-10-20T13:00:00Z",
        status: "ACTIVE",
        attendanceOpen: true,
      },
    ],
  };

  const studyUpcomingSoon: StudyGroupLike = {
    id: "g-up-soon",
    name: "Study Upcoming Soonest",
    sessions: [
      {
        id: "s2",
        title: "Tomorrow Session",
        startTime: "2026-10-21T10:00:00Z",
        endTime: "2026-10-21T12:00:00Z",
        status: "UPCOMING",
      },
    ],
  };

  const studyUpcomingLater: StudyGroupLike = {
    id: "g-up-later",
    name: "Study Upcoming Next Week",
    sessions: [
      {
        id: "s3",
        title: "Next Week Session",
        startTime: "2026-10-28T10:00:00Z",
        endTime: "2026-10-28T12:00:00Z",
        status: "UPCOMING",
      },
    ],
  };

  const studyFutureStartDateNoSessions: StudyGroupLike = {
    id: "g-future-empty",
    name: "Future Study Empty",
    startDate: "2026-11-01",
    sessions: [],
  };

  const studyPastRecentSession: StudyGroupLike = {
    id: "g-past-recent",
    name: "Past Study With Recent Session",
    sessions: [
      {
        id: "s4",
        title: "Recent Completed",
        startTime: "2026-10-18T10:00:00Z",
        endTime: "2026-10-18T12:00:00Z",
        status: "PAST",
      },
    ],
  };

  const studyPastOlderSession: StudyGroupLike = {
    id: "g-past-older",
    name: "Past Study With Older Session",
    sessions: [
      {
        id: "s5",
        title: "Older Completed",
        startTime: "2026-09-01T10:00:00Z",
        endTime: "2026-09-01T12:00:00Z",
        status: "PAST",
      },
    ],
  };

  const emptyStudyPastNewer: StudyGroupLike = {
    id: "g-empty-new",
    name: "Empty Past Created Today",
    startDate: "2026-01-01",
    createdAt: "2026-10-15T00:00:00Z",
    sessions: [],
  };

  const emptyStudyPastOlder: StudyGroupLike = {
    id: "g-empty-old",
    name: "Empty Past Created Last Year",
    startDate: "2026-01-01",
    createdAt: "2025-01-01T00:00:00Z",
    sessions: [],
  };

  it("orders groups strictly by specification hierarchy", () => {
    const groups = [
      emptyStudyPastOlder,
      studyPastOlderSession,
      studyUpcomingLater,
      emptyStudyPastNewer,
      studyPastRecentSession,
      studyFutureStartDateNoSessions,
      studyUpcomingSoon,
      studyWithActive,
    ];

    const sorted = [...groups].sort((a, b) => compareStudyGroups(a, b, "SMART", "asc", now));

    expect(sorted.map((g) => g.id)).toEqual([
      "g-active",
      "g-up-soon",
      "g-up-later",
      "g-future-empty",
      "g-past-recent",
      "g-past-older",
      "g-empty-new",
      "g-empty-old",
    ]);
  });

  it("applies standalone group using the same rules", () => {
    const standaloneGroup: StudyGroupLike = {
      id: "STANDALONE",
      name: "Standalone",
      sessions: [
        {
          id: "s-stand-active",
          title: "Standalone Active",
          startTime: "2026-10-20T10:00:00Z",
          endTime: "2026-10-20T12:30:00Z",
          status: "ACTIVE",
          attendanceOpen: true,
        },
      ],
    };

    const sorted = [studyUpcomingSoon, standaloneGroup].sort((a, b) =>
      compareStudyGroups(a, b, "SMART", "asc", now),
    );

    expect(sorted[0].id).toBe("STANDALONE");
  });

  it("supports sorting by name with direction toggle", () => {
    const gA: StudyGroupLike = { id: "a", name: "Alpha", sessions: [] };
    const gB: StudyGroupLike = { id: "b", name: "Beta", sessions: [] };

    expect(compareStudyGroups(gA, gB, "NAME", "asc")).toBeLessThan(0);
    expect(compareStudyGroups(gA, gB, "NAME", "desc")).toBeGreaterThan(0);
  });
});
