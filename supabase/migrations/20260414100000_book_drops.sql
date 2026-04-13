-- Book Drops: geolocated book sharing
CREATE TABLE book_drops (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id         uuid        NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  latitude        numeric     NOT NULL,
  longitude       numeric     NOT NULL,
  location_name   text        NOT NULL,
  condition       text        NOT NULL CHECK (condition IN ('like_new', 'very_good', 'good', 'acceptable')),
  note            text,
  photo_url       text,
  status          text        NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'claimed', 'collected', 'expired')),
  claimed_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  claimed_at      timestamptz,
  parent_drop_id  uuid        REFERENCES book_drops(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_book_drops_status ON book_drops (status, created_at DESC);
CREATE INDEX idx_book_drops_book   ON book_drops (book_id, created_at DESC);
CREATE INDEX idx_book_drops_user   ON book_drops (user_id, created_at DESC);
CREATE INDEX idx_book_drops_geo    ON book_drops (latitude, longitude) WHERE status = 'available';

ALTER TABLE book_drops ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read book drops"
  ON book_drops FOR SELECT USING (true);
CREATE POLICY "Authenticated users can create drops"
  ON book_drops FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owner can update own drops"
  ON book_drops FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Claimer can claim available drops"
  ON book_drops FOR UPDATE
  USING (status = 'available')
  WITH CHECK (status = 'claimed' AND claimed_by = auth.uid());
CREATE POLICY "Owner can delete own drops"
  ON book_drops FOR DELETE USING (auth.uid() = user_id);

-- Drop photos storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('drop-photos', 'drop-photos', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Anyone can view drop photos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'drop-photos');
CREATE POLICY "Authenticated users can upload drop photos"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'drop-photos' AND auth.role() = 'authenticated');
CREATE POLICY "Users can delete own drop photos"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'drop-photos' AND auth.uid()::text = (storage.foldername(name))[1]);
