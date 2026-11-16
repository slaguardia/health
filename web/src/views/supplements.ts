import type { View } from "@brainbot/web-toolkit/shell";
import { button, table } from "@brainbot/web-toolkit/components";
import { api, send, type Supplement } from "../api";
import { day, h } from "../fmt";
import { editable } from "../edit";
import { pageHead, removeBtn, section } from "../ui";
import { icon } from "../icons";

const WHEN: { value: Supplement["timing"]; label: string }[] = [
  { value: "waking", label: "On waking" },
  { value: "breakfast", label: "With breakfast" },
  { value: "midday", label: "Midday" },
  { value: "dinner", label: "With dinner" },
  { value: "bedtime", label: "Bedtime" },
  { value: "apart", label: "Apart from meals" },
  { value: "anytime", label: "Any time" },
];
const STATUS = [{ value: "taking", label: "Taking" }, { value: "planned", label: "Not started" }, { value: "stopped", label: "Stopped" }];

/** The routine by time of day: what's on the plan, the dose, and how to take it. */
export const SupplementsView = (): View => ({
  async mount(el) {
    const all = await api.supplements();
    const current = all.filter((s) => s.status !== "stopped");
    const stopped = all.filter((s) => s.status === "stopped");
    el.replaceChildren(
      pageHead("Supplements", "What you take and when, by time of day. Add one here, or tell Claude in any chat that has your access key."),
      ...WHEN.map((w) => {
        const rows = current.filter((s) => s.timing === w.value);
        return rows.length ? section(w.label, routine(rows)) : "";
      }),
      current.length ? "" : section("Your routine", h("p", { class: "fn-empty" }, icon("pill", 16), " Nothing yet. Add what you take below.")),
      addForm(),
      stopped.length ? h("details", { class: "fn-card fn-backlog-done" },
        h("summary", {}, `Stopped (${stopped.length})`), routine(stopped)) : "",
    );
  },
});

const patch = (s: Supplement, body: object) => send("PATCH", `/api/supplements/${s.id}`, body);
const text = (s: Supplement, key: keyof Supplement, placeholder = "—") =>
  editable({ value: (s[key] as string | null) ?? "", display: (s[key] as string | null) || placeholder, empty: !s[key], save: (v) => patch(s, { [key]: v }) });

const clamp = (e: HTMLElement) => (e.classList.add("fn-clamp3"), e);
/** A small ↗ link to a product page, in a new tab. */
const out = (href: string, label: string) => h("a", { class: "fn-supp-link", href, target: "_blank", rel: "noopener", title: label, "aria-label": label }, "↗");

function routine(list: Supplement[]): HTMLElement {
  return table({
    columns: ["Product", "Dose", "When", "How often", "Directions", "Status", ""],
    rows: list.map((s) => [
      h("div", { class: "fn-supp" },
        h("strong", {}, text(s, "name"), s.url ? out(s.url, `Open ${s.name}`) : null),
        h("small", {}, [s.brand, s.purpose, s.recommended_by && `from ${s.recommended_by}`, s.bought_from && `via ${s.bought_from}`].filter(Boolean).join(" · ")),
        s.plan_product ? h("small", { class: "fn-supp-plan" }, `Plan: ${s.plan_product}`, s.plan_url ? out(s.plan_url, `Open ${s.plan_product}`) : null) : null,
        h("small", {}, editable({ value: s.url ?? "", display: s.url ? "Edit link" : "Add link", empty: true, placeholder: "https://…", save: (v) => patch(s, { url: v }) }))),
      text(s, "dose"),
      editable({ value: s.timing, display: WHEN.find((w) => w.value === s.timing)?.label ?? s.timing, type: "select", options: WHEN, save: (v) => patch(s, { timing: v }) }),
      text(s, "frequency"),
      clamp(text(s, "directions", "Add directions")),
      h("div", {},
        editable({ value: s.status, display: STATUS.find((x) => x.value === s.status)!.label, type: "select", options: STATUS, missing: s.status === "planned", save: (v) => patch(s, { status: v }) }),
        s.status === "stopped" && s.stopped_on ? h("small", { class: "fn-sub" }, day(s.stopped_on))
          : s.started_on ? h("small", { class: "fn-sub" }, `since ${day(s.started_on)}`) : null),
      removeBtn(`${s.name} from your supplements`, () => send("DELETE", `/api/supplements/${s.id}`)),
    ]),
  });
}

function addForm(): HTMLElement {
  const name = h("input", { class: "fn-input", placeholder: "Product", "aria-label": "Product" });
  const brand = h("input", { class: "fn-input", placeholder: "Brand", "aria-label": "Brand" });
  const dose = h("input", { class: "fn-input", placeholder: "Dose, e.g. 2 softgels", "aria-label": "Dose" });
  const when = h("select", { class: "fn-input", "aria-label": "When" }, ...WHEN.map((w) => h("option", { value: w.value }, w.label)));
  const add = button({ label: "Add", variant: "primary", onClick: async () => {
    if (!name.value.trim()) return name.focus();
    add.disabled = true;
    try {
      await send("POST", "/api/supplements", { name: name.value.trim(), brand: brand.value.trim(), dose: dose.value.trim(), timing: when.value, frequency: "Daily" });
    } catch (e) {
      alert((e as Error).message);
      add.disabled = false;
    }
  } });
  return section("Add a supplement", h("div", { class: "fn-row fn-addrow fn-supp-form" }, name, brand, dose, when, add));
}
