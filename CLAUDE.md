# health — working notes for agents

Personal health app: SQLite record (foods, food log, targets, lab results) +
document catalog + dashboard PWA. Read [README.md](README.md) for the shape. This
repo is **public**: never commit real health data, lab results, photos, names,
dates of birth, imports or screenshots. Real data lives only in the running
container's `/data` volume and its backups.

It tracks and shows the lab's own reference ranges. **It doesn't diagnose**: no
ranges of its own, no interpretation in the UI, the docs or the connector.

## Filing a document the owner sends

1. Read it fully. Never record name, date of birth, address, MRN, accession or
   account numbers anywhere.
2. `scripts/health POST /api/documents '{type, issuer, doc_date, description, notes?}'`
   (type `Nutrition label` or `Lab report`; issuer is the brand or the lab;
   doc_date is the date drawn or the photo's date), then `scripts/health upload <id> <file>`.
3. Apply it:
   - **Label:** find the food (`GET /api/foods`); `PATCH /api/foods/:id` or
     `POST /api/foods` with every value on the label, per serving, in the
     nutrient's unit, `source: {kind: "label", document_id}`. Unknown nutrient →
     `POST /api/nutrients` first. %DV only → convert with the FDA daily value and
     say so in `source.note`. Anything missing → look it up (USDA FoodData Central
     → `{kind: "usda", fdc_id}`, the maker's page → `{kind: "web", url}`) in a
     separate call so each value keeps its own source. Never guess a number.
   - **Lab report:** every result needs a canonical marker (`GET /api/markers`).
     Same test, new printed name → `POST /api/markers/:id/aliases`; a test not on
     file → `POST /api/markers`. Then one `PUT /api/labs` for the whole report:
     `drawn_on` (collection date), `lab`, `document_id`, and per result the name
     as printed, value, unit, `ref_low`/`ref_high` + `ref_text` exactly as
     printed, and the lab's flag. Copy values; don't convert units.
4. `PATCH /api/documents/:id '{"applied_to": "..."}'` describing exactly what changed.
5. Report in a few lines: what it was, what changed, and for labs any result
   outside its printed range and how it compares with the last draw.

Files the owner uploaded through the Documents page arrive as catalog rows with
an empty `applied_to` (shown as "Not filed yet"). To file them, fetch each with
`GET /api/documents/:id/file`, then do steps 1 and 3–5 on that row.

## The Claude connector and the backlog

`/mcp` (`backend/src/mcp.ts`) lets a Claude chat with an access key read the
record and make safe edits; it calls this app's own `/api`, so edits get the
same checks and are logged "(via Claude)". Its instructions carry the filing
rules above (a claude.ai chat has no skill), so keep them in step when the rules
change. It only changes document entries not filed yet. Keep it that way: no
delete tools, and no tool that returns a stored file, since a leaked key must
not hand over lab reports. Keys live hashed in `DATA_DIR/access-keys.json`
(`keys.ts`); the backlog of app ideas in `DATA_DIR/backlog.json` (`backlog.ts`).
When asked "what's on the backlog", `GET /api/backlog`; mark an item done with
`PATCH /api/backlog/:id '{"status":"done"}'` once it ships.

## Changing the app

- Backend: `backend/src/` — `server.ts` (routes), `calc.ts` (every derived
  number: intake, target progress, trends, range status; keep math here, not in
  the PWA), `backup.ts`, `store.ts`. Schema changes are a new numbered file in
  `backend/migrations/` (never edit an applied one).
- PWA: `web/src/views/*.ts`, one per nav page (plus food and marker detail);
  `edit.ts` (click-to-edit), `chart.ts` (SVG charts), `ui.ts`, `fmt.ts`. Theme
  only through the toolkit's CSS variables. No UI/chart frameworks.
- Live refresh is automatic: any API write emits `changed`, and the open page
  re-renders the current view.

## Verify, then ship

The host's Node is 18, which lacks the global `crypto` the MCP SDK needs, so
check and run things in Node 22 containers:

```bash
docker run --rm -v "$PWD/backend:/b" -w /b node:22-bookworm-slim sh -c 'npm ci && npx tsc --noEmit'
scripts/build-web.sh                      # rebuilds web/dist — commit it
docker run --rm -v "$PWD/..:/r" -w /r/health/web node:22-bookworm-slim npx tsc --noEmit
```

Smoke-test by building the real image and running it on a scratch data dir
(`docker build -f backend/Dockerfile -t health-scratch .` then
`docker run -d -v <scratch>/data:/data -v <scratch>/backups:/backups health-scratch`)
before deploying. On the owner's VPS the service is `health` in the shared
compose stack; redeploy with
`docker compose -f ../brainbot/compose/docker-compose.yml up -d --build health`
and check `docker logs health`. A migration touches the live record: take
`POST /api/backups` first.
