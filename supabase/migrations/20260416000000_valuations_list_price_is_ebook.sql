-- Track whether the stored list_price came from an eBook edition fallback
-- (vs. a print edition). Lets the UI warn the user when the shown retail
-- price is the digital price rather than the publisher MSRP.
ALTER TABLE valuations ADD COLUMN IF NOT EXISTS list_price_is_ebook boolean DEFAULT false;
