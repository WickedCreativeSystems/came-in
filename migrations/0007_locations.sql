-- Locations are stores (plan 1.3, 3.13): each has its own card, tap page, staff screen and counts,
-- and by default shares its shop's Buffer connection, posts and settings.
CREATE TABLE locations (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  removed_at TEXT,
  UNIQUE (shop_id, name)
);
CREATE INDEX locations_shop ON locations(shop_id, position);

ALTER TABLE taps ADD COLUMN location_id TEXT;
ALTER TABLE counters ADD COLUMN location_id TEXT;
CREATE INDEX taps_location ON taps(shop_id, location_id, created_at);

-- Every existing shop gets its first location, which takes the shop's id (so /t/<shop> and
-- /t/<shop>/<shop> are the same page) and the shop's name (24 characters at most).
INSERT INTO locations (id, shop_id, name, position, created_at)
  SELECT id, id, CASE WHEN TRIM(name) = '' THEN 'Main' ELSE SUBSTR(TRIM(name), 1, 24) END, 0, created_at FROM shops;

-- Its card and staff-screen taps and its staff screens move onto it; online taps have no location.
UPDATE taps SET location_id = shop_id WHERE source IN ('card', 'counter');
UPDATE counters SET location_id = shop_id;
