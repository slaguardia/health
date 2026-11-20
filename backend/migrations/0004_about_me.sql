-- What the owner wants Claude to know before it helps: an "about me" in their own
-- words, their care to-dos (appointments, letters, follow-ups), and short memories
-- Claude keeps between chats. All of it is theirs to edit or delete on the dashboard.
CREATE TABLE profile (
  section    TEXT PRIMARY KEY CHECK (section IN ('name', 'about', 'goals', 'history', 'care_team', 'preferences')),
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE care_todos (
  id         INTEGER PRIMARY KEY,
  title      TEXT NOT NULL,                 -- 'Ask Dr. X for a letter of medical necessity'
  details    TEXT,
  due_on     TEXT,
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'waiting', 'done')),  -- waiting = on someone else
  source     TEXT NOT NULL DEFAULT 'dashboard' CHECK (source IN ('dashboard', 'claude')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  done_at    TEXT
);

CREATE TABLE memories (
  id         INTEGER PRIMARY KEY,
  text       TEXT NOT NULL,                 -- one lasting fact or preference, in a sentence
  source     TEXT NOT NULL DEFAULT 'dashboard' CHECK (source IN ('dashboard', 'claude')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
