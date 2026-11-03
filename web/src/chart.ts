// Hand-rolled SVG charts (no chart library, per the platform rules). Each chart
// redraws at its box's real pixel width, so axis text is the same size on a
// phone and a wide screen. Hover, focus or tap anywhere in a point's column for
// a card with its value and what it's measured against.
import { h, num } from "./fmt";
import { withTip } from "./ui";

const NS = "http://www.w3.org/2000/svg";
const PAD = { t: 14, r: 10, b: 28, l: 48 };
let W = 720;
/** Room per x-axis label, so labels thin out on narrow charts instead of colliding. */
const LABEL_W = 64;

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/** Round guide steps (1, 2 or 5 × 10ⁿ), about four of them, covering lo..hi. */
function scale(lo: number, hi: number) {
  if (hi <= lo) hi = lo + 1;
  const raw = (hi - lo) / 4, p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * p).find((m) => m >= raw)!;
  return { bottom: Math.floor(lo / step) * step, top: Math.ceil(hi / step) * step, step };
}

/** A box the chart fills; it draws once it knows its width and again whenever that changes. */
function responsive(height: number, draw: () => SVGSVGElement): HTMLElement {
  const box = h("div", { class: "fn-chartbox" });
  box.style.height = `${height}px`;
  let drawn = 0;
  new ResizeObserver(([e]) => {
    const w = Math.round(e.contentRect.width);
    if (!w || Math.abs(w - drawn) < 2) return;
    drawn = w;
    W = w;
    box.replaceChildren(draw());
  }).observe(box);
  return box;
}

const compact = (n: number) => (Math.abs(n) >= 10_000 ? `${Math.round(n / 1000)}k` : Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : num(n));

/** Faint horizontal guides + left labels. No frame, no box. */
function frame(height: number, lo: number, hi: number) {
  const svg = el("svg", { viewBox: `0 0 ${W} ${height}`, width: W, height, class: "fn-chart", role: "img" });
  const { bottom, top, step } = scale(lo, hi);
  const ih = height - PAD.t - PAD.b;
  const y = (v: number) => PAD.t + ih - ((v - bottom) / (top - bottom)) * ih;
  for (let i = 0; bottom + step * i <= top + step / 1000; i++) {
    const v = bottom + step * i;
    svg.append(el("line", { x1: PAD.l, x2: W - PAD.r, y1: y(v), y2: y(v), class: i ? "fn-guide" : "fn-base" }));
    const t = el("text", { x: PAD.l - 10, y: y(v) + 4, "text-anchor": "end", class: "fn-axis" });
    t.textContent = compact(Number(v.toPrecision(6)));
    svg.append(t);
  }
  return { svg, y, bottom, top };
}

function xLabel(svg: SVGSVGElement, x: number, text: string, height: number) {
  const t = el("text", { x, y: height - 8, "text-anchor": "middle", class: "fn-axis" });
  t.textContent = text;
  svg.append(t);
  return t;
}

/** A hover/focus/tap target covering one point's column, from x0 to x1. */
function hit(x0: number, x1: number, height: number, label: string) {
  const g = el("g", { class: "fn-hit", tabindex: 0, "aria-label": label });
  g.append(el("rect", { x: x0, y: PAD.t, width: Math.max(x1 - x0, 1), height: height - PAD.t - PAD.b, class: "fn-band" }));
  return g;
}

export type BarPoint = { label: string; title: string; value: number; notes?: string[] };

/**
 * One bar per logged day, with the day's target as a dashed line. A bar is tinted by where it sits against the
 * target (met, under, over); with no target every bar is the accent color.
 */
export function barChart(points: BarPoint[], opts: { unit: string; target?: { amount: number; direction: "at_least" | "at_most" | "about" } | null; height?: number }): HTMLElement {
  const height = opts.height ?? 220;
  return responsive(height, () => drawBars(points, height, opts));
}

function tone(v: number, t: { amount: number; direction: string } | null | undefined): string {
  if (!t) return "var(--accent)";
  if (t.direction === "at_least") return v >= t.amount ? "var(--yes)" : "var(--accent)";
  if (t.direction === "at_most") return v > t.amount ? "var(--no)" : "var(--yes)";
  const s = t.amount ? v / t.amount : 1;
  return s < 0.9 ? "var(--accent)" : s > 1.1 ? "var(--maybe)" : "var(--yes)";
}

function drawBars(points: BarPoint[], height: number, opts: { unit: string; target?: { amount: number; direction: string } | null }): SVGSVGElement {
  const max = Math.max(...points.map((p) => p.value), opts.target?.amount ?? 0, 0) * 1.08;
  const { svg, y } = frame(height, 0, max);
  const slot = (W - PAD.l - PAD.r) / Math.max(points.length, 1);
  const bw = Math.max(3, Math.min(28, slot * 0.62));
  const every = Math.max(1, Math.ceil(points.length / Math.floor((W - PAD.l - PAD.r) / LABEL_W)));
  points.forEach((p, i) => {
    const cx = PAD.l + slot * i + slot / 2, t = y(p.value), bottom = y(0), x0 = cx - bw / 2;
    const r = Math.min(5, bw / 2, bottom - t);
    const col = hit(cx - slot / 2, cx + slot / 2, height, `${p.title}: ${num(p.value)} ${opts.unit}`);
    const bar = el("path", { d: `M${x0},${bottom} V${t + r} Q${x0},${t} ${x0 + r},${t} H${x0 + bw - r} Q${x0 + bw},${t} ${x0 + bw},${t + r} V${bottom} Z`, fill: tone(p.value, opts.target), class: "fn-bar" });
    col.append(bar);
    const vs = opts.target ? `${num(p.value - opts.target.amount)} ${opts.unit} ${p.value >= opts.target.amount ? "over" : "under"} the ${num(opts.target.amount)} target` : null;
    svg.append(withTip(col, () => [h("strong", {}, p.title), h("div", { class: "fn-tip-value" }, `${num(p.value)} ${opts.unit}`),
      vs ? h("div", { class: "fn-tip-sub" }, vs.replace(/^-/, "")) : null, ...(p.notes ?? []).map((n) => h("p", { class: "fn-tip-note" }, n))], bar));
    if (i === points.length - 1 || (i % every === 0 && points.length - 1 - i >= every)) xLabel(svg, cx, p.label, height);
  });
  if (opts.target) {
    svg.append(el("line", { x1: PAD.l, x2: W - PAD.r, y1: y(opts.target.amount), y2: y(opts.target.amount), class: "fn-target" }));
  }
  return svg;
}

export type RangePoint = {
  t: number; label: string; title: string; value: number; unit: string | null;
  low: number | null; high: number | null; rangeText: string | null; out: boolean; sub?: string;
};

/**
 * A lab marker over time. Behind each result, a soft band shows the range printed on that result's own report
 * (labs differ, so the band can change from draw to draw). Results outside their range are drawn in the warning
 * color with a ring.
 */
export function rangeChart(points: RangePoint[], opts: { height?: number } = {}): HTMLElement {
  const height = opts.height ?? 200;
  return responsive(height, () => drawRange(points, height));
}

function drawRange(points: RangePoint[], height: number): SVGSVGElement {
  const vals = points.flatMap((p) => [p.value, p.low, p.high].filter((v): v is number => v != null));
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.15;
  lo = Math.max(lo >= 0 ? 0 : -Infinity, lo - pad);
  hi += pad;
  const { svg, y, bottom, top } = frame(height, lo, hi);
  if (!points.length) return svg;
  const t0 = points[0].t, t1 = points[points.length - 1].t;
  const inner = W - PAD.l - PAD.r - 40;
  const x = (t: number) => (t1 === t0 ? PAD.l + (W - PAD.l - PAD.r) / 2 : PAD.l + 20 + ((t - t0) / (t1 - t0)) * inner);
  const xs = points.map((p) => x(p.t));
  const edge = (i: number, side: -1 | 1) => {
    const n = xs[i + side];
    return n === undefined ? (side < 0 ? PAD.l : W - PAD.r) : (xs[i] + n) / 2;
  };
  // Range bands first, so the line and dots sit on top.
  points.forEach((p, i) => {
    if (p.low == null && p.high == null) return;
    const yt = y(p.high ?? top), yb = y(p.low ?? bottom);
    svg.append(el("rect", { x: edge(i, -1), y: yt, width: Math.max(edge(i, 1) - edge(i, -1), 1), height: Math.max(yb - yt, 1), class: "fn-range" }));
  });
  if (points.length > 1) svg.append(el("polyline", { points: points.map((p, i) => `${xs[i]},${y(p.value)}`).join(" "), class: "fn-line", stroke: "var(--fg-muted)" }));
  let lastLabel: { x: number; t: SVGTextElement } | null = null;
  points.forEach((p, i) => {
    const cx = xs[i];
    const g = hit(edge(i, -1), edge(i, 1), height, `${p.title}: ${num(p.value)} ${p.unit ?? ""}${p.out ? ", outside the report's range" : ""}`);
    const dot = el("circle", { cx, cy: y(p.value), r: 5.5, fill: p.out ? "var(--no)" : "var(--yes)", class: `fn-dot${p.out ? " fn-dot-out" : ""}` });
    g.append(el("line", { x1: cx, x2: cx, y1: PAD.t, y2: height - PAD.b, class: "fn-cross" }), dot);
    svg.append(withTip(g, () => [
      h("strong", {}, p.title),
      p.sub ? h("div", { class: "fn-tip-sub" }, p.sub) : null,
      h("div", { class: "fn-tip-value" }, `${num(p.value, 2)} ${p.unit ?? ""}`),
      h("div", { class: `fn-tip-sub${p.out ? " fn-down" : ""}` }, p.rangeText ? `Report's range: ${p.rangeText}` : "No range printed"),
      p.out ? h("div", { class: "fn-tip-foot fn-tip-warn" }, "Outside the report's range") : null,
    ], dot));
    const end = i === points.length - 1;
    if (!lastLabel || cx - lastLabel.x >= LABEL_W || end) {
      if (end && lastLabel && cx - lastLabel.x < LABEL_W) lastLabel.t.remove();
      lastLabel = { x: cx, t: xLabel(svg, cx, p.label, height) };
    }
  });
  return svg;
}
