import type { View } from "@brainbot/web-toolkit/shell";
import { button, table } from "@brainbot/web-toolkit/components";
import { api, send, type Food, type FoodDetail, type Nutrient, type Source, type Trends } from "../api";
import { amt, cap, day, h, num, shortDay, todayIso } from "../fmt";
import { barChart } from "../chart";
import { editable, parseNum } from "../edit";
import { icon } from "../icons";
import { muted, pageHead, removeBtn, section, tile, tiles, withTip } from "../ui";
import { DIRECTION } from "./today";

// Kept across live refreshes, so a re-render doesn't reset the chart you were looking at.
let windowDays = 30;
let shown = "calories";
let showArchived = false;

/** Trends over time, then the library of saved foods. */
export const FoodView = (): View => ({
  async mount(el) {
    const [t, foods, ns] = await Promise.all([api.trends(windowDays, todayIso()), api.foods(showArchived), api.nutrients()]);
    el.replaceChildren(
      pageHead("Food", "What you've eaten over time against your targets, and every food you've saved, with where each value came from."),
      ...trends(t, ns),
      library(foods),
      addFood(ns),
    );
  },
});

function trends(t: Trends, ns: Nutrient[]): HTMLElement[] {
  const unit = new Map(ns.map((n) => [n.key, n.unit]));
  const target = new Map(t.targets.map((x) => [x.nutrient, x]));
  const pickDays = h("select", { class: "fn-input", "aria-label": "Window" }, ...[7, 30, 90, 365].map((d) =>
    h("option", { value: String(d), ...(d === windowDays ? { selected: "" } : {}) }, d === 365 ? "Last year" : `Last ${d} days`)));
  pickDays.addEventListener("change", () => { windowDays = Number(pickDays.value); rerender(); });
  // Only nutrients that show up in the window (or have a target) are worth charting.
  const present = ns.filter((n) => n.key in t.average || target.has(n.key));
  if (!present.some((n) => n.key === shown)) shown = present[0]?.key ?? "calories";
  const pickNutrient = h("select", { class: "fn-input", "aria-label": "Nutrient" }, ...present.map((n) =>
    h("option", { value: n.key, ...(n.key === shown ? { selected: "" } : {}) }, n.name)));
  pickNutrient.addEventListener("change", () => { shown = pickNutrient.value; rerender(); });

  const avgTile = (key: string, label: string, ic: string) => {
    const tg = target.get(key);
    return tile({ label: `${label}, daily average`, value: amt(t.average[key] ?? 0, unit.get(key) ?? ""), icon: ic,
      sub: tg ? `target ${DIRECTION[tg.direction]} ${amt(tg.amount, tg.unit)}` : undefined, tone: "accent" });
  };
  const tg = target.get(shown) ?? null;
  const name = ns.find((n) => n.key === shown)?.name ?? shown;
  return [
    h("div", { class: "fn-row fn-controls" }, pickDays, h("span", { class: "fn-muted" }, `${t.days_logged} day${t.days_logged === 1 ? "" : "s"} logged, ${shortDay(t.from)} to ${shortDay(t.to)}. Averages count logged days only.`)),
    tiles(avgTile("calories", "Calories", "flame"), avgTile("protein", "Protein", "egg"), avgTile("carbs", "Carbs", "wheat"), avgTile("fat", "Fat", "drop")),
    section(h("span", { class: "fn-grow" }, `${name} per day`, pickNutrient),
      t.series.length
        ? barChart(t.series.map((p) => ({ label: shortDay(p.date), title: day(p.date), value: p.totals[shown] ?? 0 })), { unit: unit.get(shown) ?? "", target: tg })
        : muted("Nothing logged in this window."),
      tg ? h("p", { class: "fn-muted fn-legendline" }, h("i", { class: "fn-target-key" }), ` Target: ${DIRECTION[tg.direction]} ${amt(tg.amount, tg.unit)}`) : null),
  ];
}

const rerender = () => window.dispatchEvent(new Event("fn-rerender"));

const SOURCE_WORD: Record<Source["kind"], string> = { label: "Label", usda: "USDA", web: "Web", manual: "Typed in" };
const sourcePills = (kinds: string | null) => h("span", { class: "fn-row fn-tight" },
  ...(kinds ? kinds.split(",") : []).map((k) => h("span", { class: `fn-pill fn-pill-sm fn-src fn-src-${k}` }, SOURCE_WORD[k as Source["kind"]] ?? k)));

function library(foods: Food[]): HTMLElement {
  const toggle = h("label", { class: "fn-check" }, h("input", { type: "checkbox", ...(showArchived ? { checked: "" } : {}) }), " Show archived");
  toggle.querySelector("input")!.addEventListener("change", (e) => { showArchived = (e.target as HTMLInputElement).checked; rerender(); });
  const f = (n: number | undefined, u: string) => (n == null ? "—" : amt(n, u));
  return section(h("span", { class: "fn-grow" }, `Library (${foods.length})`, toggle),
    foods.length ? table({
      columns: ["Food", "Serving", "Calories", "Protein", "Carbs", "Fat", "Values from", "Logged", ""],
      rows: foods.map((x) => [
        h("div", { class: x.archived ? "fn-off" : "" }, h("a", { href: `#food/${x.id}` }, x.name), x.brand ? h("small", { class: "fn-sub" }, x.brand) : null),
        x.serving_size ?? "—",
        f(x.nutrients.calories, "kcal"), f(x.nutrients.protein, "g"), f(x.nutrients.carbs, "g"), f(x.nutrients.fat, "g"),
        sourcePills(x.source_kinds),
        x.times_logged ? `${x.times_logged}× · ${day(x.last_logged)}` : "Never",
        quickAdd(x),
      ]),
      sortable: true,
    }) : muted("No foods yet. Send Claude a photo of a nutrition label, or add one below."));
}

function quickAdd(f: Food): HTMLElement {
  const b = h("button", { class: "fn-x fn-plus", title: `Log 1 × ${f.name} today`, "aria-label": `Log 1 × ${f.name} today` }, icon("plus", 15));
  b.addEventListener("click", () => api.log({ food_id: f.id, servings: 1, date: todayIso() }).catch((e) => alert(e.message)));
  return b;
}

/** Save a food by hand: details plus the common label values. Claude fills in the rest from a label or USDA. */
function addFood(ns: Nutrient[]): HTMLElement {
  const field = (ph: string, mode = "text") => h("input", { class: "fn-input", placeholder: ph, inputmode: mode, "aria-label": ph });
  const name = field("Name"), brand = field("Brand (optional)"), serving = field("Serving, e.g. 1 cup (240 mL)"), grams = field("Grams per serving", "decimal");
  const common = ["calories", "protein", "carbs", "fat", "fiber", "sugar", "sodium"].map((k) => ns.find((n) => n.key === k)).filter((n): n is Nutrient => !!n);
  const values = common.map((n) => [n.key, field(`${n.name} (${n.unit})`, "decimal")] as const);
  const save = button({ label: "Save food", variant: "primary", onClick: async () => {
    if (!name.value.trim()) return name.focus();
    try {
      const nutrients = Object.fromEntries(values.map(([k, i]) => [k, parseNum(i.value.trim())]).filter(([, v]) => v != null));
      const { id } = await send<{ id: number }>("POST", "/api/foods", {
        name: name.value.trim(), brand: brand.value.trim() || null, serving_size: serving.value.trim() || null,
        serving_grams: parseNum(grams.value.trim()), nutrients, source: { kind: "manual" },
      });
      location.hash = `#food/${id}`;
    } catch (e) { alert((e as Error).message); }
  } });
  return section("Add a food by hand",
    h("p", { class: "fn-muted fn-note" }, "Per serving. For a packaged food it's easier to photograph the label and let Claude file it, so every value keeps its source."),
    h("div", { class: "fn-form-grid" }, name, brand, serving, grams, ...values.map(([, i]) => i)), save);
}

// --- one food ---

export const FoodDetailView = (): View => ({
  async mount(el) {
    const id = Number(location.hash.match(/^#food\/(\d+)/)?.[1]);
    const [f, ns] = await Promise.all([api.food(id), api.nutrients()]);
    const patch = (body: object) => send("PATCH", `/api/foods/${id}`, body);
    const text = (col: keyof FoodDetail, label: string, numeric = false) => h("div", { class: "fn-fact" }, h("span", {}, label),
      editable({ value: (f[col] as string | number | null) ?? "", display: f[col] == null || f[col] === "" ? "Add" : String(f[col]), empty: f[col] == null,
        type: numeric ? "number" : "text", save: (v) => patch({ [col]: numeric ? parseNum(v) : v || null }) }));
    const archive = button({ label: f.archived ? "Unarchive" : "Archive", onClick: () => patch({ archived: f.archived ? 0 : 1 }).catch((e) => alert(e.message)) });
    const del = f.recent_log.length ? null : button({ label: "Delete", variant: "danger", onClick: async () => {
      if (!confirm(`Delete ${f.name}? It has never been logged.`)) return;
      await send("DELETE", `/api/foods/${id}`).then(() => { location.hash = "#food"; }).catch((e) => alert(e.message));
    } });
    const byId = new Map(f.sources.map((s) => [s.id, s]));
    el.replaceChildren(
      h("a", { class: "fn-back", href: "#food" }, icon("left", 14), " Food"),
      pageHead(f.name, [f.brand, f.serving_size && `per ${f.serving_size}`, f.archived ? "archived" : null].filter(Boolean).join(" · ") || undefined),
      section("Details", h("div", { class: "fn-facts" },
        text("name", "Name"), text("brand", "Brand"), text("serving_size", "Serving (as printed)"), text("serving_grams", "Grams per serving", true),
        text("servings_per_container", "Servings per container", true), text("upc", "Barcode"), text("notes", "Notes")),
        h("div", { class: "fn-row" }, archive, del)),
      section(`Per serving (${f.values.length} values)`,
        f.values.length ? table({
          columns: ["Nutrient", "Amount", "From"],
          rows: f.values.map((v) => [v.name,
            editable({ value: v.amount, display: amt(v.amount, v.unit), type: "number",
              save: (x) => patch({ nutrients: { [v.nutrient]: parseNum(x) }, source: { kind: "manual" } }) }),
            sourceCell(v.source_id == null ? null : byId.get(v.source_id) ?? null)]),
        }) : muted("No values yet."),
        addValue(ns.filter((n) => !f.values.some((v) => v.nutrient === n.key)), patch)),
      section(`Logged (${f.recent_log.length}${f.recent_log.length === 30 ? "+" : ""})`, f.recent_log.length
        ? table({ columns: ["Day", "Meal", "Servings"], rows: f.recent_log.map((l) => [h("a", { href: `#day/${l.date}` }, day(l.date)), l.meal ? cap(l.meal) : "—", num(l.servings, 2)]) })
        : muted("Never logged.")),
    );
  },
});

function sourceCell(s: Source | null): Node {
  if (!s) return muted("—");
  const pill = h("span", { class: `fn-pill fn-pill-sm fn-src fn-src-${s.kind}` }, SOURCE_WORD[s.kind]);
  const href = s.kind === "label" && s.document_id && s.has_file ? `/api/documents/${s.document_id}/file`
    : s.kind === "usda" && s.fdc_id ? `https://fdc.nal.usda.gov/food-details/${encodeURIComponent(s.fdc_id)}/nutrients`
    : s.kind === "web" && s.url ? s.url : null;
  const what = s.kind === "label" ? (s.document ?? (s.document_id ? `Document #${s.document_id}` : "Label photo")) : s.kind === "usda" ? `FoodData Central ${s.fdc_id}` : s.kind === "web" ? s.url : "Entered by hand";
  const body = href ? h("a", { class: "fn-srclink", href, target: "_blank", rel: "noopener noreferrer" }, pill) : h("span", { tabindex: "0" }, pill);
  return withTip(body, () => [h("strong", {}, SOURCE_WORD[s.kind]), h("div", { class: "fn-tip-sub fn-wrap" }, what ?? ""),
    s.note ? h("p", { class: "fn-tip-note" }, s.note) : null, h("div", { class: "fn-tip-foot" }, `Recorded ${day(s.recorded_at)}`)]);
}

function addValue(missing: Nutrient[], patch: (b: object) => Promise<unknown>): HTMLElement | null {
  if (!missing.length) return null;
  const which = h("select", { class: "fn-input", "aria-label": "Nutrient" }, ...missing.map((n) => h("option", { value: n.key }, `${n.name} (${n.unit})`)));
  const amount = h("input", { class: "fn-input", inputmode: "decimal", placeholder: "Amount", "aria-label": "Amount", size: "8" });
  const add = button({ label: "Add value", onClick: async () => {
    const n = parseNum(amount.value.trim());
    if (n == null) return amount.focus();
    await patch({ nutrients: { [which.value]: n }, source: { kind: "manual" } }).catch((e) => alert(e.message));
  } });
  return h("div", { class: "fn-row fn-addrow" }, which, amount, add);
}

