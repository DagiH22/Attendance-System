# 🚀 Production Migration Runbook: v1 to v2 Cutover

This runbook documents the step-by-step procedures for migrating the **Campus Smart Attendance System** database from **v1** to **v2**.

---

## 1. Architecture: Expand/Contract Strategy

To ensure zero risk of downtime or broken states:
- **Additive Only:** All schema modifications in v2 are purely additive (new tables, nullable or defaulted columns, new enum types).
- **No Destructive Operations:** Zero column drops, renames, or type alterations.
- **Backwards Compatibility:** Legacy tables (`event_clusters`) and columns (`Event.clusterId`, `Event.clusterLabel`) are preserved and marked deprecated.
- **Dual-Version Compatibility:** v1 code continues to execute cleanly against the migrated database schema during cutover.

### ⚠️ Known Rollback Caveat
v2 introduces:
1. **Soft-deletion of attendance:** (`attendances.removedAt`, `attendances.removeReason`, `attendances.removedById`)
2. **New attendance statuses:** (`status` enum values `LATE`, `EXCUSED`, in addition to `PRESENT`)

> **Rollback Impact:** If the system is rolled back to **v1** *after* v2 has been active in production:
> - v1 does not filter by `removedAt IS NULL`, meaning soft-removed attendance marks would be counted by v1 as attended.
> - v1 does not understand `LATE` or `EXCUSED` statuses and treats all attendance rows as standard attendance.
> 
> **Rollback Remediation:** In the event of a rollback after v2 writes have occurred, either:
> 1. Restore from the pre-cutover `pg_dump` backup taken immediately before the maintenance window, OR
> 2. Execute the post-v2 cleanup query to permanently purge soft-deleted marks:
>    ```sql
>    DELETE FROM attendances WHERE "removedAt" IS NOT NULL;
>    ```

---

## 2. Pre-Maintenance Preparation (Rehearsal)

Prior to the maintenance window, rehearse the migration on a copy of production data:

### Step 2.1: Take and Verify Production Backup
```bash
# Take binary or SQL dump from production database
pg_dump "$PROD_DATABASE_URL" -Fc -f prod_backup_$(date +%Y%m%d_%H%M%S).dump

# Verify backup file size and integrity
pg_restore --list prod_backup_*.dump > /dev/null
echo "Backup verified successfully."
```

### Step 2.2: Rehearse on Staging / Throwaway Database
Never run rehearsal against production. Set `DATABASE_URL` in `.env.local` to a local throwaway database:
```bash
cd backend

# Run automated rehearsal script with dump restore
npm run rehearse:migration -- --dump=path/to/prod_backup.sql
```
The script will automatically:
1. Verify connection is safe (aborts if not localhost/throwaway via `guard-db`).
2. Capture pre-migration row counts (`members`, `events`, `attendances`, `admins`, `event_clusters`).
3. Deploy Prisma migrations (`npm run prisma:safe migrate deploy`).
4. Execute backfill in `--dry-run` mode and report any anomalous rows.
5. Apply backfill (`npm run backfill -- --apply`).
6. Compare pre- and post-migration row counts to verify zero data loss.
7. Print a **GO / NO-GO** recommendation.

---

## 3. Maintenance Window Cutover (Live Execution)

### Step 3.1: Freeze Writes (Read-Only Mode)
1. Notify administrators that a 15-minute maintenance window is active.
2. Put the v1 frontend/backend in maintenance mode or stop incoming writes.

### Step 3.2: Take Final Pre-Cutover Backup
```bash
pg_dump "$PROD_DATABASE_URL" -Fc -f final_pre_cutover_$(date +%Y%m%d_%H%M%S).dump
```

### Step 3.3: Deploy Schema Migrations
```bash
cd backend
npm run prisma:safe migrate deploy
```
*Review output to verify migration `20261020000000_v2_studies_and_lateness` applied cleanly.*

### Step 3.4: Execute Data Backfill
1. **Dry-Run Validation:**
   ```bash
   npm run backfill -- --dry-run
   ```
   Inspect report:
   - Review any reported inconsistent members (e.g., `YEAR_5` on 4-year campus).
   - Verify expected counts for studies to create and events to link.

2. **Apply Backfill:**
   ```bash
   npm run backfill -- --apply
   ```
   Verify output:
   - `EventCluster` records converted to `Study` entities.
   - `events.studyId` linked.
   - `events.plannedStartTime` populated from `events.startTime`.
   - `members.entryAcademicYear` derived and backfilled.

### Step 3.5: Deploy v2 Applications
1. Deploy v2 backend server.
2. Deploy v2 frontend client.
3. Verify environment variables (`DATABASE_URL`, `JWT_SECRET`, `CLIENT_URL`).

---

## 4. Post-Deployment Smoke Verification Checklist

Immediately test the following workflows on production:
- [ ] **Admin Login:** Log in as Admin and Super Admin.
- [ ] **Dashboard:** Verify metrics, top attendees, and study cards render without errors.
- [ ] **Sessions List & Grouping:**
  - Verify `/sessions` displays sessions grouped by study.
  - Verify empty studies display with "No sessions yet" and an "Add session" button.
- [ ] **QR Code Scanning (CRITICAL):**
  - Scan a member QR code generated during v1 (payload format `attendance:<uniqueId>`).
  - Verify check-in is recorded as `PRESENT`.
- [ ] **Manual Attendance & Excuse Flow:**
  - Mark an absentee member as `EXCUSED` with reason.
  - Verify undo / soft-remove marks attendance as removed.
- [ ] **Excel Export:**
  - Export attendance and verify column headers say "Session" instead of "Event".

---

## 5. Rollback Procedure

If a critical issue occurs during the maintenance window:

### Scenario A: Rollback BEFORE v2 has accepted live traffic
1. Redeploy v1 tag (`git checkout release/v1`).
2. Schema changes in the database are purely additive and require no database rollback.
3. Confirm v1 runs cleanly against the migrated database.

### Scenario B: Rollback AFTER v2 has accepted live traffic
1. Put system in maintenance mode.
2. Redeploy v1 tag (`git checkout release/v1`).
3. If attendance was marked with new statuses or soft-deleted:
   - Either restore database from `final_pre_cutover_*.dump`, OR
   - Run data normalization:
     ```sql
     DELETE FROM attendances WHERE "removedAt" IS NOT NULL;
     ```
4. Verify v1 works and lift maintenance mode.

---

## 6. Go / No-Go Checklist

| Check | Requirement | Verified By | Status |
| :--- | :--- | :--- | :--- |
| **1** | Production backup taken and size verified | Admin | ⬜ |
| **2** | Migration rehearsed on staging/throwaway copy | Dev Team | ⬜ |
| **3** | Rehearsal integrity check passed (zero row drop) | Automated Script | ⬜ |
| **4** | Backfill dry-run reviewed and approved | Admin | ⬜ |
| **5** | v1 rollback plan and image tagged | Dev Team | ⬜ |
| **6** | Maintenance window announced to users | Admin | ⬜ |
| **7** | Post-deploy smoke test of legacy QR codes passed | QA / Admin | ⬜ |
