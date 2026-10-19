#!/usr/bin/env node
/**
 * Migration Rehearsal Script
 * Restores a production dump (or tests existing state) in a local throwaway database,
 * runs the entire v1 -> v2 migration and backfills end-to-end,
 * and prints an exhaustive audit report.
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

require("./guard-db.js");

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function getRowCounts() {
  const counts = {
    members: await prisma.member.count(),
    events: await prisma.event.count(),
    attendances: await prisma.attendance.count(),
    admins: await prisma.admin.count(),
    eventClusters: await prisma.eventCluster.count(),
    studies: await prisma.study.count().catch(() => 0),
  };
  return counts;
}

async function run() {
  console.log("==========================================================");
  console.log("  🚀 REHEARSAL: V1 -> V2 MIGRATION & BACKFILL RUNNER");
  console.log("==========================================================\n");

  const args = process.argv.slice(2);
  const dumpArg = args.find((a) => a.startsWith("--dump="));
  const dumpPath = dumpArg ? dumpArg.split("=")[1] : null;

  if (dumpPath) {
    if (!fs.existsSync(dumpPath)) {
      console.error(`❌ Dump file not found: ${dumpPath}`);
      process.exit(1);
    }
    console.log(`📦 Restoring database dump from: ${dumpPath}...`);
    const dbUrl = process.env.DATABASE_URL;
    try {
      execSync(`psql "${dbUrl}" -f "${dumpPath}"`, { stdio: "inherit" });
      console.log("✅ Dump restore completed.\n");
    } catch (err) {
      console.error("❌ Failed to restore dump:", err.message);
      process.exit(1);
    }
  } else {
    console.log("ℹ️  No --dump provided. Running rehearsal against current throwaway DB.\n");
  }

  // 1. Baseline Counts
  console.log("📊 Step 1: Capturing baseline counts before migration...");
  const beforeCounts = await getRowCounts();
  console.log("Baseline Row Counts:", beforeCounts);

  // 2. Run Prisma Migrate Deploy
  console.log("\n📦 Step 2: Running Prisma Migrate Deploy...");
  try {
    execSync("node scripts/prisma-safe.js migrate deploy", { stdio: "inherit" });
    console.log("✅ Prisma migrations deployed successfully.");
  } catch (e) {
    console.error("❌ Prisma migrate deploy failed:", e.message);
    process.exit(1);
  }

  // 3. Dry-Run Backfill
  console.log("\n🔍 Step 3: Running Backfill in --dry-run mode...");
  try {
    execSync("npm run backfill -- --dry-run", { stdio: "inherit" });
    console.log("✅ Backfill dry-run completed.");
  } catch (e) {
    console.error("❌ Backfill dry-run failed:", e.message);
    process.exit(1);
  }

  // 4. Apply Backfill
  console.log("\n⚡ Step 4: Applying Backfill...");
  try {
    execSync("npm run backfill -- --apply", { stdio: "inherit" });
    console.log("✅ Backfill applied successfully.");
  } catch (e) {
    console.error("❌ Backfill apply failed:", e.message);
    process.exit(1);
  }

  // 5. Post-Migration Counts & Verification
  console.log("\n📊 Step 5: Capturing post-migration counts...");
  const afterCounts = await getRowCounts();
  console.log("Post-Migration Row Counts:", afterCounts);

  console.log("\n==========================================================");
  console.log("  🔍 INTEGRITY CHECK:");
  console.log("==========================================================");
  let passed = true;

  if (afterCounts.members < beforeCounts.members) {
    console.error(`❌ Members count dropped: ${beforeCounts.members} -> ${afterCounts.members}`);
    passed = false;
  } else {
    console.log(`✅ Members preserved: ${afterCounts.members}`);
  }

  if (afterCounts.events < beforeCounts.events) {
    console.error(`❌ Events count dropped: ${beforeCounts.events} -> ${afterCounts.events}`);
    passed = false;
  } else {
    console.log(`✅ Events preserved: ${afterCounts.events}`);
  }

  if (afterCounts.attendances < beforeCounts.attendances) {
    console.error(`❌ Attendances count dropped: ${beforeCounts.attendances} -> ${afterCounts.attendances}`);
    passed = false;
  } else {
    console.log(`✅ Attendances preserved: ${afterCounts.attendances}`);
  }

  if (afterCounts.eventClusters < beforeCounts.eventClusters) {
    console.error(`❌ EventClusters count dropped: ${beforeCounts.eventClusters} -> ${afterCounts.eventClusters}`);
    passed = false;
  } else {
    console.log(`✅ EventClusters preserved (additive contract): ${afterCounts.eventClusters}`);
  }

  console.log(`✅ Studies active: ${afterCounts.studies}`);

  if (passed) {
    console.log("\n🎉 REHEARSAL VERDICT: GO (Ready for scheduled maintenance window)");
  } else {
    console.error("\n🚨 REHEARSAL VERDICT: NO-GO (Data loss or regression detected)");
    process.exit(1);
  }
}

run()
  .catch((e) => {
    console.error("Rehearsal failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
