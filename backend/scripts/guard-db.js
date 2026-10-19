// Guard script to prevent accidental operations against production database
const { URL } = require("url");
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

// Load local/throwaway env first
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

const rawUrl = process.env.DATABASE_URL;
if (!rawUrl) {
  console.error("[DB-GUARD] ERROR: DATABASE_URL is not set.");
  process.exit(1);
}

try {
  const parsed = new URL(rawUrl);
  const host = parsed.hostname;
  const port = parsed.port || "5432";
  const dbName = parsed.pathname.replace(/^\//, "");

  console.log(`====================================================`);
  console.log(`[DB-GUARD] Target Database:`);
  console.log(`  Host:     ${host}`);
  console.log(`  Port:     ${port}`);
  console.log(`  Database: ${dbName}`);
  console.log(`====================================================`);

  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
  const isThrowawayOrTest = dbName.includes("throwaway") || dbName.includes("test") || dbName.includes("dev");

  if (!isLocal || !isThrowawayOrTest || host.includes("neon.tech") || host.includes("aws") || dbName === "neondb") {
    console.error(`\n🚨 [DB-GUARD] FATAL ABORT: Connection target does NOT appear to be a local throwaway database!`);
    console.error(`Production and shared cloud databases are strictly protected.`);
    console.error(`Aborting command execution.\n`);
    process.exit(1);
  }

  console.log(`[DB-GUARD] Verification passed: Safe local throwaway DB detected.\n`);
} catch (err) {
  console.error(`[DB-GUARD] Failed to parse DATABASE_URL:`, err.message);
  process.exit(1);
}
