# health: a self-hosted food and bloodwork dashboard you build by feeding it photos

A small personal health app for one person on their own server. Photograph a
nutrition label or get a lab report back, hand it to a Claude chat, and the chat
reads it, looks up anything missing (USDA FoodData Central, the maker's site),
and files it: the food goes into your library with the source of every value,
and the lab results go onto each marker's history. The dashboard then tracks
what you eat against targets you set, and how your bloodwork changes over time.

It tracks and shows the lab's own reference ranges. It doesn't diagnose.

## What you can feed it

| Send it | It files the document and updates |
|---|---|
| Photo of a nutrition label | a saved food: name, brand, serving, every nutrient on the label (per serving), each value tagged with the photo it came from |
| A food with no label (produce, a restaurant dish) | a saved food with values from USDA FoodData Central (by FDC id) or a web page (by URL) |
| Lab report, PDF or photo | one result per test: value as printed, unit, the report's own reference range and flag, each under a canonical marker so the same test from different labs lines up |
| "I had two slices of that bread for lunch" | the food log |

Every document gets a catalog row recording what it changed, and the file itself
is stored and backed up. Every change goes in an activity log.

## What it shows

- **Today:** calories, protein, carbs and fat so far; a bar per target (calories
  about 2,400, protein at least 150 g, sodium at most 2,300 mg, whatever you set);
  what you ate by meal, editable in place; one-tap re-logging of the foods you
  log most; the latest lab draw with anything outside its printed range. Arrows
  step back through earlier days.
- **Food:** daily averages over 7, 30, 90 or 365 days, a bar chart of any
  nutrient per day against its target, and the library of saved foods. Each
  food's page shows every value with its source (label photo, USDA, web page or
  typed in) and when it was logged.
- **Labs:** every marker grouped by panel, charted over time against the range
  printed on each result's own report (labs differ, so the band can shift from
  draw to draw); results outside it are flagged. Each marker's page has the full
  table and the names labs print for it.
- **Supplements:** each practitioner's plan as written (her pick, dose and link,
  and what you take in its place), then the routine by time of day (on waking, with breakfast, midday,
  with dinner, bedtime, apart from meals): each product's dose, how often,
  directions, who recommended it, a link to the product, and whether it's taken,
  not started yet or stopped. When you take a different product than the plan named,
  the plan's pick and its link stay on the row. Stopped ones stay in a list below.
- **Documents:** upload from your phone's camera or file picker (several at once).
  Anything not yet read shows "Not filed yet" until Claude files it.
- **Backlog:** ideas for making the dashboard better, added on the page or by
  Claude through the connector; tick them off as they ship.
- **Log:** every change, the nightly backups and a "back up now" button, and
  the Claude access keys (create, see when each was last used, revoke).

## How it's built

- **Backend** (`backend/`): Node + TypeScript + Express, with SQLite through
  `better-sqlite3` and numbered migrations in `backend/migrations/`. It serves
  JSON at `/api/*` and the built PWA at `/`. Every write appends to the activity
  log and emits a `changed` event on `/api/events` (SSE), which open pages listen to.
- **PWA** (`web/`): vanilla TypeScript + Vite, built on
  [`@brainbot/web-toolkit`](https://github.com/slaguardia/brainbot/tree/master/web-toolkit)
  (design tokens, app shell, service worker). Charts are hand-rolled SVG, with
  no chart or UI framework.
- **Storage:** `/data/health.db` and `/data/files/<sha256><ext>`. Stored files
  are content-addressed, so the same photo uploaded twice is stored once.
- **Backups:** each night (after `BACKUP_HOUR`) it writes a consistent snapshot
  to `BACKUP_DIR/health-YYYY-MM-DD.db` using SQLite's online backup API, copies
  stored files to `BACKUP_DIR/files/`, and keeps the newest `BACKUP_KEEP` (30).
- **Auth:** none in the app, by design. It's meant to sit behind an auth edge
  (here, Caddy `forward_auth` to oauth2-proxy with Google sign-in and an email
  allowlist). `/api/me` echoes the edge's `X-Auth-Request-Email`.
  **Don't expose it to the internet without that.**
- **No outbound fetching.** The server never looks anything up on the web; the
  chat does its own lookups and records the source.

## Data model

| Table | Holds |
|---|---|
| `nutrients` | key, name, unit (`kcal` `g` `mg` `mcg`). Seeded with the US label set; more are added as labels list them |
| `foods` | name, brand, serving size as printed, grams per serving, servings per container, barcode, archived |
| `food_sources` | where values came from: `label` (a document), `usda` (an FDC id), `web` (a URL) or `manual` |
| `food_nutrients` | per-serving amount of each nutrient, with the source behind it |
| `food_log` | date, optional meal (`breakfast` `lunch` `dinner` `snack`), food, servings |
| `targets` | nutrient, amount, `at_least` / `at_most` / `about` |
| `markers` | a canonical test (slug, name, panel, the unit it's charted in) |
| `marker_aliases` | the names labs print for a marker |
| `supplements` | product, brand, dose as written, time of day, how often, directions, purpose, who recommended it, where it's bought, product link, the plan's product and link when he takes another, `taking` / `planned` / `stopped` with start and stop dates |
| `lab_results` | date drawn, lab, marker, name as printed, value (number and as printed), unit, the report's range (numbers and as printed), the lab's flag, source document. One per marker, date and lab |
| `documents` | dates, type, from (lab or brand), description, what it was applied to, notes, stored file |
| `activity` | timestamped one-line summary of every change |

A day's intake is computed from each food's current values, so correcting a food
corrects its past days too. "Out of range" means outside that result's own
printed range, or flagged by the lab; there are no ranges of the app's own.

## API

Everything the UI does goes through these, so an agent can do the same.

```
GET    /api/overview[?date=]             today's totals vs targets, 7-day average, recent foods, latest draw, unfiled count
GET    /api/day/:date                    entries with what each contributed, totals, progress per target
GET    /api/trends?days=30[&end=]        daily totals for logged days, averages, targets
GET    /api/nutrients | POST {key, name, unit}
GET    /api/foods[?archived=1] | GET /api/foods/:id
POST   /api/foods                        {name, brand?, serving_size?, serving_grams?, …, nutrients: {key: amount}, source: {kind, document_id? | fdc_id? | url?, note?}}
PATCH  /api/foods/:id                    same fields; nutrients given are set from that source (null removes one)
DELETE /api/foods/:id                    only a food never logged (otherwise archive it)
POST   /api/log                          {date?, meal?, food_id, servings, notes?} | PATCH /api/log/:id | DELETE /api/log/:id
GET    /api/targets | PUT /api/targets/:nutrient {amount, direction} | DELETE /api/targets/:nutrient
GET    /api/markers | GET /api/markers/:id (history) | GET /api/draws
POST   /api/markers                      {id, name, panel?, unit?, aliases?} | PATCH /api/markers/:id | POST /api/markers/:id/aliases {alias}
PUT    /api/labs                         {drawn_on, lab?, document_id?, results: [{marker_id | name_on_report, value?, value_text?, unit?, ref_low?, ref_high?, ref_text?, flag?}]}
PATCH  /api/labs/:id | DELETE /api/labs/:id
GET    /api/documents | POST {…metadata} | PATCH /:id | DELETE /:id
PUT    /api/documents/:id/file           raw body, Content-Type + X-Filename headers
GET    /api/documents/:id/file
GET    /api/backups | POST /api/backups
GET    /api/backlog   | POST {title, details?} | PATCH /:id {title?, details?, status?} | DELETE /:id
GET    /api/keys      | POST {label} → {key} (shown once) | DELETE /:id
GET    /api/activity | /api/events (SSE) | /api/me | /healthz
```

## Talking to it from a Claude chat

`/mcp` is an [MCP](https://modelcontextprotocol.io) server, so a Claude chat can
read the record and make small edits. Create a key on the Log page, then either
add `https://<host>/mcp/<key>` as a custom connector in claude.ai, or run
`claude mcp add --transport http health https://<host>/mcp --header "Authorization: Bearer <key>"`
for Claude Code.

Tools: `get_overview`, `get_day`, `get_nutrition_trends`, `list_nutrients`,
`list_foods`, `get_food`, `list_markers`, `get_lab_history`, `list_lab_draws`,
`get_recent_changes` to read; `log_food`, `update_log_entry`, `add_food`,
`update_food`, `add_nutrient`, `set_target`, `add_marker`, `add_marker_alias`,
`record_lab_results` to edit; `list_documents`, `catalog_document`,
`mark_document_filed` to file a document the chat was shown; `list_backlog`,
`add_backlog_item` for the backlog. The filing rules are in the connector's own
instructions, so a claude.ai chat follows them without a skill.

The safety model:

- Nothing deletes.
- Stored files never leave through the connector. A claude.ai chat can't pass an
  uploaded file to a tool, so you upload the original on the Documents page and
  show the same file in the chat, which fills in that "Not filed yet" entry.
- Only entries not filed yet can be changed.
- Every edit lands in the Log marked "(via Claude)". The tag rides on an
  `x-via: claude` header that only counts on the connector's own calls from
  localhost.

The edge lets `/mcp` through without its own login (claude.ai calls it from
Anthropic's servers), so the key is the only lock there. Only a SHA-256 of each
key is stored (`DATA_DIR/access-keys.json`); revoking one cuts it off on the next
request. The backlog lives in `DATA_DIR/backlog.json`.

`scripts/health` calls the API from the host over the Docker network:

```bash
scripts/health GET /api/overview
scripts/health POST /api/log '{"food_id":3,"servings":1.5,"meal":"lunch"}'
scripts/health POST /api/documents '{"type":"Lab report","issuer":"Example Lab","doc_date":"2026-10-14"}'
scripts/health upload 12 ~/report.pdf
```

## Running it

```bash
# backend (dev): data/ and backups/ land next to it. Needs Node 22.
cd backend && npm install && npm run dev            # :8790

# PWA: built into web/dist (committed; the image bakes it in)
scripts/build-web.sh                                # needs Docker; expects ../brainbot next to this repo

# image
docker build -f backend/Dockerfile -t health .
docker run -v health-data:/data -v "$PWD/backups:/backups" -e TZ=America/New_York health
```

Environment variables: `PORT` (8790), `DATA_DIR`, `BACKUP_DIR`, `BACKUP_HOUR`
(4), `BACKUP_KEEP` (30), `TZ` (used for "today" and backup times).

Your data never goes in the repo. `data/`, `backups/`, `*.db` and `seed*.json`
are all gitignored.

## Working on it with Claude Code

[`CLAUDE.md`](CLAUDE.md) tells an agent how to file a document, how to change
the dashboard, and how to ship a change.

## License

MIT
