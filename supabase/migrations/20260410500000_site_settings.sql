-- Site-wide settings (single row, admin-managed)
CREATE TABLE site_settings (
  id          integer     PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- enforce single row
  contact_email text      NOT NULL DEFAULT 'steven411@gmail.com',
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Insert default row
INSERT INTO site_settings (id, contact_email) VALUES (1, 'steven411@gmail.com');

-- RLS: anyone can read, only admins can update
ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read site settings"
  ON site_settings FOR SELECT
  USING (true);

CREATE POLICY "Admins can update site settings"
  ON site_settings FOR UPDATE
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));
