// Every derived number: a day's intake, progress against targets, daily trends,
// and where each lab result sits against the report's own range. The PWA and
// the connector only display what this returns.
import { db } from "./store";

export const today = () => new Date().toLocaleDateString("en-CA");
/** "2026-11-03" minus n days. */
export const daysBefore = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString("en-CA");
};

export type Nutrient = { key: string; name: string; unit: string; sort: number };
export type Totals = Record<string, number>;

export const nutrients = () => db().prepare("SELECT * FROM nutrients ORDER BY sort, name").all() as Nutrient[];

/** Each food's nutrients per serving, keyed by food id. */
function perServing(foodIds?: number[]): Map<number, Totals> {
  const rows = db().prepare("SELECT food_id, nutrient, amount FROM food_nutrients").all() as { food_id: number; nutrient: string; amount: number }[];
  const out = new Map<number, Totals>();
  for (const r of rows) {
    if (foodIds && !foodIds.includes(r.food_id)) continue;
    if (!out.has(r.food_id)) out.set(r.food_id, {});
    out.get(r.food_id)![r.nutrient] = r.amount;
  }
  return out;
}

const round = (n: number) => Math.round(n * 10) / 10;
function add(into: Totals, from: Totals, times: number): void {
  for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v * times;
}
const rounded = (t: Totals) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, round(v)]));

export type Source = { id: number; kind: "label" | "usda" | "web" | "manual"; document_id: number | null; fdc_id: string | null; url: string | null; note: string | null; recorded_at: string };

/** Every food with its per-serving values, how often it's been logged, and when last. */
export function foods(includeArchived = false) {
  const list = db().prepare(
    `SELECT f.*, (SELECT COUNT(*) FROM food_log l WHERE l.food_id=f.id) AS times_logged,
       (SELECT MAX(date) FROM food_log l WHERE l.food_id=f.id) AS last_logged,
       (SELECT group_concat(DISTINCT s.kind) FROM food_sources s JOIN food_nutrients n ON n.source_id=s.id WHERE n.food_id=f.id) AS source_kinds
     FROM foods f WHERE (@all OR f.archived=0) ORDER BY f.archived, f.name COLLATE NOCASE`
  ).all({ all: includeArchived ? 1 : 0 }) as any[];
  const per = perServing();
  return list.map((f) => ({ ...f, nutrients: per.get(f.id) ?? {} }));
}

/** One food: per-serving values with the source behind each, and every source on record. */
export function food(id: number) {
  const f = db().prepare("SELECT * FROM foods WHERE id=?").get(id) as any;
  if (!f) return null;
  const values = db().prepare(
    `SELECT n.nutrient, n.amount, n.source_id, u.name, u.unit FROM food_nutrients n JOIN nutrients u ON u.key=n.nutrient
     WHERE n.food_id=? ORDER BY u.sort, u.name`
  ).all(id);
  const sources = db().prepare(
    `SELECT s.*, d.description AS document, d.file_sha IS NOT NULL AS has_file FROM food_sources s
     LEFT JOIN documents d ON d.id=s.document_id WHERE s.food_id=? ORDER BY s.id DESC`
  ).all(id);
  const log = db().prepare("SELECT id, date, meal, servings FROM food_log WHERE food_id=? ORDER BY date DESC, id DESC LIMIT 30").all(id);
  return { ...f, values, sources, recent_log: log };
}

/** A day's entries with what each contributed, and the day's totals. */
export function day(date: string) {
  const entries = db().prepare(
    `SELECT l.*, f.name, f.brand, f.serving_size FROM food_log l JOIN foods f ON f.id=l.food_id WHERE l.date=? ORDER BY l.logged_at, l.id`
  ).all(date) as any[];
  const per = perServing(entries.map((e) => e.food_id));
  const totals: Totals = {};
  const out = entries.map((e) => {
    const n: Totals = {};
    add(n, per.get(e.food_id) ?? {}, e.servings);
    add(totals, n, 1);
    return { ...e, nutrients: rounded(n) };
  });
  return { date, entries: out, totals: rounded(totals) };
}

export type Target = { nutrient: string; amount: number; direction: "at_least" | "at_most" | "about"; name: string; unit: string };
export const targets = () => db().prepare(
  "SELECT t.*, n.name, n.unit FROM targets t JOIN nutrients n ON n.key=t.nutrient ORDER BY n.sort, n.name"
).all() as Target[];

/**
 * Where a total sits against a target. "about" counts within 10% as on target;
 * "at_least" is met at the target; "at_most" is over past it.
 */
export function progress(t: Target, total: number) {
  const share = t.amount > 0 ? total / t.amount : null;
  const status = t.direction === "at_least" ? (total >= t.amount ? "met" : "under")
    : t.direction === "at_most" ? (total > t.amount ? "over" : "ok")
    : share == null ? "ok" : share < 0.9 ? "under" : share > 1.1 ? "over" : "met";
  return { ...t, total: round(total), share, remaining: round(t.amount - total), status };
}

/** Totals for every day with at least one entry, oldest first. Days with nothing logged are left out, not zero. */
export function dailySeries(days: number, end = today()) {
  const from = daysBefore(end, days - 1);
  const rows = db().prepare(
    `SELECT l.date, n.nutrient, SUM(n.amount * l.servings) AS amount, COUNT(DISTINCT l.id) AS entries FROM food_log l
     JOIN food_nutrients n ON n.food_id=l.food_id WHERE l.date BETWEEN ? AND ? GROUP BY l.date, n.nutrient ORDER BY l.date`
  ).all(from, end) as { date: string; nutrient: string; amount: number }[];
  const logged = db().prepare("SELECT DISTINCT date FROM food_log WHERE date BETWEEN ? AND ? ORDER BY date").all(from, end) as { date: string }[];
  const by = new Map<string, Totals>(logged.map((d) => [d.date, {}]));
  for (const r of rows) by.get(r.date)![r.nutrient] = round(r.amount);
  const series = [...by].map(([date, totals]) => ({ date, totals }));
  // Averages over the days that were logged.
  const avg: Totals = {};
  for (const p of series) add(avg, p.totals, 1 / series.length);
  return { from, to: end, days_logged: series.length, average: rounded(avg), series };
}

/** Foods logged recently, most-logged first, with the servings and meal last used: the quick re-log list. */
export function recentFoods(limit = 12, end = today()) {
  const rows = db().prepare(
    `SELECT f.id, f.name, f.brand, f.serving_size, COUNT(*) AS times, MAX(l.date) AS last_date,
       (SELECT servings FROM food_log x WHERE x.food_id=f.id ORDER BY x.date DESC, x.id DESC LIMIT 1) AS last_servings,
       (SELECT meal FROM food_log x WHERE x.food_id=f.id ORDER BY x.date DESC, x.id DESC LIMIT 1) AS last_meal
     FROM food_log l JOIN foods f ON f.id=l.food_id WHERE f.archived=0 AND l.date >= ?
     GROUP BY f.id ORDER BY times DESC, last_date DESC LIMIT ?`
  ).all(daysBefore(end, 30), limit) as any[];
  const per = perServing(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, calories: per.get(r.id)?.calories ?? null }));
}

// --- labs ---

export type LabResult = {
  id: number; drawn_on: string; lab: string; marker_id: string; name_on_report: string | null; value: number | null;
  value_text: string | null; unit: string | null; ref_low: number | null; ref_high: number | null; ref_text: string | null;
  flag: string | null; document_id: number | null; notes: string | null;
};

/** Below or above the report's own range, or flagged by the lab itself. No ranges of our own. */
export function rangeOf(r: LabResult): "low" | "high" | "flagged" | "in" | "unknown" {
  if (r.value != null && r.ref_low != null && r.value < r.ref_low) return "low";
  if (r.value != null && r.ref_high != null && r.value > r.ref_high) return "high";
  if (r.flag && !/^(n|normal)$/i.test(r.flag.trim())) return "flagged";
  if (r.value != null && (r.ref_low != null || r.ref_high != null)) return "in";
  return "unknown";
}
export const outOfRange = (r: LabResult) => ["low", "high", "flagged"].includes(rangeOf(r));
const withRange = (r: LabResult) => ({ ...r, range: rangeOf(r), out_of_range: outOfRange(r) });

/** Every marker with its aliases, latest result, and how many results are on file. */
export function markers() {
  const ms = db().prepare("SELECT * FROM markers ORDER BY COALESCE(panel, 'zzz'), sort, name").all() as any[];
  const aliases = db().prepare("SELECT * FROM marker_aliases ORDER BY alias").all() as { alias: string; marker_id: string }[];
  const results = db().prepare("SELECT * FROM lab_results ORDER BY drawn_on, id").all() as LabResult[];
  return ms.map((m) => {
    const mine = results.filter((r) => r.marker_id === m.id);
    const latest = mine[mine.length - 1];
    return {
      ...m, aliases: aliases.filter((a) => a.marker_id === m.id).map((a) => a.alias),
      count: mine.length, latest: latest ? withRange(latest) : null,
      history: mine.map((r) => ({ drawn_on: r.drawn_on, value: r.value, unit: r.unit, ref_low: r.ref_low, ref_high: r.ref_high, out_of_range: outOfRange(r) })),
    };
  });
}

/** One marker's full history, oldest first, each result against its own report's range. */
export function markerHistory(id: string) {
  const m = db().prepare("SELECT * FROM markers WHERE id=?").get(id) as any;
  if (!m) return null;
  const aliases = (db().prepare("SELECT alias FROM marker_aliases WHERE marker_id=? ORDER BY alias").all(id) as { alias: string }[]).map((a) => a.alias);
  const results = (db().prepare(
    `SELECT r.*, d.description AS document FROM lab_results r LEFT JOIN documents d ON d.id=r.document_id
     WHERE r.marker_id=? ORDER BY r.drawn_on, r.id`
  ).all(id) as LabResult[]).map(withRange);
  return { marker: { ...m, aliases }, results };
}

/** Each draw (date + lab): how many results and which fell outside the report's range. */
export function draws() {
  const rows = (db().prepare(
    `SELECT r.*, m.name AS marker FROM lab_results r JOIN markers m ON m.id=r.marker_id ORDER BY r.drawn_on DESC, m.sort, m.name`
  ).all() as (LabResult & { marker: string })[]);
  const by = new Map<string, { drawn_on: string; lab: string; results: number; out_of_range: { marker_id: string; marker: string; value: number | null; value_text: string | null; unit: string | null; ref_text: string | null; range: string }[] }>();
  for (const r of rows) {
    const k = `${r.drawn_on}|${r.lab}`;
    if (!by.has(k)) by.set(k, { drawn_on: r.drawn_on, lab: r.lab, results: 0, out_of_range: [] });
    const d = by.get(k)!;
    d.results++;
    if (outOfRange(r)) d.out_of_range.push({ marker_id: r.marker_id, marker: r.marker, value: r.value, value_text: r.value_text, unit: r.unit, ref_text: r.ref_text, range: rangeOf(r) });
  }
  return [...by.values()];
}

export function overview(date = today()) {
  const d = day(date);
  const ts = targets();
  const unfiled = db().prepare("SELECT COUNT(*) AS n FROM documents WHERE applied_to IS NULL OR applied_to=''").get() as { n: number };
  const week = dailySeries(7, date);
  return {
    date,
    totals: d.totals,
    entries: d.entries.length,
    targets: ts.map((t) => progress(t, d.totals[t.nutrient] ?? 0)),
    week: { days_logged: week.days_logged, average: week.average },
    recent_foods: recentFoods(12, date),
    latest_draw: draws()[0] ?? null,
    unfiled_documents: unfiled.n,
    activity: db().prepare("SELECT * FROM activity ORDER BY id DESC LIMIT 8").all(),
  };
}
