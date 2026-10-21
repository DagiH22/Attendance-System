# V2 Pre-Implementation and Post-Implementation Audit Report (`docs/V2_AUDIT.md`)

**Date:** 2026-10-21 / 2026-10-22  
**Branch:** `fix/v2-checks-and-mobile`  
**Base Commit:** `99d612f` (Merge branch 'master' into v2)  
**Final Commit:** `dd149f8` (Item 9 completed)

---

## 1. Executive Summary & Audit Matrix

| Item # | Area / Feature | Phase 1 Baseline Status | Phase 2 Implementation Status | Primary Finding, Solution & Evidence |
| :--- | :--- | :---: | :---: | :--- |
| **Item 1** | Automatic yearly batch upgrade on Sept 11 | **FAIL / PARTIAL** | **PASS** | `academic.config.ts` configured with `{ month: 9, day: 11 }` evaluated in `Africa/Addis_Ababa`. Single source of truth in `computeBatch`. Daily 00:05 Addis cron job + server startup catch-up sync (`syncMemberBatches`). Direct `member.batch` reads in controllers/views updated to computed batch. Verified by 45 unit tests in `backend/src/services/academic.service.test.ts`. |
| **Item 2** | UI state preservation & reset filters | **FAIL / PARTIAL** | **PASS** | Upgraded `usePersistedViewState` hook to sync between URL search parameters and `localStorage` (resilient to mobile tab discards). Navigation links in `AppLayout` preserve view states. Reset Filters buttons added to Sessions, Studies, Members, Take Attendance, and Event Details. All persisted keys cleared on user logout. Verified by 6 tests in `frontend/src/hooks/usePersistedViewState.test.ts`. |
| **Item 3** | Session location suggestions & presets | **FAIL** | **PASS** | Location is now completely optional on backend and frontend (empty string permitted). Created reusable `LocationCombobox` with 3 Amharic default presets (`"ማዕከል 4ኛ ፎቅ"`, `"ማዕከል አዲሱ ህንጻ 4ኛ ፎቅ"`, `"ማዕከል 3ኛ ፎቅ"`), dynamic past location suggestions by usage frequency, and Amharic whitespace collapsing (`replace(/\s+/g, ' ')`). Tested in `backend/src/config/location.config.test.ts` and `frontend/src/components/shared/LocationCombobox.test.ts`. |
| **Item 4** | Mobile optimization & scanner | **FAIL / PARTIAL** | **PASS** | Viewports 320px, 360px, 390px, 412px, 768px audited. Added `public/manifest.webmanifest`, bottom tab bar on mobile, full-screen drawers on mobile viewports, mobile filter bottom sheet modal, responsive cards for members and sessions, responsive study grid with sticky first column. Enhanced `QrAttendanceScanner` with vertical viewfinder, torch toggle, haptic vibration feedback, Screen Wake Lock API, and lazy-loaded dynamic import chunk (342 kB split). 22 audit screenshots captured in `docs/mobile-screenshots/`. |
| **Item 5** | Clean page titles (only page name) | **FAIL** | **PASS** | Simplified all visible page titles to strictly the page name ("Dashboard", "Studies", "Sessions", "Members"). Removed descriptive taglines and liturgical/hymn branding from UI titles. Application brand header simplified to "Attendance System". Critical internal identifiers (`MEZ-` prefix in `idGenerator.ts`, QR code payloads, email templates) strictly preserved. |
| **Item 6** | Remove batch/graduating descriptions | **FAIL / PARTIAL** | **PASS** | Removed bracketed explanations like `(5-yr campus)` and `(Graduating)` across all UI dropdowns and tables. Registration form labels batch as "Current batch" and computes `entryAcademicYear`. Edit member drawer displays dynamically computed batch with an explicit manual override toggle. Direct batch reads in `Dashboard.tsx` and `member.controller.ts` updated to computed batch. |
| **Item 7** | Validation rules (Backend & Frontend) | **FAIL / PARTIAL** | **PASS** | Authoritative backend validation returning structured 400s paired with frontend inline error messages. Session constraints: duration <= 24h, `endTime > startTime`, lateness grace <= duration, recurrence length 1–52 weeks. Study constraints: unique active name (case-insensitive), `endDate >= startDate`, `requiredSessions >= 1`, non-empty `audienceBatches`. Member constraints: Ethiopian phone regex `/^(\+251[79]\d{8}|0[79]\d{8})$/`, duplicate email and phone 409 rejection, campus vs batch curriculum bound. Attendance: deactivated member 403, cancelled event 400. Automated test suite in `backend/src/test/validation-rules.test.ts` (31 tests passing). |
| **Item 8** | Excel exports (old and new data) | **FAIL / PARTIAL** | **PASS** | Added missing session absentees export (`GET /events/:id/absentees/export`). Enhanced all 5 Excel export endpoints: explicit text formatting (`numFmt: "@"`) to preserve Ethiopian leading zeroes (`09...`, `07...`), Addis timezone dates/times (`Africa/Addis_Ababa`), frozen header rows (`views = [{ state: "frozen", ySplit: 1 }]`), consistent headers ("Attended Sessions", "Session 1: ..."), and exclusion of soft-removed marks (`removedAt === null`). Automated test suite in `backend/src/test/excel-exports.test.ts` (5 tests passing with round-trip ExcelJS inspection). |
| **Item 9** | Overnight sessions (spanning 2 days) | **FAIL / PARTIAL** | **PASS** | Full `DateTime` timestamp support verified. Added `endDate` picker to `SessionFormDrawer.tsx` when `sessionType === "OVERNIGHT"` with cross-midnight duration calculation and visual indicator (`🌙 Spans across midnight`). Updated `EventDetailsPage.tsx` to display cross-midnight date and time ranges (`formatDate(start) → formatDate(end)`). Fixed `recurrence.service.ts` to preserve duration across weekly occurrences (`end = start + parentDurationMs`). Updated `event-lifecycle.service.ts` sweep to evaluate past overnight sessions. Automated test suite in `backend/src/test/overnight-sessions.test.ts` (5 tests passing: active window across midnight, check-in without override, 4-week recurrence duration preservation, month-end and year-end boundary crossings, and rescheduling). |

---

## 2. Deep Dive Implementation & Evidence by Item

### Item 1: Automatic Yearly Batch Upgrade on Sept 11
- **Files Modified / Added:**
  - `backend/src/config/academic.config.ts`: Added `ACADEMIC_YEAR_ROLLOVER = { month: 9, day: 11 }` and `TIMEZONE_ADDIS = "Africa/Addis_Ababa"`.
  - `backend/src/services/academic.service.ts`: Implemented `getAcademicYearAddis(date)` using `Intl.DateTimeFormat` in `Africa/Addis_Ababa` timezone. Replaced server-local date math. Single source of truth `computeBatch(entryAcademicYear, campus, referenceDate)`. Implemented `syncMemberBatches(prisma, now)` idempotent synchronization job.
  - `backend/src/index.ts`: Added startup catch-up execution of `syncMemberBatches` and recurring cron schedule running daily at 00:05 Addis time (`cron.schedule("5 0 * * *", ...)` with timezone `Africa/Addis_Ababa`).
  - `backend/src/controllers/member.controller.ts:780`: Updated `sendMemberEmail` payload to use `computedBatch`.
  - `frontend/src/pages/Dashboard.tsx:400`: Updated table and badge renderers to use computed batch.
- **Automated Verification:**
  - `backend/src/services/academic.service.test.ts`: 45 tests passing.
  - Tests verify Sept 1–10 evaluates to previous academic year, Sept 11 midnight evaluates to new academic year, multi-year progression for 4-year and 5-year campuses, and idempotent DB synchronization with logging.

---

### Item 2: UI State Preservation & Control Inventory
- **Files Modified / Added:**
  - `frontend/src/hooks/usePersistedViewState.ts`: Refactored to synchronize state bidirectionally between `localStorage` and URL search parameters. Handles JSON-serialized complex filter objects, numbers, and strings with debouncing.
  - `frontend/src/components/layout/AppLayout.tsx`: In `handleLogout`, actively flushes all view state keys (`attendance_view_*`) from `localStorage`.
  - `frontend/src/pages/EventsPage.tsx`: Added "Reset filters" button, wired all filter and sort controls to persisted view state.
  - `frontend/src/pages/StudiesPage.tsx`: Added "Reset filters" button, wired study selector, search, campus, batch, department filters, and "Hide members in another study" toggle.
  - `frontend/src/pages/MembersPage.tsx`: Added "Reset filters" button, wired search, status, gender, batch, sort by, and page.
  - `frontend/src/pages/EventDetailsPage.tsx`: Wired absentees search, tabs, pagination, and "Show all eligible members" toggle.
  - `frontend/src/pages/TakeAttendancePage.tsx`: Wired mode tab (QR vs Manual), manual search query, status filter, and pagination.
- **Automated Verification:**
  - `frontend/src/hooks/usePersistedViewState.test.ts`: 6 tests passing (URL initialization, localStorage fallback, updates, defaults reset, and cleanup).

---

### Item 3: Session Location Suggestions & Presets
- **Files Modified / Added:**
  - `backend/src/config/location.config.ts`: Defined `DEFAULT_LOCATION_PRESETS = ["ማዕከል 4ኛ ፎቅ", "ማዕከል አዲሱ ህንጻ 4ኛ ፎቅ", "ማዕከል 3ኛ ፎቅ"]` and helper `normalizeAmharicWhitespace(input)`.
  - `backend/src/controllers/event.controller.ts`: Added `GET /events/locations/suggestions` endpoint returning default presets combined with distinct past session locations ordered by usage frequency. Made `location` optional in `validateEventPayload`.
  - `frontend/src/components/shared/LocationCombobox.tsx`: Reusable combobox component with Amharic presets, focus-triggered dropdown, free-text input, and keyboard navigation.
  - `frontend/src/components/sessions/SessionFormDrawer.tsx`: Replaced text input with `LocationCombobox`. Location made optional.
  - `frontend/src/pages/EventDetailsPage.tsx`: Replaced edit modal text input with `LocationCombobox`. Removed required error constraint.
- **Automated Verification:**
  - `backend/src/config/location.config.test.ts`: 4 tests passing (presets validation and whitespace normalization).
  - `frontend/src/components/shared/LocationCombobox.test.ts`: 3 tests passing (preset rendering, free-text entry, and selection).

---

### Item 4: Mobile Viewport Optimization & Scanner
- **Files Modified / Added:**
  - `frontend/public/manifest.webmanifest`: Added PWA web app manifest with standalone display mode, theme colors, and icons.
  - `frontend/index.html`: Added `<link rel="manifest">` and `viewport-fit=cover` meta tags.
  - `frontend/src/components/layout/AppLayout.tsx`: Implemented mobile-only bottom navigation tab bar (Dashboard, Studies, Sessions, Members) with active route indicators and minimum 48px touch targets.
  - `frontend/src/components/layout/FilterBottomSheet.tsx`: Reusable mobile slide-up sheet modal for filtering and sorting on viewports < 768px.
  - `frontend/src/components/sessions/SessionFormDrawer.tsx` & `StudyFormDrawer.tsx`: Full-screen mobile layout (`w-full sm:max-w-xl`), safe area padding, sticky action footers.
  - `frontend/src/components/qr/QrAttendanceScanner.tsx`: Portrait 3:4 viewfinder, torch/flashlight toggle, Screen Wake Lock API integration (`navigator.wakeLock`), haptic feedback (`navigator.vibrate([100])`), rapid re-scan with cooldown.
  - `frontend/src/pages/TakeAttendancePage.tsx`: Lazy-loaded scanner component with React `Suspense` creating an isolated 342 kB bundle chunk.
  - `frontend/src/pages/StudiesPage.tsx`: Responsive study grid with sticky first column (member name/ID) for horizontal scrolling on narrow screens.
  - `frontend/src/pages/MembersPage.tsx` & `EventsPage.tsx`: Added responsive mobile card list views toggled below 768px.
- **Visual Artifacts:**
  - 22 screenshots captured across viewports 320px, 360px, 390px, 412px, and 768px stored in `docs/mobile-screenshots/`.

---

### Item 5: Clean Page Titles (Only Page Name)
- **Files Modified:**
  - `frontend/src/pages/Dashboard.tsx`: Header title changed to `"Dashboard"`, tagline removed.
  - `frontend/src/pages/StudiesPage.tsx`: Header title changed to `"Studies"`, tagline removed.
  - `frontend/src/pages/EventsPage.tsx`: Header title changed to `"Sessions"`, tagline removed.
  - `frontend/src/pages/MembersPage.tsx`: Header title changed to `"Members"`, tagline removed.
  - `frontend/src/components/layout/AppLayout.tsx`: Top bar title simplified to `"Attendance System"`.
  - `frontend/src/components/studies/StudyFormDrawer.tsx` & `SessionFormDrawer.tsx`: Descriptions cleaned of "hymn/liturgical" phrasing.
  - Preserved internal identifiers: `MEZ-` ID prefix in `idGenerator.ts`, QR code payload format (`MEZ-xxxx`), and email templates untouched.

---

### Item 6: Member Batch & Graduating Explanations
- **Files Modified:**
  - `frontend/src/pages/StudiesPage.tsx`: Removed `(Graduating)` label; displays clean batch names (`Year 4`, `Year 5`, etc.).
  - `frontend/src/components/MemberForm.tsx`: Labeled registration field as `"Current batch"`. In edit mode, displays computed batch with an explicit manual override toggle.
  - `backend/src/controllers/member.controller.ts`: Ensured `computeBatch` is called to return dynamic batch for member listings and details.
  - `frontend/src/pages/Dashboard.tsx`: Displays dynamically computed batch.

---

### Item 7: Validation Rules (Backend & Frontend)
- **Files Modified:**
  - `backend/src/controllers/event.controller.ts`:
    - Enforced `endTime > startTime`.
    - Enforced maximum session duration <= 24 hours.
    - Enforced lateness grace period <= session duration.
    - Enforced weekly recurrence length 1–52 weeks.
    - Disallowed marking attendance on cancelled sessions.
  - `backend/src/services/study.service.ts`:
    - Enforced case-insensitive name uniqueness among active studies (`deletedAt: null`).
    - Enforced `endDate >= startDate`.
    - Enforced `requiredSessions >= 1`.
    - Enforced non-empty `audienceBatches` when `audienceType === "BATCHES"`.
  - `backend/src/controllers/member.controller.ts`:
    - Enforced Ethiopian phone number format: `/^(\+251[79]\d{8}|0[79]\d{8})$/`.
    - Enforced duplicate email and duplicate phone rejections (HTTP 409 Conflict).
    - Enforced campus vs curriculum year bound (e.g. `YEAR_5` rejected on 4-year campus).
  - `backend/src/controllers/attendance.controller.ts`:
    - Enforced 403 Forbidden when attempting to record attendance for deactivated members (`status === "INACTIVE"`).
  - Frontend forms updated with inline validation messages matching backend rules.
- **Automated Verification:**
  - `backend/src/test/validation-rules.test.ts`: 31 tests passing across session, study, member, and attendance boundaries.

---

### Item 8: Excel Exports Round-Trip
- **Files Modified / Added:**
  - `backend/src/controllers/event.controller.ts`: Added `GET /events/:id/absentees/export` endpoint. Updated `exportEventAttendanceToExcel` to format dates/times in `Africa/Addis_Ababa`, format phone columns with `numFmt = "@"`, and freeze header rows.
  - `backend/src/controllers/member.controller.ts`: Updated `exportMembersToExcel` to format phone columns with `numFmt = "@"`, freeze header row (`views = [{ state: "frozen", ySplit: 1 }]`), and include computed batch and attendance counts.
  - `backend/src/services/study.service.ts`: Updated `exportStudyGridToExcel` and `exportNotParticipatingToExcel` with frozen headers, text phone formatting, consistent header titles ("Attended Sessions", "Session 1: ..."), and exclusion of soft-removed marks.
- **Automated Verification:**
  - `backend/src/test/excel-exports.test.ts`: 5 tests passing with round-trip ExcelJS inspection:
    1. Members export (frozen row, text phone with leading zero preserved, Addis timestamps).
    2. Session attendance export (frozen row, text phone, status column, Addis timestamps).
    3. Session absentees export (frozen row, text phone, eligible absentees list).
    4. Study grid export (frozen row, text phone, session columns, soft-removed exclusions).
    5. Not-participating export (frozen row, text phone, attendance summary).

---

### Item 9: Overnight Sessions Spanning Two Days
- **Files Modified / Added:**
  - `backend/src/services/recurrence.service.ts`: Preserved parent duration in `updateWeeklyEvents` using `parentDurationMs = parent.endTime.getTime() - parent.startTime.getTime()` and setting `end = new Date(start.getTime() + parentDurationMs)`.
  - `backend/src/services/event-lifecycle.service.ts`: Updated `runEventLifecycleSweep` candidate sweep filter to `{ endTime: { lte: upperBound } }`, ensuring active overnight sessions crossing midnight are evaluated and auto-closed accurately.
  - `frontend/src/components/sessions/SessionFormDrawer.tsx`: Added `endDate` date picker when `sessionType === "OVERNIGHT"` defaulting to next day; live duration preview banner highlighting midnight crossing (`🌙 Spans across midnight`).
  - `frontend/src/pages/EventDetailsPage.tsx`: Date and time info rows format cross-midnight spans (`formatDate(start) → formatDate(end)` and `formatTime(start) → formatTime(end) (Next day)`).
- **Automated Verification:**
  - `backend/src/test/overnight-sessions.test.ts`: 5 tests passing:
    1. Active window evaluation across midnight (active at 01:00 and 02:00, closed at 07:30 after 06:00 end).
    2. Check-in allowed during 02:00 next-day overnight window without admin override.
    3. Weekly recurrence preserves 8-hour overnight duration across all 4 generated occurrences.
    4. Boundary crossings: New Year's Eve (Dec 31 -> Jan 1) and Leap Year month-end (Feb 28 -> Mar 1).
    5. Rescheduling updates both start and end timestamps while preserving overnight duration.

---

## 3. Comprehensive Verification Summary

### Backend Test Suite (Vitest)
```
Test Files  6 passed (6)
Tests       109 passed (109)
Duration    ~8.8s
```
- `backend/src/services/academic.service.test.ts`: 45 tests passed.
- `backend/src/test/validation-rules.test.ts`: 31 tests passed.
- `backend/src/test/integration.test.ts`: 19 tests passed.
- `backend/src/test/overnight-sessions.test.ts`: 5 tests passed.
- `backend/src/test/excel-exports.test.ts`: 5 tests passed.
- `backend/src/config/location.config.test.ts`: 4 tests passed.

### Frontend Test Suite (Vitest)
```
Test Files  4 passed (4)
Tests       16 passed (16)
Duration    ~556ms
```
- `frontend/src/hooks/usePersistedViewState.test.ts`: 6 tests passed.
- `frontend/src/lib/sessionComparator.test.ts`: 4 tests passed.
- `frontend/src/components/shared/LocationCombobox.test.ts`: 3 tests passed.
- `frontend/src/lib/clipboard.test.ts`: 3 tests passed.

### Production Builds
- Backend (`tsc`): 0 compile errors.
- Frontend (`tsc -b && vite build`): 0 compile errors, clean production bundle with lazy-loaded scanner chunk (`342 kB`).

---

## 4. Git Commit History on `fix/v2-checks-and-mobile`

| Commit Hash | Item | Description |
| :--- | :---: | :--- |
| `55857c5` | Audit | docs(audit): comprehensive Phase 1 audit for items 1-9 |
| `024cb51` | Item 1 | feat(academic): automatic yearly batch upgrade on Sept 11 in Africa/Addis_Ababa timezone with sync job |
| `14fb355` | Item 2 | feat(ui): localStorage and URL state preservation with reset filters across all pages |
| `827d791` | Item 3 | feat(location): optional session location with Amharic presets and click suggestions combobox |
| `37cd831` | Item 4 | feat(mobile): mobile viewport optimizations, bottom tab bar, card lists, scanner enhancements, and screenshots |
| `202a757` | Item 5 | fix(ui): simplify page titles to only page name and remove taglines |
| `2a694c9` | Item 6 | fix(members): remove batch and graduating explanations, show computed batch and manual override |
| `871801d` | Item 7 | fix(validation): enforce robust session, study, member, and attendance validation rules |
| `341a11e` | Item 8 | fix(export): enhance Excel exports with text phone numbers, Addis timezone, and round-trip assertions |
| `dd149f8` | Item 9 | feat(sessions): support overnight sessions spanning two days with duration preservation and updated lifecycle |
