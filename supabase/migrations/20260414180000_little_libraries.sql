-- Little Libraries: community book-sharing boxes on the map
CREATE TABLE little_libraries (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  latitude        numeric     NOT NULL,
  longitude       numeric     NOT NULL,
  location_name   text        NOT NULL,
  name            text,
  photo_url       text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_little_libraries_geo ON little_libraries (latitude, longitude);
CREATE INDEX idx_little_libraries_user ON little_libraries (user_id, created_at DESC);

ALTER TABLE little_libraries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read little libraries"
  ON little_libraries FOR SELECT USING (true);
CREATE POLICY "Authenticated users can add libraries"
  ON little_libraries FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owner can update own library"
  ON little_libraries FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Owner can delete own library"
  ON little_libraries FOR DELETE USING (auth.uid() = user_id);

-- Scans: inventory snapshots taken by visitors
CREATE TABLE little_library_scans (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  library_id      uuid        NOT NULL REFERENCES little_libraries(id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  photo_url       text,
  books_found     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ll_scans_library ON little_library_scans (library_id, created_at DESC);
CREATE INDEX idx_ll_scans_user ON little_library_scans (user_id, created_at DESC);

ALTER TABLE little_library_scans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read scans"
  ON little_library_scans FOR SELECT USING (true);
CREATE POLICY "Authenticated users can add scans"
  ON little_library_scans FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owner can update own scans"
  ON little_library_scans FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Owner can delete own scans"
  ON little_library_scans FOR DELETE USING (auth.uid() = user_id);

-- Library photos storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('library-photos', 'library-photos', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Anyone can view library photos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'library-photos');
CREATE POLICY "Authenticated users can upload library photos"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'library-photos' AND auth.role() = 'authenticated');
CREATE POLICY "Users can delete own library photos"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'library-photos' AND auth.uid()::text = (storage.foldername(name))[1]);
