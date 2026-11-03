-- health working set: what Steven eats, against targets he sets, and his lab
-- results over time. This database is the record. It tracks and shows the lab's
-- own reference ranges; it doesn't interpret them.

-- The shared vocabulary for food values and targets. Every amount is stored in
-- the nutrient's unit. Seeded with the US label set; any other nutrient a label
-- lists is added when it first shows up.
CREATE TABLE nutrients (
  key  TEXT PRIMARY KEY CHECK (key GLOB '[a-z]*' AND key NOT GLOB '*[^a-z0-9_]*'),  -- 'calories', 'vitamin_d'
  name TEXT NOT NULL,
  unit TEXT NOT NULL CHECK (unit IN ('kcal','g','mg','mcg')),
  sort INTEGER NOT NULL DEFAULT 100
);
INSERT INTO nutrients (key, name, unit, sort) VALUES
  ('calories',    'Calories',      'kcal', 1),
  ('protein',     'Protein',       'g',    2),
  ('carbs',       'Carbs',         'g',    3),
  ('fat',         'Fat',           'g',    4),
  ('fiber',       'Fiber',         'g',    5),
  ('sugar',       'Sugar',         'g',    6),
  ('added_sugar', 'Added sugar',   'g',    7),
  ('sat_fat',     'Saturated fat', 'g',    8),
  ('trans_fat',   'Trans fat',     'g',    9),
  ('cholesterol', 'Cholesterol',   'mg',  10),
  ('sodium',      'Sodium',        'mg',  11),
  ('potassium',   'Potassium',     'mg',  12),
  ('calcium',     'Calcium',       'mg',  13),
  ('iron',        'Iron',          'mg',  14),
  ('vitamin_d',   'Vitamin D',     'mcg', 15);

-- The document catalog. A file, when stored here, lives at /data/files/<sha256><ext>.
-- applied_to empty = "Not filed yet" (uploaded, not read yet).
CREATE TABLE documents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  added_at    TEXT NOT NULL DEFAULT (date('now')),
  doc_date    TEXT,                            -- the date drawn, or the photo's date
  type        TEXT,                            -- 'Lab report', 'Nutrition label'
  issuer      TEXT,                            -- the lab, or the food's brand
  description TEXT,
  applied_to  TEXT,                            -- what this document changed, in words
  notes       TEXT,
  file_name   TEXT,
  file_sha    TEXT,
  file_ext    TEXT,
  mime        TEXT,
  size        INTEGER
);

-- A saved food. Its nutrients are per serving.
CREATE TABLE foods (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  name                   TEXT NOT NULL,
  brand                  TEXT,
  serving_size           TEXT,                 -- as printed: '2/3 cup (55 g)'
  serving_grams          REAL,                 -- grams (or mL) per serving, when known
  servings_per_container REAL,
  upc                    TEXT,
  notes                  TEXT,
  archived               INTEGER NOT NULL DEFAULT 0,  -- hidden from quick re-log, kept for history
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Where a food's values came from. One source (a label photo) usually backs many values.
CREATE TABLE food_sources (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  food_id     INTEGER NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('label','usda','web','manual')),
  document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,  -- label photo
  fdc_id      TEXT,                            -- USDA FoodData Central id
  url         TEXT,                            -- web page
  note        TEXT,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE food_nutrients (
  food_id   INTEGER NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
  nutrient  TEXT NOT NULL REFERENCES nutrients(key),
  amount    REAL NOT NULL CHECK (amount >= 0),
  source_id INTEGER REFERENCES food_sources(id) ON DELETE SET NULL,
  PRIMARY KEY (food_id, nutrient)
);

-- What was eaten. Intake comes from the food's current values, so correcting a
-- food corrects its past days too.
CREATE TABLE food_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  date      TEXT NOT NULL,                     -- YYYY-MM-DD
  meal      TEXT CHECK (meal IN ('breakfast','lunch','dinner','snack')),
  food_id   INTEGER NOT NULL REFERENCES foods(id),
  servings  REAL NOT NULL CHECK (servings > 0),
  notes     TEXT,
  logged_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX food_log_date ON food_log (date);

CREATE TABLE targets (
  nutrient  TEXT PRIMARY KEY REFERENCES nutrients(key),
  amount    REAL NOT NULL CHECK (amount >= 0),
  direction TEXT NOT NULL DEFAULT 'about' CHECK (direction IN ('at_least','at_most','about'))
);

-- One canonical test, so the same marker from different labs lines up over time.
CREATE TABLE markers (
  id    TEXT PRIMARY KEY CHECK (id GLOB '[a-z0-9]*' AND id NOT GLOB '*[^a-z0-9-]*'),  -- 'ldl-cholesterol'
  name  TEXT NOT NULL,                         -- 'LDL cholesterol'
  panel TEXT,                                  -- 'Lipid panel', 'CMP', 'CBC', 'Thyroid'
  unit  TEXT,                                  -- the unit it's charted in
  notes TEXT,
  sort  INTEGER NOT NULL DEFAULT 0
);

-- Names as each lab prints them ('LDL Chol Calc (NIH)', 'LDL-C').
CREATE TABLE marker_aliases (
  alias     TEXT PRIMARY KEY COLLATE NOCASE,
  marker_id TEXT NOT NULL REFERENCES markers(id) ON DELETE CASCADE
);

CREATE TABLE lab_results (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  drawn_on       TEXT NOT NULL,                -- YYYY-MM-DD
  lab            TEXT NOT NULL DEFAULT '',     -- 'Quest', 'Labcorp' ('' if unknown)
  marker_id      TEXT NOT NULL REFERENCES markers(id),
  name_on_report TEXT,                         -- as printed
  value          REAL,                         -- numeric value; null for a text result
  value_text     TEXT,                         -- as printed: '<0.5', 'Negative', '135'
  unit           TEXT,                         -- as printed
  ref_low        REAL,                         -- the report's own range, when numeric
  ref_high       REAL,
  ref_text       TEXT,                         -- the range as printed: '<100', '3.5-5.2'
  flag           TEXT,                         -- the report's own flag: H, L, A …
  document_id    INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  notes          TEXT,
  UNIQUE (marker_id, drawn_on, lab)            -- re-filing a report updates it
);

-- What changed and when, newest first in the UI.
CREATE TABLE activity (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      TEXT NOT NULL DEFAULT (datetime('now')),
  summary TEXT NOT NULL
);
