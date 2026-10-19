require("./guard-db.js");
const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const prisma = new PrismaClient();

async function main() {
  console.log("Checking _prisma_migrations table...");

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id"                    VARCHAR(36) PRIMARY KEY NOT NULL,
      "checksum"              VARCHAR(64) NOT NULL,
      "finished_at"           TIMESTAMPTZ,
      "migration_name"        VARCHAR(255) NOT NULL,
      "logs"                  TEXT,
      "rolled_back_at"        TIMESTAMPTZ,
      "started_at"            TIMESTAMPTZ NOT NULL DEFAULT now(),
      "applied_steps_count"   INTEGER NOT NULL DEFAULT 0
    );
  `);

  const migrationsDir = path.resolve(__dirname, "../prisma/migrations");
  const entries = fs.readdirSync(migrationsDir).filter(
    (name) => fs.statSync(path.join(migrationsDir, name)).isDirectory() && !name.includes("v2_studies")
  );

  for (const name of entries) {
    const existing = await prisma.$queryRawUnsafe(
      `SELECT id FROM "_prisma_migrations" WHERE migration_name = $1`,
      name
    );
    if (existing.length === 0) {
      const sqlFile = path.join(migrationsDir, name, "migration.sql");
      const content = fs.existsSync(sqlFile) ? fs.readFileSync(sqlFile, "utf8") : "";
      const checksum = crypto.createHash("sha256").update(content).digest("hex");
      const id = crypto.randomUUID();

      await prisma.$executeRawUnsafe(
        `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count)
         VALUES ($1, $2, now(), $3, 1)`,
        id,
        checksum,
        name
      );
      console.log(`Marked historical migration as applied: ${name}`);
    }
  }

  console.log("Historical migrations successfully baselined in throwaway DB.");
}

main().catch(console.error).finally(() => prisma.$disconnect());
