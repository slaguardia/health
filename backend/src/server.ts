// HTTP server: JSON /api/* + /api/me + /healthz, the Claude connector at /mcp,
// and the built PWA at / (SPA fallback). Every write logs one activity line and
// pings /api/events so open pages refresh themselves.
import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express, { NextFunction, Request, Response } from "express";
import { db, filesDir, logActivity } from "./store";
import { dailySeries, day, draws, food, foods, markerHistory, markers, nutrients, overview, progress, targets, today } from "./calc";
import { listBackups, runBackup } from "./backup";
import { handleMcp } from "./mcp";
import { createKey, listKeys, revokeKey } from "./keys";
import { addBacklog, listBacklog, removeBacklog, updateBacklog } from "./backlog";

// --- change feed (SSE) ---
const listeners = new Set<Response>();
/** Set while handling a request the Claude connector made, so its changes read "(via Claude)" in the Log. */
const viaClaude = new AsyncLocalStorage<true>();
function changed(summary: string): void {
  if (viaClaude.getStore()) summary += " (via Claude)";
  logActivity(summary);
  for (const res of listeners) res.write(`event: changed\ndata: ${JSON.stringify({ summary })}\n\n`);
}

class Bad extends Error {}

/** A file name safe for storage and headers: no control characters, quotes or backslashes. */
const cleanName = (s: string) => s.replace(/[\x00-\x1f\x7f"\\]/g, "").trim() || "file";
function need<T>(v: T | undefined | null, what: string): T {
  if (v === undefined || v === null || v === "") throw new Bad(`${what} is required`);
  return v;
}
const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
function date(v: unknown, what: string): string {
  if (!isDate(v)) throw new Bad(`${what} must be a date like 2026-11-03`);
  return v as string;
}
function num(v: unknown, what: string): number {
  const n = Number(v);
  if (v === null || v === "" || !Number.isFinite(n)) throw new Bad(`${what} must be a number`);
  return n;
}

/** Keep only known columns from a request body. */
function pick(body: any, cols: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of cols) if (body && c in body) out[c] = body[c] === "" ? null : body[c];
  return out;
}

/** "servings → 2, meal → lunch" for the activity log. */
const describe = (fields: Record<string, unknown>) => Object.entries(fields).map(([k, v]) => `${k} → ${v ?? "—"}`).join(", ");

function update(table: string, key: string, id: unknown, fields: Record<string, unknown>): void {
  const cols = Object.keys(fields);
  if (!cols.length) throw new Bad("nothing to update");
  const r = db().prepare(`UPDATE ${table} SET ${cols.map((c) => `${c}=@${c}`).join(", ")} WHERE ${key}=@__id`).run({ ...fields, __id: id });
  if (!r.changes) throw new Bad(`${table} ${id} not found`);
}

function insert(table: string, fields: Record<string, unknown>): number {
  const cols = Object.keys(fields);
  const r = db().prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((c) => "@" + c).join(", ")})`).run(fields);
  return Number(r.lastInsertRowid);
}

const FOOD = ["name", "brand", "serving_size", "serving_grams", "servings_per_container", "upc", "notes", "archived"];
const LOG = ["date", "meal", "food_id", "servings", "notes"];
const MARKER = ["name", "panel", "unit", "notes", "sort"];
const RESULT = ["drawn_on", "lab", "marker_id", "name_on_report", "value", "value_text", "unit", "ref_low", "ref_high", "ref_text", "flag", "document_id", "notes"];
const DOCUMENT = ["doc_date", "type", "issuer", "description", "applied_to", "notes", "added_at"];
const SOURCE_KINDS = ["label", "usda", "web", "manual"];
const SUPPLEMENT = ["name", "brand", "dose", "timing", "frequency", "directions", "purpose", "recommended_by", "bought_from", "status", "started_on", "stopped_on", "notes", "url", "plan_product", "plan_url"];
const TIMINGS = ["waking", "breakfast", "midday", "dinner", "bedtime", "apart", "anytime"];
const STATUSES = ["taking", "planned", "stopped"];

/** Check a supplement's fields; stopping one without a date stops it today. */
function supplementFields(body: any): Record<string, unknown> {
  const f = pick(body, SUPPLEMENT);
  if (f.timing != null && !TIMINGS.includes(f.timing as string)) throw new Bad(`timing must be one of ${TIMINGS.join(", ")}`);
  if (f.status != null && !STATUSES.includes(f.status as string)) throw new Bad(`status must be one of ${STATUSES.join(", ")}`);
  for (const k of ["started_on", "stopped_on"]) if (f[k] != null) date(f[k], k);
  for (const k of ["url", "plan_url"]) if (f[k] != null && !/^https?:\/\/\S+$/.test(String(f[k]))) throw new Bad(`${k} must be a web address starting with https://`);
  if (f.status === "stopped" && f.stopped_on === undefined) f.stopped_on = today();
  if (f.status && f.status !== "stopped" && f.stopped_on === undefined) f.stopped_on = null;
  return f;
}
const PROFILE = ["name", "about", "goals", "history", "care_team", "preferences"];
const TODO_STATUSES = ["open", "waiting", "done"];
/** Check a care to-do's fields; marking it done stamps when. */
function todoFields(body: any): Record<string, unknown> {
  const f = pick(body, ["title", "details", "due_on", "status"]);
  if (f.due_on != null) date(f.due_on, "due_on");
  if (f.status != null && !TODO_STATUSES.includes(f.status as string)) throw new Bad(`status must be one of ${TODO_STATUSES.join(", ")}`);
  if (f.status !== undefined) f.done_at = f.status === "done" ? new Date().toISOString().slice(0, 19).replace("T", " ") : null;
  return f;
}
const supplementName = (id: unknown) => {
  const s = db().prepare("SELECT name, brand FROM supplements WHERE id=?").get(id) as { name: string; brand: string | null } | undefined;
  return s ? (s.brand ? `${s.name} (${s.brand})` : s.name) : `supplement #${id}`;
};

const foodName = (id: unknown) => {
  const f = db().prepare("SELECT name, brand FROM foods WHERE id=?").get(id) as { name: string; brand: string | null } | undefined;
  return f ? (f.brand ? `${f.name} (${f.brand})` : f.name) : `food #${id}`;
};

/**
 * Set some of a food's per-serving values, all from one source (a label photo, a USDA entry, a web page, or typed in).
 * `nutrients` is {key: amount}; null removes that value. Unknown keys are refused, so a typo doesn't make a new nutrient.
 */
function setNutrients(foodId: number, values: Record<string, unknown>, source: any): number {
  const entries = Object.entries(values ?? {});
  if (!entries.length) return 0;
  const known = new Set(nutrients().map((n) => n.key));
  const unknown = entries.map(([k]) => k).filter((k) => !known.has(k));
  if (unknown.length) throw new Bad(`unknown nutrient ${unknown.join(", ")}: add it first (POST /api/nutrients {key, name, unit})`);
  const s = source ?? { kind: "manual" };
  if (!SOURCE_KINDS.includes(s.kind)) throw new Bad(`source kind must be one of ${SOURCE_KINDS.join(", ")}`);
  if (s.kind === "web" && !s.url) throw new Bad("a web source needs its url");
  if (s.kind === "usda" && !s.fdc_id) throw new Bad("a USDA source needs its fdc_id");
  const sourceId = insert("food_sources", {
    food_id: foodId, kind: s.kind, document_id: s.document_id ?? null, fdc_id: s.fdc_id == null ? null : String(s.fdc_id),
    url: s.url ?? null, note: s.note ?? null,
  });
  for (const [k, v] of entries) {
    if (v === null) db().prepare("DELETE FROM food_nutrients WHERE food_id=? AND nutrient=?").run(foodId, k);
    else db().prepare(
      `INSERT INTO food_nutrients (food_id, nutrient, amount, source_id) VALUES (?, ?, ?, ?)
       ON CONFLICT (food_id, nutrient) DO UPDATE SET amount=excluded.amount, source_id=excluded.source_id`
    ).run(foodId, k, num(v, k), sourceId);
  }
  return entries.length;
}

/** Find a marker by id or by any name a lab prints for it. */
function resolveMarker(r: any): string | null {
  if (r.marker_id) return (db().prepare("SELECT id FROM markers WHERE id=?").get(r.marker_id) as any)?.id ?? null;
  const name = String(r.name_on_report ?? "").trim();
  if (!name) return null;
  return (db().prepare("SELECT marker_id AS id FROM marker_aliases WHERE alias=?").get(name) as any)?.id
    ?? (db().prepare("SELECT id FROM markers WHERE name=? COLLATE NOCASE").get(name) as any)?.id ?? null;
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  // Only the connector's own in-process calls (from localhost) can carry the tag.
  app.use((req, _res, next) => (req.header("x-via") === "claude" && req.socket.remoteAddress?.match(/^(::ffff:)?127\.0\.0\.1$|^::1$/) ? viaClaude.run(true, next) : next()));

  // --- the Claude connector (outside the Google login; the key is the lock) ---
  app.all(["/mcp", "/mcp/:key"], (req, res) => {
    handleMcp(req, res).catch((e) => { console.error("[mcp]", e); if (!res.headersSent) res.status(500).json({ error: "connector error" }); });
  });

  // --- Claude access keys (behind the Google login like the rest of /api) ---
  app.get("/api/keys", (_req, res) => res.json({ keys: listKeys() }));
  app.post("/api/keys", wrap((req, res) => {
    const k = createKey(String(need(req.body.label, "label")).slice(0, 80));
    // Logged without the live-refresh ping: a re-render would wipe the page showing the key its one time.
    logActivity(`Created Claude access key "${k.label}"`);
    res.status(201).json(k);
  }));
  app.delete("/api/keys/:id", wrap((req, res) => {
    const k = listKeys().find((k) => k.id === req.params.id);
    if (!k || !revokeKey(k.id)) throw new Bad("key not found");
    changed(`Revoked Claude access key "${k.label}"`);
    res.json({ ok: true });
  }));

  // --- backlog: ideas for the app itself ---
  app.get("/api/backlog", (_req, res) => res.json({ backlog: listBacklog() }));
  app.post("/api/backlog", wrap((req, res) => {
    const item = addBacklog(String(need(req.body.title, "title")).trim(), req.body.details?.trim() || null, viaClaude.getStore() ? "claude" : "dashboard");
    changed(`Added to backlog: ${item.title}`);
    res.status(201).json(item);
  }));
  app.patch("/api/backlog/:id", wrap((req, res) => {
    if (req.body.status !== undefined && !["open", "done"].includes(req.body.status)) throw new Bad("status must be open or done");
    const item = updateBacklog(Number(req.params.id), pick(req.body, ["title", "details", "status"]) as any);
    if (!item) throw new Bad("backlog item not found");
    changed(req.body.status === "done" ? `Done: ${item.title}` : req.body.status === "open" ? `Reopened: ${item.title}` : `Updated backlog item: ${item.title}`);
    res.json(item);
  }));
  app.delete("/api/backlog/:id", wrap((req, res) => {
    const item = removeBacklog(Number(req.params.id));
    if (!item) throw new Bad("backlog item not found");
    changed(`Removed from backlog: ${item.title}`);
    res.json({ ok: true });
  }));

  app.get("/api/me", (req, res) => {
    const email = (req.header("X-Auth-Request-Email") || "").trim();
    res.json({ email: email || null });
  });
  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  app.get("/api/events", (req, res) => {
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    res.write(": hello\n\n");
    listeners.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
    req.on("close", () => { clearInterval(ping); listeners.delete(res); });
  });

  // --- reads ---
  app.get("/api/overview", wrap((req, res) => res.json(overview(req.query.date ? date(req.query.date, "date") : today()))));
  app.get("/api/day/:date", wrap((req, res) => {
    const d = day(date(req.params.date, "date"));
    res.json({ ...d, targets: targets().map((t) => progress(t, d.totals[t.nutrient] ?? 0)) });
  }));
  app.get("/api/trends", wrap((req, res) => {
    const days = req.query.days ? Math.min(730, Math.max(1, Math.round(num(req.query.days, "days")))) : 30;
    res.json({ ...dailySeries(days, req.query.end ? date(req.query.end, "end") : today()), targets: targets() });
  }));
  app.get("/api/nutrients", (_req, res) => res.json({ nutrients: nutrients() }));
  app.get("/api/foods", (req, res) => res.json({ foods: foods(req.query.archived === "1") }));
  app.get("/api/foods/:id", (req, res) => {
    const f = food(Number(req.params.id));
    if (!f) return res.status(404).json({ error: "food not found" });
    res.json(f);
  });
  app.get("/api/targets", (_req, res) => res.json({ targets: targets() }));
  app.get("/api/markers", (_req, res) => res.json({ markers: markers() }));
  app.get("/api/markers/:id", (req, res) => {
    const m = markerHistory(req.params.id);
    if (!m) return res.status(404).json({ error: "marker not found" });
    res.json(m);
  });
  app.get("/api/draws", (_req, res) => res.json({ draws: draws() }));
  app.get("/api/documents", (_req, res) =>
    res.json({ documents: db().prepare(`SELECT d.*,
        (SELECT COUNT(*) FROM lab_results r WHERE r.document_id=d.id) AS lab_results,
        (SELECT group_concat(DISTINCT s.food_id) FROM food_sources s WHERE s.document_id=d.id) AS food_ids
      FROM documents d ORDER BY COALESCE(d.doc_date, d.added_at) DESC, d.id DESC`).all() }));
  app.get("/api/activity", (_req, res) => res.json({ activity: db().prepare("SELECT * FROM activity ORDER BY id DESC LIMIT 200").all() }));
  app.get("/api/backups", (_req, res) => res.json({ backups: listBackups() }));

  // --- nutrients + targets ---
  app.post("/api/nutrients", wrap((req, res) => {
    const key = String(need(req.body.key, "key")).trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]*$/.test(key)) throw new Bad("key must be lowercase_with_underscores, e.g. vitamin_c");
    insert("nutrients", { key, name: String(need(req.body.name, "name")).trim(), unit: need(req.body.unit, "unit"), sort: req.body.sort ?? 100 });
    changed(`Added nutrient ${req.body.name} (${req.body.unit})`);
    res.status(201).json({ key });
  }));
  app.put("/api/targets/:nutrient", wrap((req, res) => {
    const amount = num(req.body.amount, "amount");
    const direction = req.body.direction ?? "about";
    if (!["at_least", "at_most", "about"].includes(direction)) throw new Bad("direction must be at_least, at_most or about");
    db().prepare(`INSERT INTO targets (nutrient, amount, direction) VALUES (?, ?, ?)
      ON CONFLICT (nutrient) DO UPDATE SET amount=excluded.amount, direction=excluded.direction`).run(req.params.nutrient, amount, direction);
    const t = targets().find((t) => t.nutrient === req.params.nutrient)!;
    changed(`Target ${t.name}: ${direction.replace("_", " ")} ${amount} ${t.unit}`);
    res.json({ ok: true });
  }));
  app.delete("/api/targets/:nutrient", wrap((req, res) => {
    const r = db().prepare("DELETE FROM targets WHERE nutrient=?").run(req.params.nutrient);
    if (!r.changes) throw new Bad("no target for that nutrient");
    changed(`Removed the ${req.params.nutrient} target`);
    res.json({ ok: true });
  }));

  // --- foods: details plus per-serving values, each set of values tagged with its source ---
  app.post("/api/foods", wrap((req, res) => {
    need(req.body.name, "name");
    const id = db().transaction(() => {
      const id = insert("foods", pick(req.body, FOOD));
      setNutrients(id, req.body.nutrients, req.body.source);
      return id;
    })();
    changed(`Added food ${foodName(id)}${req.body.source?.kind ? ` (from ${req.body.source.kind})` : ""}`);
    res.status(201).json({ id });
  }));
  app.patch("/api/foods/:id", wrap((req, res) => {
    const id = Number(req.params.id);
    if (!db().prepare("SELECT 1 FROM foods WHERE id=?").get(id)) throw new Bad("food not found");
    const fields = pick(req.body, FOOD);
    let n = 0;
    db().transaction(() => {
      if (Object.keys(fields).length) update("foods", "id", id, { ...fields, updated_at: new Date().toISOString().replace("T", " ").slice(0, 19) });
      n = setNutrients(id, req.body.nutrients, req.body.source);
      if (!Object.keys(fields).length && !n) throw new Bad("nothing to update");
    })();
    const parts = [Object.keys(fields).length ? describe(fields) : "", n ? `${Object.entries(req.body.nutrients).map(([k, v]) => `${k} → ${v ?? "—"}`).join(", ")}${req.body.source?.kind ? ` (from ${req.body.source.kind})` : ""}` : ""];
    changed(`Updated food ${foodName(id)}: ${parts.filter(Boolean).join("; ")}`);
    res.json({ ok: true });
  }));
  // Only a food that was never logged can go; one with history is archived instead.
  app.delete("/api/foods/:id", wrap((req, res) => {
    const name = foodName(req.params.id);
    if (db().prepare("SELECT 1 FROM food_log WHERE food_id=?").get(req.params.id)) throw new Bad("this food has been logged; archive it instead");
    const r = db().prepare("DELETE FROM foods WHERE id=?").run(req.params.id);
    if (!r.changes) throw new Bad("food not found");
    changed(`Removed food ${name}`);
    res.json({ ok: true });
  }));

  // --- food log ---
  app.post("/api/log", wrap((req, res) => {
    const b = { ...req.body, date: date(req.body.date ?? today(), "date"), servings: num(need(req.body.servings, "servings"), "servings") };
    need(b.food_id, "food_id");
    const id = insert("food_log", pick(b, LOG));
    changed(`Logged ${b.servings} × ${foodName(b.food_id)} on ${b.date}${b.meal ? ` (${b.meal})` : ""}`);
    res.status(201).json({ id });
  }));
  app.patch("/api/log/:id", wrap((req, res) => {
    const before = db().prepare("SELECT * FROM food_log WHERE id=?").get(req.params.id) as any;
    if (!before) throw new Bad("log entry not found");
    const fields = pick(req.body, LOG.filter((c) => c !== "food_id"));
    if (fields.date !== undefined) date(fields.date, "date");
    update("food_log", "id", req.params.id, fields);
    changed(`Updated ${foodName(before.food_id)} on ${before.date}: ${describe(fields)}`);
    res.json({ ok: true });
  }));
  app.delete("/api/log/:id", wrap((req, res) => {
    const before = db().prepare("SELECT * FROM food_log WHERE id=?").get(req.params.id) as any;
    if (!before) throw new Bad("log entry not found");
    db().prepare("DELETE FROM food_log WHERE id=?").run(req.params.id);
    changed(`Removed ${before.servings} × ${foodName(before.food_id)} from ${before.date}`);
    res.json({ ok: true });
  }));

  // --- markers: the canonical tests, and the names labs print for them ---
  app.post("/api/markers", wrap((req, res) => {
    const id = String(need(req.body.id, "id")).trim();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Bad("id must be lowercase-with-dashes, e.g. ldl-cholesterol");
    db().transaction(() => {
      insert("markers", { id, ...pick(req.body, MARKER), name: need(req.body.name, "name") });
      for (const a of [req.body.name, ...(req.body.aliases ?? [])]) db().prepare("INSERT OR IGNORE INTO marker_aliases (alias, marker_id) VALUES (?, ?)").run(String(a).trim(), id);
    })();
    changed(`Added marker ${req.body.name}${req.body.panel ? ` (${req.body.panel})` : ""}`);
    res.status(201).json({ id });
  }));
  app.patch("/api/markers/:id", wrap((req, res) => {
    const fields = pick(req.body, MARKER);
    update("markers", "id", req.params.id, fields);
    changed(`Updated marker ${req.params.id}: ${describe(fields)}`);
    res.json({ ok: true });
  }));
  app.post("/api/markers/:id/aliases", wrap((req, res) => {
    const alias = String(need(req.body.alias, "alias")).trim();
    const other = db().prepare("SELECT marker_id FROM marker_aliases WHERE alias=?").get(alias) as any;
    if (other && other.marker_id !== req.params.id) throw new Bad(`"${alias}" already means ${other.marker_id}`);
    db().prepare("INSERT OR IGNORE INTO marker_aliases (alias, marker_id) VALUES (?, ?)").run(alias, req.params.id);
    changed(`"${alias}" now maps to ${req.params.id}`);
    res.json({ ok: true });
  }));

  // --- lab results: one report's results at once ---
  // {drawn_on, lab?, document_id?, results: [{marker_id | name_on_report, value?, value_text?, unit?, ref_low?, ref_high?, ref_text?, flag?, notes?}]}
  // A result with no marker_id is matched by its printed name; the same marker, date and lab again replaces the old result.
  app.put("/api/labs", wrap((req, res) => {
    const drawn_on = date(req.body.drawn_on, "drawn_on");
    const lab = String(req.body.lab ?? "").trim();
    const rows = need(req.body.results, "results") as any[];
    if (!Array.isArray(rows) || !rows.length) throw new Bad("results must be a non-empty list");
    const resolved = rows.map((r) => ({ r, marker: resolveMarker(r) }));
    const missing = resolved.filter((x) => !x.marker).map((x) => x.r.marker_id ?? x.r.name_on_report ?? "(no name)");
    if (missing.length) throw new Bad(`no marker for: ${missing.join(", ")}. Add each with POST /api/markers (or an alias), then send again`);
    db().transaction(() => {
      for (const { r, marker } of resolved) {
        const value = r.value === undefined || r.value === null || r.value === "" ? null : num(r.value, `value for ${marker}`);
        const row = {
          ...pick(r, RESULT), drawn_on, lab, marker_id: marker, value,
          value_text: r.value_text ?? (value == null ? null : String(value)), document_id: r.document_id ?? req.body.document_id ?? null,
        };
        db().prepare(`INSERT INTO lab_results (${RESULT.join(", ")}) VALUES (${RESULT.map((c) => "@" + c).join(", ")})
          ON CONFLICT (marker_id, drawn_on, lab) DO UPDATE SET ${RESULT.filter((c) => !["marker_id", "drawn_on", "lab"].includes(c)).map((c) => `${c}=excluded.${c}`).join(", ")}`)
          .run(Object.fromEntries(RESULT.map((c) => [c, (row as any)[c] ?? null])));
        // The first result sets the unit a marker is charted in.
        db().prepare("UPDATE markers SET unit=? WHERE id=? AND unit IS NULL").run(r.unit ?? null, marker);
        if (r.name_on_report) db().prepare("INSERT OR IGNORE INTO marker_aliases (alias, marker_id) VALUES (?, ?)").run(String(r.name_on_report).trim(), marker);
      }
    })();
    changed(`Recorded ${rows.length} lab result${rows.length === 1 ? "" : "s"} from ${drawn_on}${lab ? ` (${lab})` : ""}`);
    res.json({ ok: true, count: rows.length });
  }));
  app.patch("/api/labs/:id", wrap((req, res) => {
    const fields = pick(req.body, RESULT.filter((c) => c !== "marker_id"));
    if (fields.drawn_on !== undefined) date(fields.drawn_on, "drawn_on");
    if ("lab" in fields && fields.lab === null) fields.lab = "";
    update("lab_results", "id", req.params.id, fields);
    changed(`Updated lab result #${req.params.id}: ${describe(fields)}`);
    res.json({ ok: true });
  }));
  app.delete("/api/labs/:id", wrap((req, res) => {
    const r = db().prepare("SELECT * FROM lab_results WHERE id=?").get(req.params.id) as any;
    if (!r) throw new Bad("lab result not found");
    db().prepare("DELETE FROM lab_results WHERE id=?").run(req.params.id);
    changed(`Removed ${r.marker_id} result from ${r.drawn_on}`);
    res.json({ ok: true });
  }));

  // --- supplements: the routine, by time of day ---
  app.get("/api/supplements", (_req, res) => res.json({ supplements: db().prepare("SELECT * FROM supplements ORDER BY id").all() }));
  app.post("/api/supplements", wrap((req, res) => {
    need(req.body.name, "name");
    const id = insert("supplements", supplementFields(req.body));
    changed(`Added supplement ${supplementName(id)}`);
    res.status(201).json({ id });
  }));
  app.patch("/api/supplements/:id", wrap((req, res) => {
    const fields = supplementFields(req.body);
    update("supplements", "id", req.params.id, fields);
    changed(fields.status === "stopped" ? `Stopped ${supplementName(req.params.id)}` : `Updated ${supplementName(req.params.id)}: ${describe(fields)}`);
    res.json({ ok: true });
  }));
  app.delete("/api/supplements/:id", wrap((req, res) => {
    const name = supplementName(req.params.id);
    const r = db().prepare("DELETE FROM supplements WHERE id=?").run(req.params.id);
    if (!r.changes) throw new Bad("supplement not found");
    changed(`Removed supplement ${name}`);
    res.json({ ok: true });
  }));

  // --- about me: the owner's own words, care to-dos and Claude's memories ---
  const source = () => (viaClaude.getStore() ? "claude" : "dashboard");
  app.get("/api/profile", (_req, res) => {
    const rows = db().prepare("SELECT section, value, updated_at FROM profile").all() as { section: string; value: string; updated_at: string }[];
    res.json({
      profile: Object.fromEntries(rows.map((r) => [r.section, r.value])),
      updated: Object.fromEntries(rows.map((r) => [r.section, r.updated_at])),
      todos: db().prepare("SELECT * FROM care_todos ORDER BY status = 'done', due_on IS NULL, due_on, id").all(),
      memories: db().prepare("SELECT * FROM memories ORDER BY id DESC").all(),
    });
  });
  app.put("/api/profile/:section", wrap((req, res) => {
    const section = req.params.section;
    if (!PROFILE.includes(section)) throw new Bad(`section must be one of ${PROFILE.join(", ")}`);
    const value = String(req.body.value ?? "").trim();
    if (value) db().prepare("INSERT INTO profile (section, value) VALUES (?, ?) ON CONFLICT(section) DO UPDATE SET value=excluded.value, updated_at=datetime('now')").run(section, value);
    else db().prepare("DELETE FROM profile WHERE section=?").run(section);
    changed(`${value ? "Updated" : "Cleared"} About me: ${section.replace("_", " ")}`);
    res.json({ ok: true });
  }));
  app.post("/api/todos", wrap((req, res) => {
    need(req.body.title, "title");
    const id = insert("care_todos", { ...todoFields(req.body), source: source() });
    changed(`Added care to-do: ${req.body.title}`);
    res.status(201).json({ id });
  }));
  app.patch("/api/todos/:id", wrap((req, res) => {
    const fields = todoFields(req.body);
    update("care_todos", "id", req.params.id, fields);
    const t = db().prepare("SELECT title FROM care_todos WHERE id=?").get(req.params.id) as { title: string };
    changed(fields.status === "done" ? `Done: ${t.title}` : `Updated care to-do: ${t.title}`);
    res.json({ ok: true });
  }));
  app.delete("/api/todos/:id", wrap((req, res) => {
    const t = db().prepare("SELECT title FROM care_todos WHERE id=?").get(req.params.id) as { title: string } | undefined;
    if (!t) throw new Bad("to-do not found");
    db().prepare("DELETE FROM care_todos WHERE id=?").run(req.params.id);
    changed(`Removed care to-do: ${t.title}`);
    res.json({ ok: true });
  }));
  app.post("/api/memories", wrap((req, res) => {
    const text = String(need(req.body.text, "text")).trim();
    const id = insert("memories", { text, source: source() });
    changed(`Remembered: ${text}`);
    res.status(201).json({ id });
  }));
  app.patch("/api/memories/:id", wrap((req, res) => {
    const text = String(need(req.body.text, "text")).trim();
    update("memories", "id", req.params.id, { text, updated_at: new Date().toISOString().slice(0, 19).replace("T", " ") });
    changed(`Updated memory: ${text}`);
    res.json({ ok: true });
  }));
  app.delete("/api/memories/:id", wrap((req, res) => {
    const r = db().prepare("DELETE FROM memories WHERE id=?").run(req.params.id);
    if (!r.changes) throw new Bad("memory not found");
    changed(`Forgot memory #${req.params.id}`);
    res.json({ ok: true });
  }));

  // --- documents: metadata is JSON; the file is a raw PUT body ---
  app.post("/api/documents", wrap((req, res) => {
    const id = insert("documents", pick(req.body, DOCUMENT));
    changed(`Catalogued ${[req.body.issuer, req.body.type].filter(Boolean).join(" ") || "document"} #${id}`);
    res.status(201).json({ id });
  }));
  app.patch("/api/documents/:id", wrap((req, res) => {
    const fields = pick(req.body, DOCUMENT);
    update("documents", "id", req.params.id, fields);
    changed(`Updated document #${req.params.id}: ${describe(fields)}`);
    res.json({ ok: true });
  }));
  app.put("/api/documents/:id/file", express.raw({ type: () => true, limit: "100mb" }), wrap((req, res) => {
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || !body.length) throw new Bad("empty file body");
    const name = cleanName(decodeURIComponent(String(req.header("X-Filename") || "file")));
    const sha = crypto.createHash("sha256").update(body).digest("hex");
    const ext = path.extname(name).toLowerCase().slice(0, 10);
    fs.writeFileSync(path.join(filesDir, sha + ext), body);
    update("documents", "id", req.params.id, {
      file_name: name, file_sha: sha, file_ext: ext, size: body.length,
      mime: req.header("Content-Type") || "application/octet-stream",
    });
    changed(`Stored file ${name} on document #${req.params.id}`);
    res.json({ ok: true, sha });
  }));
  app.get("/api/documents/:id/file", (req, res) => {
    const d = db().prepare("SELECT * FROM documents WHERE id=?").get(req.params.id) as any;
    if (!d?.file_sha) return res.status(404).json({ error: "no file stored for this document" });
    res.set("Content-Type", d.mime);
    const name = cleanName(String(d.file_name));
    res.set("Content-Disposition", `inline; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.sendFile(path.join(filesDir, d.file_sha + d.file_ext));
  });
  app.delete("/api/documents/:id", wrap((req, res) => {
    const d = db().prepare("SELECT * FROM documents WHERE id=?").get(req.params.id) as any;
    if (!d) throw new Bad("document not found");
    db().prepare("DELETE FROM documents WHERE id=?").run(req.params.id);
    // The file itself stays on disk and in backups; only the catalog row goes.
    changed(`Removed document #${d.id} (${d.description ?? d.file_name ?? ""})`);
    res.json({ ok: true });
  }));

  app.post("/api/backups", wrap(async (_req, res) => res.json(await runBackup())));

  app.use("/api", (_req, res) => res.status(404).json({ error: "not found" }));

  // --- the built PWA ---
  const dist = path.join(__dirname, "..", "..", "web", "dist");
  const distAlt = path.join(process.cwd(), "web", "dist");
  const root = fs.existsSync(dist) ? dist : distAlt;
  app.use(express.static(root, { index: false }));
  app.get("*", (_req, res) => {
    const index = path.join(root, "index.html");
    if (fs.existsSync(index)) res.sendFile(index);
    else res.status(503).send("PWA not built — run `npm --prefix web run build`.");
  });

  return app;
}

function wrap(fn: (req: Request, res: Response) => unknown) {
  return (req: Request, res: Response, _next: NextFunction) => {
    Promise.resolve()
      .then(() => fn(req, res))
      .catch((e: any) => {
        const client = e instanceof Bad || /constraint|FOREIGN KEY|UNIQUE|no such column/i.test(e?.message ?? "");
        if (!client) console.error(e);
        res.status(client ? 400 : 500).json({ error: e?.message ?? String(e) });
      });
  };
}
