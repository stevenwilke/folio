-- Track which little_libraries entries originated from OpenStreetMap
-- so we can dedupe OSM-sourced pins against user-added ones on the map.
ALTER TABLE little_libraries ADD COLUMN IF NOT EXISTS osm_id text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_little_libraries_osm_id
  ON little_libraries (osm_id) WHERE osm_id IS NOT NULL;
