# V2 Pre-Implementation Audit Report (`docs/V2_AUDIT.md`)

**Date:** 2026-10-21  
**Branch:** `fix/v2-checks-and-mobile`  
**Base Commit:** `99d612f` (Merge branch 'master' into v2)

---

## 1. Executive Summary & Audit Matrix

| Item # | Area / Feature | Status | Primary Finding & Evidence |
| :--- | :--- | :---: | :--- |
| **Item 1** | Automatic yearly batch upgrade on Sept 11 | **FAIL / PARTIAL** | `academic.config.ts` only specifies month 9 (`ACADEMIC_YEAR_START_MONTH = 9`) without day 11 or `Africa/Addis_Ababa` timezone evaluation. Sept 1–10 prematurely increments academic year. No startup or daily 00:05 Addis synchronization job exists to keep stored `member.batch` in sync. Direct `member.batch` reads exist in `member.controller.ts:780` and `Dashboard.tsx:400`. |
| **Item 2** | UI state preservation | **FAIL / PARTIAL** | `usePersistedViewState.ts` uses `sessionStorage` (lost on mobile tab discards) instead of `localStorage`. Navigation links (`AppLayout.tsx:77`) link to bare paths without search params. "Hide members attending another study" (`StudiesPage.tsx:581`) and "Show all eligible members" (`EventDetailsPage.tsx:170`) use unwired local component state. Stored state is not cleared on logout (`AppLayout.tsx:62`). "Reset filters" buttons are missing. |
| **Item 3** | Session location suggestions | **FAIL** | Location is enforced as required in `CreateEvent.tsx:175` and `EventDetailsPage.tsx:757`. The 3 Amharic suggestions ("ማዕከል 4ኛ ፎቅ", "ማዕከል አዲሱ ህንጻ 4ኛ ፎቅ", "ማዕከል 3ኛ ፎቅ") and dynamic session history dropdown are completely absent. Whitespace normalization on save is missing. |
| **Item 4** | Mobile optimization | **FAIL / PARTIAL** | Inputs use `text-sm` (14px) which triggers iOS Safari auto-zoom. PWA manifest is absent. Take Attendance lacks camera portrait viewport sizing, vibration, torch toggle, and Screen Wake Lock. Filters and sort options lack a mobile bottom sheet modal. Long lists lack virtualization / lazy loading. |
| **Item 5** | Clean page titles (only page name) | **FAIL** | Grep found visible "liturgical", "hymn", and descriptive subtitles across `StudiesPage.tsx:296`, `EventsPage.tsx:281`, `Dashboard.tsx:58`, `MembersPage.tsx:296`, `AppLayout.tsx:40`, `StudyFormDrawer.tsx:157`, and `SessionFormDrawer.tsx:211`. |
| **Item 6** | Remove batch/graduating descriptions | **FAIL / PARTIAL** | "Final Year (Graduating)" description present in `StudiesPage.tsx:477`. In `MemberForm.tsx:478`, batch is labeled "Batch" instead of "Current batch" on registration, and allows direct editing of the stored batch instead of showing computed batch with manual override. |
| **Item 7** | Validation rules (Backend & Frontend) | **FAIL / PARTIAL** | Missing backend checks: session duration upper bounds (24h), session `endTime > startTime`, lateness grace <= duration, study `endDate >= startDate`, case-insensitive study name uniqueness, duplicate phone rejection on member creation, and campus/batch consistency (e.g. YEAR_5 on 4-year campus). |
| **Item 8** | Excel exports (old and new data) | **FAIL / PARTIAL** | Session absentees export endpoint is missing entirely. Existing exports lack frozen header rows (`state: "frozen", ySplit: 1`) in study grids and not-participating sheets. Dates in session attendance use server locale rather than `Africa/Addis_Ababa`. Phone columns are not explicitly formatted as text (`numFmt: '@'`), risking leading zero truncation. |
| **Item 9** | Overnight sessions (spanning 2 days) | **FAIL / PARTIAL** | While Prisma schema stores `startTime` and `endTime` as full `DateTime` fields, frontend `SessionFormDrawer.tsx` has no end DATE input for OVERNIGHT sessions. Recurrence helper `setTimeOnDate` forces `endTime` to the same date as `startTime`, corrupting overnight recurrence series. |

---

## 2. Deep Dive Audit by Item

### Item 1: Automatic Yearly Batch Upgrade on Sept 11
- **File & Line Evidence:**
  - `backend/src/config/academic.config.ts:20`:
    ```typescript
    export const ACADEMIC_YEAR_START_MONTH = 9; // Only month 9, day 11 is missing
    ```
  - `backend/src/services/academic.service.ts:84-92`:
    ```typescript
    export function getAcademicYear(date: Date, startMonth: number = ACADEMIC_YEAR_START_MONTH): number {
      const d = new Date(date);
      const month = d.getMonth() + 1; // 1-12
      const fullYear = d.getFullYear();
      return month >= startMonth ? fullYear : fullYear - 1; // Evaluated in server local time, not Africa/Addis_Ababa!
    }
    ```
    *Flaw:* For any date between Sept 1 and Sept 10 (e.g. 2026-09-05), `month >= 9` evaluates to `true`, advancing the academic year before Ethiopian New Year (Sept 11). Furthermore, `d.getMonth()` evaluates in local server/UTC time rather than `Africa/Addis_Ababa` (UTC+3, where midnight Sept 11 is Sept 10 21:00 UTC).
  - `backend/src/index.ts:21-65`:
    Only `startEventLifecycleScheduler(prisma)` is invoked. No startup catch-up job or recurring daily 00:05 Addis sync job exists to recompute and write the stored `batch` column in table `members`.
  - Direct `member.batch` reads:
    - `backend/src/controllers/member.controller.ts:780`: `batch: member.batch` passed to `sendMemberEmail`.
    - `frontend/src/pages/Dashboard.tsx:400`: `<span>{member.batch}</span>` instead of computed/effective batch.
- **Evaluation:** **FAIL / PARTIAL**. Requires configuration constant `{ month: 9, day: 11 }`, timezone-aware evaluation, synchronization job with logging, and replacement of direct reads.

---

### Item 2: UI State Preservation & Control Inventory
- **File & Line Evidence:**
  - `frontend/src/hooks/usePersistedViewState.ts:26,74`: Uses `window.sessionStorage`. When mobile browsers discard background tabs to reclaim memory, all saved view state is erased.
  - `frontend/src/components/layout/AppLayout.tsx:62-67`: `handleLogout` does not clear view state keys in storage.
  - `frontend/src/components/layout/AppLayout.tsx:77-80`: Top navigation tabs route to bare paths (e.g. `/studies`, `/members`), stripping query parameters from the active URL without triggering state resynchronization.
  - `frontend/src/pages/EventDetailsPage.tsx:170`: `const [showAllEligibleAbsentees, setShowAllEligibleAbsentees] = useState(false);` is isolated in local state.
  - `frontend/src/pages/StudiesPage.tsx:581`: `viewState.notPartHideOther` is stored in `sessionStorage` but not resynchronized back to the URL upon navigating to `/studies`.
  - Pages (`MembersPage.tsx`, `EventsPage.tsx`, `StudiesPage.tsx`) lack a clear "Reset filters" button.

#### Inventory of All Stateful Controls
| Page | Control / Element | State Key / Type | Current Storage | Required Storage | Missing Behavior |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Studies** | Select Study | `studyId` (string) | `sessionStorage` + URL | `localStorage` + URL | Defaults override chosen active study on tab return |
| **Studies** | Grid Member Search | `gridSearch` (string) | `sessionStorage` + URL | `localStorage` + URL | Lost on session discard |
| **Studies** | Grid Campus Filter | `gridCampus` (Campus \| ALL) | `sessionStorage` + URL | `localStorage` + URL | Lost on session discard |
| **Studies** | Grid Batch Filter | `gridBatch` (Batch \| ALL) | `sessionStorage` + URL | `localStorage` + URL | Lost on session discard |
| **Studies** | Not Participating Search | `notPartSearch` (string) | `sessionStorage` + URL | `localStorage` + URL | Lost on session discard |
| **Studies** | Not Participating Campus | `notPartCampus` (Campus \| ALL) | `sessionStorage` + URL | `localStorage` + URL | Lost on session discard |
| **Studies** | Not Participating Batch | `notPartBatch` (Batch \| ALL) | `sessionStorage` + URL | `localStorage` + URL | Lost on session discard |
| **Studies** | Not Participating Dept | `notPartDept` (string \| ALL) | `sessionStorage` + URL | `localStorage` + URL | Lost on session discard |
| **Studies** | Hide Members in Other Study | `notPartHideOther` (boolean) | `sessionStorage` (failing) | `localStorage` + URL | Wiped upon bare URL navigation; no URL resync |
| **Studies** | Not Participating Page | `notPartPage` (number) | `sessionStorage` + URL | `localStorage` + URL | Lost on session discard |
| **Sessions** | Session Search | `search` (string) | `sessionStorage` + URL | `localStorage` + URL | Lost on session discard |
| **Sessions** | Status Filter | `status` (string) | `sessionStorage` + URL | `localStorage` + URL | Lost on session discard |
| **Sessions** | Session Type Filter | `sessionType` (string) | `sessionStorage` + URL | `localStorage` + URL | Lost on session discard |
| **Sessions** | Study Filter | `studyId` (string) | `sessionStorage` + URL | `localStorage` + URL | Lost on session discard |
| **Sessions** | Sort By Select | `sortBy` (string) | `sessionStorage` + URL | `localStorage` + URL | Lost on session discard |
| **Sessions** | Sort Direction | `sortDir` (asc \| desc) | `sessionStorage` + URL | `localStorage` + URL | Lost on session discard |
| **Sessions** | Group by Study Toggle | `groupByStudy` (boolean) | `sessionStorage` + URL | `localStorage` + URL | Lost on session discard |
| **Members** | Member Search | `q` (string) | `sessionStorage` + URL | `localStorage` + URL | Lost on session discard |
| **Members** | Member Status Filter | `status` (ALL \| ACTIVE \| INACTIVE) | `sessionStorage` + URL | `localStorage` + URL | Lost on session discard |
| **Members** | Gender Filter | `gender` (ALL \| MALE \| FEMALE) | `sessionStorage` + URL | `localStorage` + URL | Lost on session discard |
| **Members** | Batch Filter | `batch` (Batch \| ALL) | `sessionStorage` + URL | `localStorage` + URL | Lost on session discard |
| **Members** | Sort By | `sortBy` (string) | `sessionStorage` + URL | `localStorage` + URL | Lost on session discard |
| **Members** | Pagination Page | `page` (number) | `sessionStorage` + URL | `localStorage` + URL | Lost on session discard |
| **Event Details** | Attendance Modal Tab | `attendanceModalTab` ("ATTENDEES" \| "ABSENTEES") | React `useState` | `localStorage` + URL | Lost on navigation |
| **Event Details** | Attendees Page | `attendancePage` (number) | React `useState` | `localStorage` + URL | Lost on navigation |
| **Event Details** | Attendees Sort By | `attendanceSortBy` ("time" \| "name") | React `useState` | `localStorage` + URL | Lost on navigation |
| **Event Details** | Attendees Sort Order | `attendanceOrder` ("asc" \| "desc") | React `useState` | `localStorage` + URL | Lost on navigation |
| **Event Details** | Show All Eligible Toggle | `showAllEligibleAbsentees` (boolean) | React `useState` | `localStorage` + URL | Lost on navigation |
| **Event Details** | Absentees Search | `absenteesSearch` (string) | React `useState` | `localStorage` + URL | Lost on navigation |
| **Take Attendance** | Mode Tab | `activeTab` ("QR" \| "MANUAL") | React `useState` | `localStorage` + URL | Lost on navigation |
| **Take Attendance** | Member Search | `searchQuery` (string) | React `useState` | `localStorage` + URL | Lost on navigation |
| **Take Attendance** | Manual Page | `manualPage` (number) | React `useState` | `localStorage` + URL | Lost on navigation |
| **Take Attendance** | Status Filter | `statusFilter` (string) | `sessionStorage` (legacy hook) | `localStorage` + URL | Lost on session discard |
| **Take Attendance** | Sort By | `sortBy` (string) | `sessionStorage` (legacy hook) | `localStorage` + URL | Lost on session discard |

---

### Item 3: Session Location Suggestions
- **File & Line Evidence:**
  - `frontend/src/pages/CreateEvent.tsx:174-175`:
    ```typescript
    if (!location || location.trim() === "") {
      setLocationError("Event location is required");
    }
    ```
  - `frontend/src/pages/EventDetailsPage.tsx:757-758`:
    ```typescript
    if (!editForm.location.trim())
      nextErrors.location = "Event location is required";
    ```
  - `frontend/src/components/sessions/SessionFormDrawer.tsx:368-377`: Plain `<input type="text">` without focus suggestions, combobox dropdown, or Amharic default presets.
- **Evaluation:** **FAIL**. Location must be optional (empty by default), accept free-text, show the 3 Amharic suggestions only on focus, collapse consecutive whitespace, and append unique session location history.

---

### Item 4: Mobile Optimization
- **File & Line Evidence:**
  - Inputs across drawers and forms use `text-sm` (14px). On iOS WebKit, focus on any `<input>` or `<select>` with font-size < 16px causes viewport zoom.
  - `frontend/index.html:1-13`: Lacks `<link rel="manifest" href="/manifest.webmanifest">` and `viewport-fit=cover`.
  - `frontend/src/pages/TakeAttendancePage.tsx`:
    - Lacks `navigator.wakeLock` request to keep the phone screen awake while scanning.
    - Lacks `navigator.vibrate` call upon successful attendance registration.
    - Lacks torch / flashlight control for low-light scanning.
    - Viewfinder aspect ratio is not optimized for vertical mobile portrait scanning.
  - Tables in `MembersPage.tsx` and `StudiesPage.tsx` do not collapse into responsive card layouts below 768px.
- **Evaluation:** **FAIL / PARTIAL**. Needs touch target sizing (>= 44px), 16px font size on inputs, mobile bottom sheet filters, Take Attendance enhancements, and responsive card layouts.

---

### Item 5: Grep Audit for `hymn`, `mezmur`, `liturg`
Ran full repository search for `hymn|mezmur|liturg` (case-insensitive).

#### A. Visible UI Titles, Subtitles & Navigation (Targeted for Simplification)
| File & Line | Current Text | Proposed Clean Text |
| :--- | :--- | :--- |
| `frontend/src/pages/StudiesPage.tsx:296` | `title="Liturgical Studies"` | `title="Studies"` |
| `frontend/src/pages/StudiesPage.tsx:297` | `subtitle="Church Hymn Department Attendance"` | *(Removed)* |
| `frontend/src/pages/StudiesPage.tsx:429` | `description="...and track liturgical progress."` | `description="...and track study progress."` |
| `frontend/src/pages/EventsPage.tsx:280-281` | `title="Sessions" subtitle="Liturgical Department Schedule & Attendance"` | `title="Sessions"` *(subtitle removed)* |
| `frontend/src/pages/Dashboard.tsx:58-59` | `title="Department Dashboard" subtitle="Hymn Department · Real-time..."` | `title="Dashboard"` *(subtitle removed)* |
| `frontend/src/pages/MembersPage.tsx:296-297` | `title="Members" subtitle="Cohort roster, academic standing, and contact registry"` | `title="Members"` *(subtitle removed)* |
| `frontend/src/components/layout/AppLayout.tsx:40,43` | `Liturgical Attendance` / `Church Hymn Department` | `Attendance System` / *(Clean brand title)* |
| `frontend/src/components/studies/StudyFormDrawer.tsx:157` | `"Define a liturgical program, course series, or seasonal cluster"` | `"Define a study program or course series"` |
| `frontend/src/components/studies/StudyFormDrawer.tsx:217` | `placeholder="e.g., Zema & Liturgical Rites"` | `placeholder="e.g., Summer Study Series"` |
| `frontend/src/components/sessions/SessionFormDrawer.tsx:211` | `"Schedule a standalone session or assign it to a liturgical study"` | `"Schedule a standalone session or assign it to a study"` |
| `frontend/src/components/sessions/SessionFormDrawer.tsx:338` | `placeholder="e.g., General Assembly / Hymn Workshop"` | `placeholder="e.g., General Session"` |
| `frontend/src/components/shared/NewSplitButton.tsx:97` | `Course or liturgical series` | `Course or study series` |

#### B. Internal Identifiers, Seeds & Tests (Retained Untouched as Instructed)
- `backend/src/utils/idGenerator.ts`: `generateMezmurId`, `getNextMezmurId`, prefix `MEZ-` (Must remain untouched to protect QR codes & member unique IDs).
- `backend/src/controllers/member.controller.ts:4,132`: Reference to `getNextMezmurId`.
- `backend/prisma/seed.dev.ts:233-449`: Development seed data titles.
- `backend/src/services/academic.service.test.ts:744,777,800`: Vitest fixture names.
- `backend/src/test/integration.test.ts:144`: Test session title.
- `README.md:14`: Project documentation.

---

### Item 6: Member Batch & Graduating Explanations
- **File & Line Evidence:**
  - `frontend/src/pages/StudiesPage.tsx:477`: Uses label `"Final Year (Graduating)"`.
  - `frontend/src/components/MemberForm.tsx:478`: Renders label `"Batch"` on registration rather than `"Current batch"`.
  - `frontend/src/components/MemberForm.tsx:503-520`: In edit mode, presents an editable batch select writing directly to `member.batch` rather than showing the computed batch with a dedicated override option.
- **Evaluation:** **FAIL / PARTIAL**. Requires removing all parenthetical/bracketed descriptions, setting registration batch label to "Current batch" (to derive `entryAcademicYear`), and displaying computed batch with an explicit override mechanism in edit mode.

---

### Item 7: Validation Rules Audit
- **File & Line Evidence:**
  - `backend/src/controllers/event.controller.ts:28-71`:
    - `endTime > startTime` is not verified in single event creation (`validateEventPayload`).
    - Lateness grace minutes upper bound (must be shorter than duration) is not checked.
    - 24-hour maximum duration safeguard is missing.
  - `backend/src/services/study.service.ts:188-202`:
    - `endDate >= startDate` is not validated.
    - Name uniqueness among active studies is not checked.
    - `audienceType === "BATCHES"` does not verify non-empty `audienceBatches`.
    - `requiredSessions >= 1` is not enforced.
  - `backend/src/controllers/member.controller.ts:27-85`:
    - Duplicate phone number is not checked in `createMember` (only email is checked).
    - Campus vs batch consistency (e.g. `YEAR_5` on 4-year campus) is not rejected.
  - `backend/src/controllers/attendance.controller.ts:74-105`:
    - Correctly enforces 403 on deactivated member, 400 on closed/cancelled event (unless admin override), and 409 on duplicate check-in.
- **Evaluation:** **FAIL / PARTIAL**. Several essential boundary validation checks are absent on backend and frontend.

---

### Item 8: Excel Exports
- **File & Line Evidence:**
  - `backend/src/controllers/event.controller.ts:1203-1237`: Session attendance export uses `new Date().toLocaleString(undefined)` instead of Africa/Addis_Ababa timezone.
  - `backend/src/services/study.service.ts:751,940`: Study grid and Not-Participating exports lack `sheet.views = [{ state: "frozen", ySplit: 1 }]`.
  - Phone number columns in all exports are assigned standard string values without explicit text cell formatting (`numFmt: '@'`), leading to potential zero-truncation in Excel.
  - Route `GET /events/:id/absentees/export/excel` is completely missing.
- **Evaluation:** **FAIL / PARTIAL**. Requires header freezing, text phone formatting, Addis timezone formatting, absentees export endpoint, and automated round-trip ExcelJS tests.

---

### Item 9: Overnight Sessions Spanning Two Days
- **File & Line Evidence:**
  - `backend/prisma/schema.prisma:117-118`: `startTime DateTime`, `endTime DateTime`. The database already supports full timestamps. No schema migration is required.
  - `frontend/src/components/sessions/SessionFormDrawer.tsx:480-520`: The UI only provides a single `startDate` input plus `startTime` and `endTime` time pickers. No `endDate` picker is shown when `sessionType === "OVERNIGHT"`.
  - `backend/src/services/recurrence.service.ts:70-71`:
    ```typescript
    const week1Start = setTimeOnDate(week1Date, input.startTime);
    const week1End = setTimeOnDate(week1Date, input.endTime);
    ```
    Forces `week1End` to the same calendar date as `week1Start`. For an overnight session starting at 22:00 and ending at 06:00, `endTime` becomes 16 hours in the past!
  - `backend/src/services/event-lifecycle.service.ts:97-102`: Active window calculation uses `endTime`. If `endTime` is corrupted to the same day, the session auto-closes prematurely.
- **Evaluation:** **FAIL / PARTIAL**. Requires end DATE input in frontend, duration preservation across weekly occurrences, and lifecycle test coverage.

---

## 3. Plan for Phase 2 Implementation
1. **Item 1:** Implement `{ month: 9, day: 11 }` Addis rollover, startup sync job, cron synchronization, and tests.
2. **Item 2:** Refactor `usePersistedViewState` to `localStorage` + URL search params, add "Reset filters" buttons, wire up all inventory controls, and clear on logout.
3. **Item 3:** Add optional session location combobox with 3 Amharic presets, session history, and whitespace collapsing.
4. **Item 4:** Mobile viewport optimization (320px–768px), touch targets >= 44px, 16px input font size, bottom sheet filters, responsive cards, PWA manifest, and Take Attendance upgrades (Wake Lock, vibration, torch).
5. **Item 5:** Clean visible page headers/subtitles/tab titles across all pages.
6. **Item 6:** Remove batch/graduating descriptions, label registration as "Current batch", and show computed batch with override in edit mode.
7. **Item 7:** Enforce comprehensive backend and frontend validation rules with boundary tests.
8. **Item 8:** Add absentees Excel export, freeze header rows, format phones as text, enforce Addis timezone, and write round-trip ExcelJS test suite.
9. **Item 9:** Support overnight session end dates, duration preservation in recurrence, and fake clock lifecycle tests.
