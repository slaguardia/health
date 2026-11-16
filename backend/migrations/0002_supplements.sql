-- Steven's supplement routine: each product, when in the day he takes it, and who
-- suggested it. It records the routine he and his practitioner set; it doesn't
-- recommend anything.
CREATE TABLE supplements (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  brand          TEXT,
  dose           TEXT,                         -- as written: '2 softgels', '1 scoop (10–20 g)'
  timing         TEXT NOT NULL DEFAULT 'anytime'
                 CHECK (timing IN ('waking','breakfast','midday','dinner','bedtime','apart','anytime')),
  frequency      TEXT,                         -- 'Daily', 'Every other day'
  directions     TEXT,                         -- how to take it: 'empty stomach, 2 h from coffee'
  purpose        TEXT,
  recommended_by TEXT,
  bought_from    TEXT,                         -- 'Fullscript', 'Costco'
  status         TEXT NOT NULL DEFAULT 'taking' CHECK (status IN ('taking','planned','stopped')),
  started_on     TEXT,                         -- YYYY-MM-DD
  stopped_on     TEXT,
  notes          TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
