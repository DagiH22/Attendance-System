/*
  Backfill legacy null values before enforcing required fields on members and events.
  This keeps existing rows readable by Prisma once the schema marks these columns as non-null.
*/

-- Normalize legacy member rows created before required-field validation existed.
UPDATE "members"
SET
  "department" = COALESCE(NULLIF(TRIM("department"), ''), 'UNASSIGNED'),
  "batch" = COALESCE("batch", 'FRESHMAN'::"Batch"),
  "campus" = COALESCE("campus", 'FOUR_KILO'::"Campus")
WHERE
  "department" IS NULL
  OR TRIM("department") = ''
  OR "batch" IS NULL
  OR "campus" IS NULL;

-- Normalize legacy event rows that may have empty or null descriptions.
UPDATE "events"
SET "description" = 'Description unavailable.'
WHERE "description" IS NULL OR TRIM("description") = '';

-- Enforce the new required constraints after existing data is safe.
ALTER TABLE "members"
  ALTER COLUMN "department" SET NOT NULL,
  ALTER COLUMN "batch" SET NOT NULL,
  ALTER COLUMN "campus" SET NOT NULL;

ALTER TABLE "events"
  ALTER COLUMN "description" SET NOT NULL;
