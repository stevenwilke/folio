-- Track where the retail price came from so the UI can display provenance
-- ('bookshop', 'google_print', 'google_ebook') alongside the eBook flag.
ALTER TABLE valuations ADD COLUMN IF NOT EXISTS list_price_source text;
