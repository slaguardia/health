import type { View } from "@brainbot/web-toolkit/shell";
import { button, table } from "@brainbot/web-toolkit/components";
import { api, send, type Draw, type LabResult, type Marker, type Range } from "../api";
import { day, h, num, shortMonth } from "../fmt";
import { rangeChart, type RangePoint } from "../chart";
import { editable, parseNum } from "../edit";
import { icon } from "../icons";
import { list, muted, pageHead, removeBtn, section, tile, tiles } from "../ui";

const DISCLAIMER = "Each result is shown against the reference range printed on its own report, and flagged when it falls outside it. That's all: this page tracks numbers, it doesn't interpret them.";
const RANGE_WORD: Record<Range, string> = { low: "Below range", high: "Above range", flagged: "Flagged by the lab", in: "In range", unknown: "No range" };

const sameUnit = (a: string | null, b: string | null) => !a || !b || a.replace(/\s/g, "").toLowerCase() === b.replace(/\s/g, "").toLowerCase();
const shown = (r: { value: number | null; value_text?: string | null }) => r.value_text ?? num(r.value, 2);

/** Every marker, grouped by panel, each with its history against the printed range. */
export const LabsView = (): View => ({
  async mount(el) {
    const [markers, draws] = await Promise.all([api.markers(), api.draws()]);
    if (!markers.length) {
      el.replaceChildren(pageHead("Labs", DISCLAIMER),
        section("No lab results yet", h("p", { class: "fn-muted" }, "Upload a report (PDF or photo) on the Documents page, then ask Claude to file it. Each test gets one canonical marker, so the same test from different labs lines up here.")));
      return;
    }
    const last = draws[0];
    const panels = new Map<string, Marker[]>();
    for (const m of markers.filter((m) => m.count)) {
      const k = m.panel ?? "Other";
      panels.set(k, [...(panels.get(k) ?? []), m]);
    }
    el.replaceChildren(
      pageHead("Labs", DISCLAIMER),
      tiles(
        tile({ label: "Latest draw", value: last ? day(last.drawn_on) : "—", icon: "flask", tone: "link", sub: last ? `${last.lab || "Lab not recorded"} · ${last.results} results` : undefined }),
        tile({ label: "Outside the report's range", value: String(last?.out_of_range.length ?? 0), icon: "bell", tone: last?.out_of_range.length ? "no" : "yes", sub: "in the latest draw" }),
        tile({ label: "Markers tracked", value: String(markers.filter((m) => m.count).length), icon: "list", tone: "accent", sub: `${draws.length} draw${draws.length === 1 ? "" : "s"} on file` }),
      ),
      last ? section(h("span", {}, icon("bell", 16), ` Outside the range in the ${day(last.drawn_on)} draw`), outList(last)) : "",
      ...[...panels].map(([panel, ms]) => section(panel, h("div", { class: "fn-markers" }, ...ms.map(markerCard)))),
      draws.length > 1 ? section("Every draw", table({
        columns: ["Drawn", "Lab", "Results", "Outside range"],
        rows: draws.map((d) => [day(d.drawn_on), d.lab || "—", String(d.results), d.out_of_range.length ? d.out_of_range.map((r) => r.marker).join(", ") : "None"]),
      })) : "",
    );
  },
});

function outList(d: Draw): HTMLElement {
  return list(d.out_of_range.map((r) => h("span", { class: "fn-li" },
    h("span", {}, h("a", { href: `#marker/${r.marker_id}` }, r.marker), h("small", {}, RANGE_WORD[r.range as Range] ?? r.range)),
    h("b", { class: "fn-num fn-out" }, `${r.value_text ?? num(r.value)} ${r.unit ?? ""}`, h("small", {}, r.ref_text ? `range ${r.ref_text}` : "")))),
    "Every result is within its printed range.");
}

const points = (rs: { drawn_on: string; value: number | null; unit: string | null; ref_low: number | null; ref_high: number | null; out_of_range: boolean; ref_text?: string | null; lab?: string }[], unit: string | null): RangePoint[] =>
  rs.filter((r) => r.value != null && sameUnit(r.unit, unit)).map((r) => ({
    t: Date.parse(r.drawn_on), label: shortMonth(r.drawn_on), title: day(r.drawn_on), value: r.value!, unit: r.unit ?? unit,
    low: r.ref_low, high: r.ref_high, out: r.out_of_range, sub: r.lab || undefined,
    rangeText: r.ref_text ?? (r.ref_low != null || r.ref_high != null ? `${r.ref_low ?? ""}–${r.ref_high ?? ""}` : null),
  }));

function markerCard(m: Marker): HTMLElement {
  const l = m.latest!;
  const pts = points(m.history, m.unit);
  return h("a", { class: `fn-marker${l.out_of_range ? " fn-marker-out" : ""}`, href: `#marker/${m.id}` },
    h("div", { class: "fn-marker-head" },
      h("span", {}, h("b", {}, m.name), h("small", {}, `${day(l.drawn_on)}${l.lab ? ` · ${l.lab}` : ""}`)),
      h("span", { class: "fn-marker-val" }, h("b", { class: "fn-num" }, shown(l)), ` ${l.unit ?? ""}`,
        h("small", { class: l.out_of_range ? "fn-out" : "" }, l.out_of_range ? RANGE_WORD[l.range] : l.ref_text ? `range ${l.ref_text}` : RANGE_WORD[l.range]))),
    pts.length ? rangeChart(pts, { height: 120 }) : muted("Text result, nothing to chart."),
    l.value != null && !sameUnit(l.unit, m.unit) ? h("small", { class: "fn-sub fn-unitnote" }, `The latest is in ${l.unit}; the chart shows ${m.unit}.`) : null);
}

// --- one marker ---

export const MarkerView = (): View => ({
  async mount(el) {
    const id = decodeURIComponent(location.hash.match(/^#marker\/(.+)$/)?.[1] ?? "");
    const { marker: m, results } = await api.marker(id);
    const patch = (body: object) => send("PATCH", `/api/markers/${encodeURIComponent(id)}`, body);
    const pts = points(results, m.unit);
    const other = results.filter((r) => r.value != null && !sameUnit(r.unit, m.unit));
    el.replaceChildren(
      h("a", { class: "fn-back", href: "#labs" }, icon("left", 14), " Labs"),
      pageHead(m.name, DISCLAIMER),
      section(h("span", {}, "History", m.unit ? h("small", { class: "fn-muted" }, ` in ${m.unit}`) : ""),
        pts.length ? rangeChart(pts, { height: 240 }) : muted("No numeric results to chart."),
        h("p", { class: "fn-muted fn-legendline" }, h("i", { class: "fn-range-key" }), " The range printed on each report", h("i", { class: "fn-out-key" }), " Outside it"),
        other.length ? h("p", { class: "fn-muted fn-note" }, `${other.length} result${other.length === 1 ? " is" : "s are"} in another unit (${[...new Set(other.map((r) => r.unit))].join(", ")}) and left off the chart; they're in the table below.`) : null),
      section(`Results (${results.length})`, table({
        columns: ["Drawn", "Lab", "As printed", "Value", "Range on report", "", "Report", ""],
        rows: [...results].reverse().map((r) => resultRow(r)),
      })),
      section("About this marker", h("div", { class: "fn-facts" },
        fact("Name", editable({ value: m.name, display: m.name, save: (v) => patch({ name: v }) })),
        fact("Panel", editable({ value: m.panel ?? "", display: m.panel ?? "Add", empty: !m.panel, save: (v) => patch({ panel: v || null }) })),
        fact("Chart unit", editable({ value: m.unit ?? "", display: m.unit ?? "Add", empty: !m.unit, save: (v) => patch({ unit: v || null }) })),
        fact("Notes", editable({ value: m.notes ?? "", display: m.notes ?? "Add", empty: !m.notes, save: (v) => patch({ notes: v || null }) }))),
        h("p", { class: "fn-muted fn-note" }, "Names labs print for it: ", m.aliases.join(" · ") || "none yet"),
        aliasForm(id)),
    );
  },
});

const fact = (label: string, v: Node) => h("div", { class: "fn-fact" }, h("span", {}, label), v);

function resultRow(r: LabResult): (string | Node)[] {
  const range = r.ref_text ?? (r.ref_low != null || r.ref_high != null ? `${r.ref_low ?? ""}–${r.ref_high ?? ""}` : "—");
  return [
    h("span", { class: "fn-nowrap" }, day(r.drawn_on)),
    r.lab || "—",
    r.name_on_report ?? "—",
    h("span", { class: `fn-num${r.out_of_range ? " fn-out" : ""}` },
      editable({ value: r.value, display: `${shown(r)} ${r.unit ?? ""}`, type: "number", save: (v) => send("PATCH", `/api/labs/${r.id}`, { value: parseNum(v), value_text: v }) })),
    range,
    r.out_of_range ? h("span", { class: "fn-pill fn-pill-sm fn-pill-no" }, r.flag ? `${RANGE_WORD[r.range]} (${r.flag})` : RANGE_WORD[r.range])
      : r.range === "in" ? h("span", { class: "fn-pill fn-pill-sm fn-pill-yes" }, "In range") : muted("—"),
    r.document_id ? h("a", { href: `/api/documents/${r.document_id}/file`, target: "_blank", rel: "noopener" }, r.document ?? `#${r.document_id}`) : muted("—"),
    removeBtn(`this ${r.drawn_on} result`, () => send("DELETE", `/api/labs/${r.id}`)),
  ];
}

function aliasForm(id: string): HTMLElement {
  const alias = h("input", { class: "fn-input", placeholder: "Another printed name, e.g. LDL-C", "aria-label": "Alias" });
  const add = button({ label: "Add name", onClick: async () => {
    if (!alias.value.trim()) return alias.focus();
    await send("POST", `/api/markers/${encodeURIComponent(id)}/aliases`, { alias: alias.value.trim() }).catch((e) => alert(e.message));
  } });
  return h("div", { class: "fn-row fn-addrow" }, alias, add);
}
