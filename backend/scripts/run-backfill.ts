import path from "path";
import dotenv from "dotenv";
import fs from "fs";

// Enforce guard before connecting
const envLocal = path.resolve(__dirname, "../.env.local");
const envV2Dev = path.resolve(__dirname, "../.env.v2.dev");
const envDefault = path.resolve(__dirname, "../.env");

if (fs.existsSync(envLocal)) {
  dotenv.config({ path: envLocal, override: true });
} else if (fs.existsSync(envV2Dev)) {
  dotenv.config({ path: envV2Dev, override: true });
} else if (fs.existsSync(envDefault)) {
  dotenv.config({ path: envDefault, override: true });
}

require("./guard-db.js");

import { PrismaClient, Campus, Batch } from "@prisma/client";
import { CAMPUS_PROGRAM_YEARS, BATCH_TO_LEVEL } from "../src/config/academic.config";
import { deriveEntryAcademicYearForBackfill } from "../src/services/academic.service";

const prisma = new PrismaClient();

interface ReviewRow {
  type: string;
  id: string;
  identifier: string;
  issue: string;
  details: string;
}

async function main() {
  const isDryRun = process.argv.includes("--dry-run") || !process.argv.includes("--apply");
  const asOfDate = new Date();

  console.log(`\n========================================================`);
  console.log(` 🔄 DATABASE BACKFILL & MIGRATION SCRIPT`);
  console.log(` Mode: ${isDryRun ? "🔍 DRY-RUN (No data will be changed)" : "🚀 APPLY (Changes WILL be committed)"}`);
  console.log(` As Of Date: ${asOfDate.toISOString()}`);
  console.log(`========================================================\n`);

  const reviewList: ReviewRow[] = [];

  // --- 1. Member Analysis & Backfill ---
  const members = await prisma.member.findMany();
  let membersToBackfill = 0;
  let membersAlreadyBackfilled = 0;

  for (const member of members) {
    const analysis = deriveEntryAcademicYearForBackfill(member, asOfDate);
    const maxYears = CAMPUS_PROGRAM_YEARS[member.campus] ?? 4;
    const memberLevel = BATCH_TO_LEVEL[member.batch];

    if (member.batch === Batch.YEAR_5 && maxYears < 5) {
      reviewList.push({
        type: "MEMBER_CAMPUS_MISMATCH",
        id: member.id,
        identifier: `${member.name} (${member.uniqueId})`,
        issue: `YEAR_5 batch on a ${maxYears}-year campus (${member.campus})`,
        details: `Derived entryAcademicYear=${analysis.entryAcademicYear}`,
      });
    }

    if (analysis.isInconsistent) {
      reviewList.push({
        type: "MEMBER_INCONSISTENT_BATCH",
        id: member.id,
        identifier: `${member.name} (${member.uniqueId})`,
        issue: analysis.inconsistencyReason || "Batch inconsistent with academic progression",
        details: `Campus=${member.campus}, Batch=${member.batch}, EntryYear=${analysis.entryAcademicYear}`,
      });
    }

    if (member.entryAcademicYear === null || member.entryAcademicYear === undefined) {
      membersToBackfill++;
      if (!isDryRun) {
        await prisma.member.update({
          where: { id: member.id },
          data: { entryAcademicYear: analysis.entryAcademicYear },
        });
      }
    } else {
      membersAlreadyBackfilled++;
    }
  }

  // --- 2. EventCluster -> Study Migration ---
  const clusters = await prisma.eventCluster.findMany();
  let studiesToCreate = 0;
  let studiesAlreadyExist = 0;
  let eventsToLink = 0;

  for (const cluster of clusters) {
    const existing = await prisma.study.findUnique({ where: { id: cluster.id } });
    if (!existing) {
      studiesToCreate++;
      if (!isDryRun) {
        await prisma.study.create({
          data: {
            id: cluster.id,
            name: cluster.title,
            description: cluster.description,
            startDate: cluster.startDate,
            endDate: cluster.endDate,
            audienceType: "ALL",
            audienceBatches: [],
            defaultLateGraceMinutes: 15,
            isActive: true,
          },
        });
      }
    } else {
      studiesAlreadyExist++;
    }

    const unlinkedEvents = await prisma.event.findMany({
      where: { clusterId: cluster.id, studyId: null },
      select: { id: true },
    });

    eventsToLink += unlinkedEvents.length;

    if (!isDryRun && unlinkedEvents.length > 0) {
      await prisma.event.updateMany({
        where: { clusterId: cluster.id, studyId: null },
        data: { studyId: cluster.id },
      });
    }
  }

  // --- 3. Event plannedStartTime Backfill ---
  const eventsMissingPlannedStart = await prisma.event.findMany({
    where: { plannedStartTime: null },
    select: { id: true, startTime: true },
  });

  const eventsToBackfillPlannedStart = eventsMissingPlannedStart.length;
  if (!isDryRun && eventsToBackfillPlannedStart > 0) {
    for (const ev of eventsMissingPlannedStart) {
      await prisma.event.update({
        where: { id: ev.id },
        data: { plannedStartTime: ev.startTime },
      });
    }
  }

  // --- Summary Report ---
  console.log(`\n========================================================`);
  console.log(` 📊 BACKFILL EXECUTION REPORT`);
  console.log(`========================================================`);
  console.log(`Members:`);
  console.log(`  Total members checked:              ${members.length}`);
  console.log(`  Already had entryAcademicYear:      ${membersAlreadyBackfilled}`);
  console.log(`  ${isDryRun ? "Eligible to backfill" : "Successfully backfilled"}:          ${membersToBackfill}`);
  console.log(`\nStudies & Clusters:`);
  console.log(`  Total EventCluster rows found:      ${clusters.length}`);
  console.log(`  Already migrated to Study:          ${studiesAlreadyExist}`);
  console.log(`  ${isDryRun ? "Studies to create" : "Studies created"}:               ${studiesToCreate}`);
  console.log(`  ${isDryRun ? "Events to link to study" : "Events linked to study"}:         ${eventsToLink}`);
  console.log(`\nSessions & Events:`);
  console.log(`  ${isDryRun ? "Events needing plannedStartTime" : "Events plannedStartTime backfilled"}: ${eventsToBackfillPlannedStart}`);
  console.log(`========================================================\n`);

  if (reviewList.length > 0) {
    console.warn(`⚠️  ROWS NEEDING MANUAL REVIEW (${reviewList.length} total):`);
    console.table(reviewList);
  } else {
    console.log(`✅ No anomalies or inconsistent records found needing manual review.`);
  }

  if (isDryRun) {
    console.log(`\n💡 To apply these changes to the target database, run:`);
    console.log(`   npm run backfill -- --apply\n`);
  } else {
    console.log(`\n🎉 Backfill successfully applied to database.\n`);
  }
}

main()
  .catch((e) => {
    console.error("Backfill failed with error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
