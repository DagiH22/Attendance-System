-- Migration: add recurring event support

ALTER TABLE "events"
ADD COLUMN IF NOT EXISTS "parent_event_id" uuid NULL,
ADD COLUMN IF NOT EXISTS "recurrence_index" integer NULL,
ADD COLUMN IF NOT EXISTS "recurrence_length_weeks" integer NULL;

-- add foreign key referencing events(id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_parent_event_id_fkey'
  ) THEN
    ALTER TABLE "events"
    ADD CONSTRAINT events_parent_event_id_fkey FOREIGN KEY (parent_event_id) REFERENCES "events"(id) ON DELETE SET NULL;
  END IF;
END$$;

-- add index on parent_event_id
CREATE INDEX IF NOT EXISTS "events_parent_event_id_idx" ON "events" ("parent_event_id");
