import type { View } from "@brainbot/web-toolkit/shell";
import { button } from "@brainbot/web-toolkit/components";
import { api, send, type Direction, type Entry, type Food, type Meal, type Nutrient, type Overview, type Progress } from "../api";
import { addDays, amt, cap, day, h, longDay, num, todayIso } from "../fmt";
import { editable, parseNum } from "../edit";
import { icon } from "../icons";
import { grid3, list, muted, progress, removeBtn, section, tile, tiles, type Tone } from "../ui";

export const MEALS: Meal[] = ["breakfast", "lunch", "dinner", "snack"];
export const DIRECTION: Record<Direction, string> = { at_least: "at least", at_most: "at most", about: "about" };
const MAIN = [
  { key: "calories", icon: "flame", tone: "accent" },
  { key: "protein", icon: "egg", tone: "yes" },
  { key: "carbs", icon: "wheat", tone: "maybe" },
  { key: "fat", icon: "drop", tone: "link" },
] as const;

const greeting = () => {
  const hr = new Date().getHours();
  return hr < 5 ? "Up late" : hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening";
};

/** Today ("") or another day ("day/2026-11-02"): intake against targets, what was eaten, and quick re-logging. */
export const TodayView = (): View => ({
  async mount(el) {
    const date = location.hash.match(/^#day\/(\d{4}-\d{2}-\d{2})/)?.[1] ?? todayIso();
    const isToday = date === todayIso();
    const [o, d, ns, foods] = await Promise.all([api.overview(date), api.day(date), api.nutrients(), api.foods()]);
    const unit = new Map(ns.map((n) => [n.key, n.unit]));
    const name = new Map(ns.map((n) => [n.key, n.name]));
    const target = new Map(o.targets.map((t) => [t.nutrient, t]));

    const kcal = o.totals.calories ?? 0, kt = target.get("calories");
    const lede = !o.entries ? (isToday ? "Nothing logged yet today. Tap a recent food below, or send Claude a photo of a label." : "Nothing logged that day.")
      : `${num(kcal)} kcal${kt ? ` of ${num(kt.amount)}` : ""} and ${num(o.totals.protein ?? 0)} g protein across ${o.entries} entr${o.entries === 1 ? "y" : "ies"}.`;

    el.replaceChildren(
      h("header", { class: "fn-hello" },
        h("div", {}, h("p", { class: "fn-date" }, longDay(date)), h("h1", {}, isToday ? `${greeting()} 👋` : day(date)), h("p", { class: "fn-lede" }, lede)),
        dayNav(date)),
      tiles(...MAIN.map((m) => {
        const t = target.get(m.key);
        return tile({ label: name.get(m.key) ?? cap(m.key), value: amt(o.totals[m.key] ?? 0, unit.get(m.key) ?? ""), icon: m.icon, tone: m.tone,
          sub: t ? `${DIRECTION[t.direction]} ${amt(t.amount, t.unit)}` : "no target" });
      })),
      section(h("span", {}, icon("target", 16), " Targets"), ...targetRows(o.targets, ns)),
      section(h("span", {}, icon("apple", 16), isToday ? " Eaten today" : " Eaten"), ...eaten(d.entries)),
      section(h("span", {}, icon("bolt", 16), " Log it again"), quickLog(o, date), logOther(foods, date)),
      grid3(
        section(h("span", {}, icon("flask", 16), " Latest labs"), latestLabs(o)),
        section(h("span", {}, icon("file", 16), " Documents"), o.unfiled_documents
          ? h("p", {}, h("a", { href: "#documents" }, `${o.unfiled_documents} not filed yet`), muted(". Ask Claude to file them."))
          : list([], "Everything uploaded is filed."), h("a", { class: "fn-more", href: "#documents" }, "Upload a label or report →")),
        section(h("span", {}, icon("clock", 16), " Recent changes"), list(o.activity.slice(0, 5).map((a) =>
          h("span", { class: "fn-li" }, h("span", {}, h("span", { class: "fn-clamp", title: a.summary }, a.summary), h("small", {}, day(a.at))))), "No changes yet."),
          h("a", { class: "fn-more", href: "#log" }, "Full log →")),
      ),
    );
  },
});

function dayNav(date: string): HTMLElement {
  const go = (d: string) => { location.hash = d === todayIso() ? "#" : `#day/${d}`; };
  const prev = h("button", { class: "tk-btn fn-iconbtn", "aria-label": "Previous day", title: "Previous day" }, icon("left", 16));
  const next = h("button", { class: "tk-btn fn-iconbtn", "aria-label": "Next day", title: "Next day" }, icon("right", 16));
  const pick = h("input", { type: "date", class: "fn-input", "aria-label": "Pick a day", value: date });
  prev.addEventListener("click", () => go(addDays(date, -1)));
  next.addEventListener("click", () => go(addDays(date, 1)));
  pick.addEventListener("change", () => pick.value && go(pick.value));
  const nav = h("div", { class: "fn-row" }, prev, pick, next);
  if (date !== todayIso()) {
    const back = h("button", { class: "tk-btn" }, "Today");
    back.addEventListener("click", () => go(todayIso()));
    nav.append(back);
  }
  return nav;
}

export function targetTone(p: Progress): Tone {
  return p.status === "met" || p.status === "ok" ? "yes" : p.status === "over" ? (p.direction === "at_most" ? "no" : "maybe") : "link";
}

/** One bar per target, each amount editable, plus a form to add another. */
function targetRows(ps: Progress[], ns: Nutrient[]): (HTMLElement | null)[] {
  const rows = ps.map((p) => {
    const words = p.direction === "at_most"
      ? (p.total > p.amount ? `${amt(p.total - p.amount, p.unit)} over` : `${amt(p.remaining, p.unit)} to spare`)
      : p.remaining > 0 ? `${amt(p.remaining, p.unit)} to go` : p.direction === "about" && p.status === "over" ? `${amt(-p.remaining, p.unit)} over` : "Met";
    const label = h("span", {}, p.name, " ", h("small", { class: "fn-muted" }, DIRECTION[p.direction], " ",
      editable({ value: p.amount, display: amt(p.amount, p.unit), type: "number", save: (v) => send("PUT", `/api/targets/${p.nutrient}`, { amount: parseNum(v), direction: p.direction }) }),
      " · ", words), " ", removeBtn(`the ${p.name} target`, () => send("DELETE", `/api/targets/${p.nutrient}`)));
    return progress(label, p.total, p.amount, `${num(p.total)} / ${amt(p.amount, p.unit)}`, targetTone(p));
  });
  return [
    rows.length ? null : h("p", { class: "fn-muted fn-note" }, "No targets yet. Set the ones you care about: calories about 2,400, protein at least 150 g, sodium at most 2,300 mg."),
    ...rows,
    targetForm(ns, new Set(ps.map((p) => p.nutrient))),
  ];
}

function targetForm(ns: Nutrient[], has: Set<string>): HTMLElement {
  const which = h("select", { class: "fn-input", "aria-label": "Nutrient" }, ...ns.filter((n) => !has.has(n.key)).map((n) => h("option", { value: n.key }, `${n.name} (${n.unit})`)));
  const dir = h("select", { class: "fn-input", "aria-label": "Direction" }, ...(["about", "at_least", "at_most"] as Direction[]).map((d) => h("option", { value: d }, DIRECTION[d])));
  const amount = h("input", { class: "fn-input", inputmode: "decimal", placeholder: "Amount", "aria-label": "Amount", size: "8" });
  // Sensible direction defaults: calories about, sodium and sugars at most, the rest at least.
  const guess = () => { dir.value = which.value === "calories" ? "about" : /sodium|sugar|sat_fat|trans_fat|cholesterol/.test(which.value) ? "at_most" : "at_least"; };
  which.addEventListener("change", guess);
  guess();
  const set = button({ label: "Set target", variant: "primary", onClick: async () => {
    try {
      const n = parseNum(amount.value.trim());
      if (n == null) return amount.focus();
      await send("PUT", `/api/targets/${which.value}`, { amount: n, direction: dir.value });
      (document.activeElement as HTMLElement | null)?.blur();
    } catch (e) { alert((e as Error).message); }
  } });
  amount.addEventListener("keydown", (e) => { if (e.key === "Enter") set.click(); });
  return h("div", { class: "fn-row fn-addrow" }, which, dir, amount, set);
}

/** The day's entries by meal, servings and meal editable in place. */
function eaten(entries: Entry[]): HTMLElement[] {
  if (!entries.length) return [h("p", { class: "fn-muted" }, "Nothing logged.")];
  const groups = [...MEALS, null].map((m) => [m, entries.filter((e) => e.meal === m)] as const).filter(([, es]) => es.length);
  return groups.map(([meal, es]) => {
    const kcal = es.reduce((s, e) => s + (e.nutrients.calories ?? 0), 0);
    return h("div", { class: "fn-meal" },
      h("h3", {}, meal ? cap(meal) : "Any time", h("span", { class: "fn-num" }, `${num(kcal)} kcal`)),
      h("ul", { class: "fn-list" }, ...es.map((e) => h("li", { class: "fn-entry" },
        h("div", {}, h("a", { href: `#food/${e.food_id}` }, e.name), e.brand ? h("small", {}, e.brand) : null),
        h("div", { class: "fn-entry-meta" },
          editable({ value: e.servings, display: `${num(e.servings, 2)} × ${e.serving_size ?? "serving"}`, type: "number",
            save: (v) => send("PATCH", `/api/log/${e.id}`, { servings: parseNum(v) }) }),
          editable({ value: e.meal ?? "", display: e.meal ? cap(e.meal) : "Set meal", empty: !e.meal, type: "select",
            options: [{ value: "", label: "Any time" }, ...MEALS.map((m) => ({ value: m, label: cap(m) }))],
            save: (v) => send("PATCH", `/api/log/${e.id}`, { meal: v || null }) })),
        h("span", { class: "fn-num fn-macros" }, macros(e.nutrients)),
        removeBtn(`${e.name} from this day`, () => send("DELETE", `/api/log/${e.id}`))))));
  });
}

export const macros = (n: Record<string, number>) =>
  `${num(n.calories ?? 0)} kcal · ${num(n.protein ?? 0)}P ${num(n.carbs ?? 0)}C ${num(n.fat ?? 0)}F`;

/** One tap re-logs a recent food with the servings and meal used last time. */
function quickLog(o: Overview, date: string): HTMLElement {
  if (!o.recent_foods.length) return h("p", { class: "fn-muted" }, "Foods you log show up here for one-tap re-logging.");
  return h("div", { class: "fn-quick" }, ...o.recent_foods.map((f) => {
    const b = h("button", { class: "fn-quickfood", title: `Log ${f.last_servings} × ${f.name}${f.last_meal ? ` (${f.last_meal})` : ""}` },
      icon("plus", 14), h("span", {}, h("b", {}, f.name), h("small", {}, [`${num(f.last_servings, 2)} ×`, f.calories != null ? `${num(f.calories * f.last_servings)} kcal` : null, f.last_meal].filter(Boolean).join(" · "))));
    b.addEventListener("click", async () => {
      b.disabled = true;
      await api.log({ food_id: f.id, servings: f.last_servings, date, meal: f.last_meal }).catch((e) => alert(e.message));
    });
    return b;
  }));
}

/** Any saved food: type to find it, pick servings and a meal. */
function logOther(foods: Food[], date: string): HTMLElement {
  if (!foods.length) return h("p", { class: "fn-muted fn-note" }, "No saved foods yet. Add one on the Food page, or send Claude a label photo.");
  const listId = "fn-foods";
  const label = (f: Food) => `${f.name}${f.brand ? ` (${f.brand})` : ""}`;
  const pick = h("input", { class: "fn-input", list: listId, placeholder: "Find a saved food…", "aria-label": "Food" });
  const opts = h("datalist", { id: listId }, ...foods.map((f) => h("option", { value: label(f) })));
  const servings = h("input", { class: "fn-input", inputmode: "decimal", value: "1", size: "4", "aria-label": "Servings" });
  const meal = h("select", { class: "fn-input", "aria-label": "Meal" }, h("option", { value: "" }, "Any time"), ...MEALS.map((m) => h("option", { value: m }, cap(m))));
  const hr = new Date().getHours();
  meal.value = hr < 11 ? "breakfast" : hr < 15 ? "lunch" : hr < 21 ? "dinner" : "snack";
  const add = button({ label: "Log", variant: "primary", onClick: async () => {
    const f = foods.find((f) => label(f) === pick.value);
    if (!f) return pick.focus();
    try {
      await api.log({ food_id: f.id, servings: parseNum(servings.value) ?? 1, date, meal: (meal.value || null) as Meal | null });
      (document.activeElement as HTMLElement | null)?.blur();
    } catch (e) { alert((e as Error).message); }
  } });
  return h("div", { class: "fn-row fn-addrow" }, pick, opts, servings, h("span", { class: "fn-muted" }, "servings"), meal, add);
}

function latestLabs(o: Overview): HTMLElement {
  const d = o.latest_draw;
  if (!d) return h("div", {}, h("p", { class: "fn-muted" }, "No lab results yet."), h("a", { class: "fn-more", href: "#labs" }, "Labs →"));
  return h("div", {},
    h("p", { class: "fn-draw" }, h("b", {}, day(d.drawn_on)), d.lab ? ` · ${d.lab}` : "", ` · ${d.results} result${d.results === 1 ? "" : "s"}`),
    list(d.out_of_range.map((r) => h("span", { class: "fn-li" }, h("a", { href: `#marker/${r.marker_id}` }, r.marker),
      h("b", { class: "fn-num fn-out" }, `${r.value_text ?? num(r.value)} ${r.unit ?? ""}`, h("small", {}, r.ref_text ? `range ${r.ref_text}` : "flagged")))),
      "Everything within the report's ranges."),
    h("a", { class: "fn-more", href: "#labs" }, "All markers →"));
}
