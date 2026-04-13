-- Add has_read boolean to decouple "read" from ownership status.
-- A book can be owned AND read, or just read (not in library).
ALTER TABLE collection_entries ADD COLUMN has_read boolean DEFAULT false NOT NULL;

-- Backfill: existing entries with read_status='read' are books the user has read
UPDATE collection_entries SET has_read = true WHERE read_status = 'read';
