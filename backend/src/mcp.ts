// The Claude connector: an MCP endpoint at /mcp (key in an `Authorization: Bearer`
// header) or /mcp/<key> (for claude.ai, whose custom connectors can't send a
// header). The edge lets /mcp through without the Google login, so the key is
// the only lock. Tools read the record, make safe edits (log food, save foods
// with their sources, set targets, record lab results, keep the supplement
// routine), file documents the chat
// was shown into the catalog, and keep the app's backlog. Nothing here deletes,
// and stored files never leave: a leaked key must not hand over lab reports.
// Each tool calls this app's own /api, so writes get the same checks, activity
// lines and live refresh as the dashboard, tagged "via Claude".
import type { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { config } from "./config";
import { checkKey } from "./keys";

async function api(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`http://127.0.0.1:${config.port}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-via": "claude" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  const error = (data as { error?: string }).error;
  if (!res.ok) throw new Error(/FOREIGN KEY/.test(error ?? "") ? "That id doesn't exist (food, nutrient, marker or document). List them first for the ids." : error ?? `${method} ${path} failed (${res.status})`);
  return data;
}

/** Run an API call and hand Claude the JSON, or the error as a tool error it can read and fix. */
const reply = (p: Promise<unknown>) =>
  p.then((d) => ({ content: [{ type: "text" as const, text: JSON.stringify(d, null, 1) }] }))
    .catch((e: Error) => ({ content: [{ type: "text" as const, text: e.message }], isError: true }));

/** Drop fields Claude left out, so a PATCH only touches what it meant to change. */
const defined = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

type Doc = { id: number; applied_to: string | null; file_sha: string | null; [k: string]: unknown };
const documents = () => api("GET", "/api/documents").then((d) => (d as { documents: Doc[] }).documents);
/** Catalog fields only: never the stored file or where it sits on disk. */
const summary = ({ id, doc_date, type, issuer, description, applied_to, notes, file_name, mime, file_sha, added_at, lab_results, food_ids }: Doc) =>
  ({ id, doc_date, type, issuer, description, applied_to, notes, file_name, mime, has_file: !!file_sha, added_at, lab_results, food_ids });
/** Claude fills in entries that aren't filed yet; once filed, changes go through the dashboard. */
async function unfiled(id: number): Promise<void> {
  const d = (await documents()).find((x) => x.id === id);
  if (!d) throw new Error(`No document ${id}. Call list_documents for the ids.`);
  if (d.applied_to) throw new Error(`Document ${id} is already filed ("${d.applied_to}"). Only entries not filed yet can be changed here.`);
}

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const MEAL = z.enum(["breakfast", "lunch", "dinner", "snack"]);
const SOURCE = z.object({
  kind: z.enum(["label", "usda", "web", "manual"]).describe("label = a nutrition-label photo; usda = USDA FoodData Central; web = a web page; manual = Steven told you"),
  document_id: z.number().int().optional().describe("label: the catalog entry of the photo"),
  fdc_id: z.string().optional().describe("usda: the FoodData Central id"),
  url: z.string().url().optional().describe("web: the page the values came from"),
  note: z.string().optional().describe("e.g. 'converted from %DV' or 'label lists 0g, rounded'"),
}).describe("Where these values came from. Every set of values needs one.");
const NUTRIENTS = z.record(z.string(), z.number().min(0)).describe("Per serving, keyed by nutrient key in that nutrient's unit (list_nutrients): {calories: 210, protein: 7, sodium: 140}");
const foodFields = {
  brand: z.string().optional(),
  serving_size: z.string().optional().describe("As printed, e.g. '2/3 cup (55 g)'"),
  serving_grams: z.number().positive().optional().describe("Grams (or mL) per serving"),
  servings_per_container: z.number().positive().optional(),
  upc: z.string().optional().describe("Barcode digits, if visible"),
  notes: z.string().optional(),
};
const RESULT = z.object({
  marker_id: z.string().optional().describe("Canonical marker id (list_markers). Leave out to match by name_on_report."),
  name_on_report: z.string().describe("The test name exactly as printed"),
  value: z.number().optional().describe("Numeric value; leave out for a text-only result"),
  value_text: z.string().optional().describe("As printed when not a plain number: '<0.5', 'Negative', '>90'"),
  unit: z.string().optional().describe("As printed, e.g. mg/dL"),
  ref_low: z.number().optional().describe("The report's own range, lower bound"),
  ref_high: z.number().optional().describe("The report's own range, upper bound"),
  ref_text: z.string().optional().describe("The range exactly as printed: '<100', '3.5-5.2', 'Negative'"),
  flag: z.string().optional().describe("The report's own flag, if any: H, L, A, Critical"),
  notes: z.string().optional(),
});

const supplementFields = {
  brand: z.string().optional(),
  dose: z.string().optional().describe("As written, e.g. '2 softgels', '1 scoop (10–20 g)'"),
  timing: z.enum(["waking", "breakfast", "midday", "dinner", "bedtime", "apart", "anytime"]).optional()
    .describe("waking = on waking, before breakfast; apart = away from meals; anytime = no set time"),
  frequency: z.string().optional().describe("e.g. 'Daily', 'Every other day'"),
  directions: z.string().optional().describe("How to take it, e.g. 'empty stomach, 2 h from coffee'"),
  purpose: z.string().optional(),
  recommended_by: z.string().optional(),
  bought_from: z.string().optional().describe("e.g. Fullscript"),
  status: z.enum(["taking", "planned", "stopped"]).optional().describe("planned = on the plan, not started yet"),
  started_on: DATE.optional(), stopped_on: DATE.optional(), notes: z.string().optional(),
  url: z.string().url().optional().describe("Product page of what he takes"),
  plan_product: z.string().optional().describe("When he takes a different product than his practitioner's plan named: the plan's product, e.g. 'O.N.E. Multivitamin (Pure Encapsulations)'"),
  plan_url: z.string().url().optional().describe("The plan's product page"),
};

function server(): McpServer {
  const s = new McpServer({ name: "health", version: "1.0.0" }, {
    instructions:
      "Steven's personal health record: what he eats (foods with per-serving nutrients, a daily food log, targets he sets) and his bloodwork over time. " +
      "Dates are YYYY-MM-DD in his local time. Read before you write, and say what you changed. Every edit shows up in the dashboard's Log, tagged via Claude. " +
      "This record tracks; it does not diagnose. Report values against the lab's own printed range and say when one is outside it, but don't interpret what it means medically; suggest he ask his doctor if he wants that. " +
      "Ideas for improving the dashboard itself go on its backlog (add_backlog_item).\n\n" +
      "Filing a document Steven shows you (a nutrition-label photo or a lab report, PDF or photo):\n" +
      "1. Read it fully. Never write his name, date of birth, address, MRN, account or accession numbers anywhere.\n" +
      "2. list_documents with unfiled_only: he uploads originals on the dashboard's Documents page, so match the file you were shown by file name and date and use that id; if none matches, catalog_document without id adds an entry with no file (tell him to upload the original). " +
      "catalog_document with type ('Nutrition label' or 'Lab report'), issuer (the brand, or the lab: Quest, Labcorp…), doc_date (date drawn, or the day of the photo) and a short description.\n" +
      "3a. Nutrition label: list_foods with a search first; if the food exists, update_food, else add_food. Give name, brand, serving_size as printed, serving_grams, and every nutrient the label lists, per serving, in the nutrient's unit, with source {kind:'label', document_id}. " +
      "If the label lists a nutrient not in list_nutrients, add_nutrient first. A value printed only as %DV: convert with the FDA daily value and say so in the source note. " +
      "Anything the label doesn't show (it's cut off, blurry, or a restaurant food with no label): look it up yourself in USDA FoodData Central (source kind 'usda' with fdc_id) or on the maker's page (kind 'web' with url), as a separate update_food call so each value keeps its own source. Never guess a number.\n" +
      "3b. Lab report: list_markers. Every result needs a canonical marker so the same test lines up across labs: reuse a marker when the test is the same (add_marker_alias for a new printed name, e.g. 'LDL Chol Calc (NIH)' → ldl-cholesterol); add_marker only for a test not on file. " +
      "Then record_lab_results once for the whole report with drawn_on (the collection date, not the report date), lab, document_id, and for each result: name_on_report as printed, value, unit, the printed reference range (ref_low/ref_high and ref_text) and any flag the lab printed. Copy values exactly; don't convert units.\n" +
      "4. mark_document_filed with exactly what it changed (e.g. 'Food #12 Chobani Greek yogurt: 11 values from label' or '24 results from Quest, 2026-10-14; 2 outside range: LDL, vitamin D').\n" +
      "5. Tell him in a few lines what it was and what changed; for labs, list any result outside its printed range and how it compares to the last time that marker was drawn.\n\n" +
      "Logging food: list_foods (or get_overview's recent_foods) for the id, then log_food with servings (convert grams with serving_grams). Not saved yet? Find the values (label, USDA or the maker's page), add_food with its source, then log it. " +
      "Targets are Steven's own; only set_target when he gives you a number.\n\n" +
      "Supplements: list_supplements is the routine he and his practitioner set, grouped by time of day. Record changes he tells you about with add_supplement or update_supplement " +
      "(status 'stopped' when he stops one, so the history stays); copy doses and directions as he or the plan words them.",
  });

  // --- reads ---
  s.registerTool("get_overview", {
    description: "Start here. Today's intake against his targets, the last 7 days' average, foods he logs most (for quick re-logging), the latest lab draw with anything outside its printed range, and how many uploaded documents aren't filed yet.",
    inputSchema: { date: DATE.optional().describe("Another day instead of today") },
    annotations: { readOnlyHint: true },
  }, ({ date }) => reply(api("GET", `/api/overview${date ? `?date=${date}` : ""}`)));
  s.registerTool("get_day", {
    description: "One day's food log: each entry with what it contributed, the day's totals, and progress against each target.",
    inputSchema: { date: DATE },
    annotations: { readOnlyHint: true },
  }, ({ date }) => reply(api("GET", `/api/day/${date}`)));
  s.registerTool("get_nutrition_trends", {
    description: "Daily totals for every logged day in a window (days with nothing logged are left out), plus the average over logged days and his targets.",
    inputSchema: { days: z.number().int().min(1).max(730).optional().describe("Window length, default 30"), end: DATE.optional() },
    annotations: { readOnlyHint: true },
  }, ({ days, end }) => reply(api("GET", `/api/trends?days=${days ?? 30}${end ? `&end=${end}` : ""}`)));
  s.registerTool("list_nutrients", {
    description: "Every nutrient key with its name and unit. Food values and targets use these keys and units.",
    annotations: { readOnlyHint: true },
  }, () => reply(api("GET", "/api/nutrients")));
  s.registerTool("list_foods", {
    description: "Saved foods with per-serving values, how often each was logged, and which kinds of source back them. Search before adding a food.",
    inputSchema: { search: z.string().optional().describe("Matches name or brand"), include_archived: z.boolean().optional() },
    annotations: { readOnlyHint: true },
  }, ({ search, include_archived }) => reply(api("GET", `/api/foods${include_archived ? "?archived=1" : ""}`).then((d) => {
    const q = search?.toLowerCase();
    const list = (d as { foods: { name: string; brand: string | null }[] }).foods;
    return { foods: q ? list.filter((f) => `${f.name} ${f.brand ?? ""}`.toLowerCase().includes(q)) : list };
  })));
  s.registerTool("get_food", {
    description: "One food: every per-serving value with the source behind it (label photo, USDA id or URL), and its recent log entries.",
    inputSchema: { id: z.number().int() },
    annotations: { readOnlyHint: true },
  }, ({ id }) => reply(api("GET", `/api/foods/${id}`)));
  s.registerTool("list_markers", {
    description: "Every lab marker (canonical test) with its panel, chart unit, the names labs print for it, its latest result against the printed range, and a compact history.",
    annotations: { readOnlyHint: true },
  }, () => reply(api("GET", "/api/markers")));
  s.registerTool("get_lab_history", {
    description: "One marker's every result, oldest first, each with the reference range its own report printed and whether it fell outside it.",
    inputSchema: { marker_id: z.string() },
    annotations: { readOnlyHint: true },
  }, ({ marker_id }) => reply(api("GET", `/api/markers/${encodeURIComponent(marker_id)}`)));
  s.registerTool("list_lab_draws", {
    description: "Each blood draw (date and lab), newest first: how many results, and which fell outside the report's own range.",
    annotations: { readOnlyHint: true },
  }, () => reply(api("GET", "/api/draws")));
  s.registerTool("get_recent_changes", {
    description: "The latest changes to the record, newest first (the dashboard's Log).",
    inputSchema: { limit: z.number().int().min(1).max(200).optional() },
    annotations: { readOnlyHint: true },
  }, ({ limit }) => reply(api("GET", "/api/activity").then((d) => ({ activity: (d as { activity: unknown[] }).activity.slice(0, limit ?? 30) }))));

  // --- safe edits (nothing deletes) ---
  s.registerTool("log_food", {
    description: "Log servings of a saved food on a day.",
    inputSchema: {
      food_id: z.number().int(), servings: z.number().positive().describe("In the food's servings; 1.5 is fine"),
      date: DATE.optional().describe("Default today"), meal: MEAL.optional(), notes: z.string().optional(),
    },
  }, (a) => reply(api("POST", "/api/log", defined(a))));
  s.registerTool("update_log_entry", {
    description: "Fix a food log entry's servings, day, meal or notes (get_day for the entry id).",
    inputSchema: { id: z.number().int(), servings: z.number().positive().optional(), date: DATE.optional(), meal: MEAL.optional(), notes: z.string().optional() },
  }, ({ id, ...rest }) => reply(api("PATCH", `/api/log/${id}`, defined(rest))));
  s.registerTool("add_food", {
    description: "Save a new food with its per-serving values and where they came from. list_foods first to avoid duplicates.",
    inputSchema: { name: z.string().min(1), ...foodFields, nutrients: NUTRIENTS, source: SOURCE },
  }, (a) => reply(api("POST", "/api/foods", defined(a))));
  s.registerTool("update_food", {
    description: "Change a food's details, or set some of its values from one source (values you leave out stay as they are). Set archived true to hide a food from quick re-log; it stays in the record.",
    inputSchema: {
      id: z.number().int(), name: z.string().optional(), ...foodFields, archived: z.boolean().optional(),
      nutrients: NUTRIENTS.optional(), source: SOURCE.optional().describe("Required with nutrients"),
    },
  }, ({ id, archived, nutrients, source, ...rest }) => {
    if (nutrients && !source) return reply(Promise.reject(new Error("Pass source with nutrients, so each value records where it came from.")));
    return reply(api("PATCH", `/api/foods/${id}`, defined({ ...rest, nutrients, source, archived: archived === undefined ? undefined : Number(archived) })));
  });
  s.registerTool("add_nutrient", {
    description: "Add a nutrient a label lists that isn't in list_nutrients yet (e.g. magnesium, caffeine).",
    inputSchema: {
      key: z.string().regex(/^[a-z][a-z0-9_]*$/, "lowercase_with_underscores").describe("e.g. magnesium, vitamin_b12"),
      name: z.string(), unit: z.enum(["kcal", "g", "mg", "mcg"]),
    },
  }, (a) => reply(api("POST", "/api/nutrients", a)));
  s.registerTool("set_target", {
    description: "Set one of Steven's daily targets, only with a number he gave you. direction: at_least (protein, fiber), at_most (sodium, added sugar), about (calories).",
    inputSchema: { nutrient: z.string().describe("Nutrient key"), amount: z.number().min(0), direction: z.enum(["at_least", "at_most", "about"]) },
  }, ({ nutrient, ...rest }) => reply(api("PUT", `/api/targets/${encodeURIComponent(nutrient)}`, rest)));
  s.registerTool("add_marker", {
    description: "Add a canonical lab marker for a test not on file yet (check list_markers first). Results from any lab then line up under it.",
    inputSchema: {
      id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase-with-dashes").describe("e.g. ldl-cholesterol, hba1c, vitamin-d-25-oh"),
      name: z.string().describe("Plain name, e.g. 'LDL cholesterol'"),
      panel: z.string().optional().describe("e.g. Lipid panel, CMP, CBC, Thyroid, Vitamins, Hormones"),
      unit: z.string().optional().describe("The unit to chart it in; defaults to the first result's unit"),
      aliases: z.array(z.string()).optional().describe("Names labs print for it"),
    },
  }, (a) => reply(api("POST", "/api/markers", defined(a))));
  s.registerTool("add_marker_alias", {
    description: "Map another printed test name to an existing marker, so a new lab's results line up with the old ones.",
    inputSchema: { marker_id: z.string(), alias: z.string() },
  }, ({ marker_id, alias }) => reply(api("POST", `/api/markers/${encodeURIComponent(marker_id)}/aliases`, { alias })));
  s.registerTool("record_lab_results", {
    description: "Record one report's results at once. Each result is matched to a marker by marker_id or its printed name; recording the same marker, date and lab again replaces that result.",
    inputSchema: {
      drawn_on: DATE.describe("The collection date"), lab: z.string().optional().describe("Quest, Labcorp…"),
      document_id: z.number().int().optional().describe("The catalog entry of the report"),
      results: z.array(RESULT).min(1),
    },
  }, (a) => reply(api("PUT", "/api/labs", defined(a))));

  // --- supplements ---
  s.registerTool("list_supplements", {
    description: "His supplement routine: each product with dose, time of day, how often, directions, why, who recommended it, where he buys it, and whether he's taking it, plans to, or stopped.",
    annotations: { readOnlyHint: true },
  }, () => reply(api("GET", "/api/supplements")));
  s.registerTool("add_supplement", {
    description: "Add a supplement to his routine. list_supplements first to avoid duplicates.",
    inputSchema: { name: z.string().min(1), ...supplementFields },
  }, (a) => reply(api("POST", "/api/supplements", defined(a))));
  s.registerTool("update_supplement", {
    description: "Change a supplement's dose, timing, directions or status. Set status 'stopped' when he stops one (the stop date defaults to today).",
    inputSchema: { id: z.number().int(), name: z.string().optional(), ...supplementFields },
  }, ({ id, ...rest }) => reply(api("PATCH", `/api/supplements/${id}`, defined(rest))));

  // --- documents: the catalog, never the stored files ---
  s.registerTool("list_documents", {
    description: "The document catalog, newest first: type, issuer, date, description, what it changed, and whether an original file is stored. File contents are never available here.",
    inputSchema: { unfiled_only: z.boolean().optional().describe("Only entries uploaded but not filed yet"), limit: z.number().int().min(1).max(500).optional() },
    annotations: { readOnlyHint: true },
  }, ({ unfiled_only, limit }) => reply(documents().then((ds) => ({
    documents: ds.filter((d) => !unfiled_only || !d.applied_to).slice(0, limit ?? 50).map(summary),
  }))));
  s.registerTool("catalog_document", {
    description: "Describe a document in the catalog. With id, fills in an entry not filed yet (one Steven uploaded); without, adds a new entry with no file. Returns the id to pass as document_id.",
    inputSchema: {
      id: z.number().int().optional(), type: z.string().describe("'Nutrition label' or 'Lab report'"), issuer: z.string().describe("The brand, or the lab"),
      doc_date: DATE.describe("Date drawn, or the day of the photo"),
      description: z.string().describe("Short, e.g. 'Quest CMP + lipid panel' or 'Chobani plain Greek yogurt label'"), notes: z.string().optional(),
    },
  }, ({ id, ...fields }) => reply(id === undefined
    ? api("POST", "/api/documents", defined(fields))
    : unfiled(id).then(() => api("PATCH", `/api/documents/${id}`, defined(fields))).then(() => ({ id }))));
  s.registerTool("mark_document_filed", {
    description: "Last step of filing: record exactly what the document changed. It then shows as filed.",
    inputSchema: { id: z.number().int(), applied_to: z.string().min(3) },
  }, ({ id, applied_to }) => reply(unfiled(id).then(() => api("PATCH", `/api/documents/${id}`, { applied_to })).then(() => ({ ok: true, id, applied_to }))));

  // --- the app's backlog ---
  s.registerTool("list_backlog", {
    description: "Ideas for improving the health dashboard itself, open ones first.",
    inputSchema: { include_done: z.boolean().optional() },
    annotations: { readOnlyHint: true },
  }, ({ include_done }) => reply(api("GET", "/api/backlog").then((d) => {
    const items = (d as { backlog: { status: string }[] }).backlog;
    return { backlog: include_done ? items.sort((a, b) => Number(a.status === "done") - Number(b.status === "done")) : items.filter((i) => i.status === "open") };
  })));
  s.registerTool("add_backlog_item", {
    description: "Add an idea for improving the health dashboard (a feature, a fix, a better view) to its Backlog page. Check list_backlog first to avoid duplicates.",
    inputSchema: { title: z.string().min(3).max(200).describe("Short, in plain words"), details: z.string().max(4000).optional().describe("Why, and what done looks like") },
  }, (a) => reply(api("POST", "/api/backlog", defined(a))));
  return s;
}

/** POST /mcp or /mcp/:key. Stateless: a fresh server per request, nothing kept between calls. */
export async function handleMcp(req: Request, res: Response): Promise<void> {
  const bearer = req.header("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!checkKey(req.params.key ?? bearer)) {
    res.status(401).json({ error: "missing, wrong or revoked key" });
    return;
  }
  if (req.method !== "POST") {
    res.status(405).set("Allow", "POST").json({ error: "use POST" });
    return;
  }
  const s = server();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => { transport.close(); s.close(); });
  await s.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
