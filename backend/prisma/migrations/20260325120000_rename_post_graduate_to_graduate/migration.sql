-- Rename Batch enum value POST_GRADUATE -> GRADUATE
-- This uses Postgres enum value rename (supported in Postgres 10+).
-- If your DB is older or this fails, we can fallback to creating a new enum type and casting.

ALTER TYPE "Batch" RENAME VALUE 'POST_GRADUATE' TO 'GRADUATE';
