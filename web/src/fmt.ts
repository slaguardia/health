// Number/date formatting + tiny DOM helpers shared by every view.

/** 1234.5 → "1,234.5"; whole numbers stay whole. */
export const num = (n: number | null | undefined, digits = 1) =>
  n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: Math.abs(n) >= 100 ? 0 : digits });
/** A value with its unit: "1,850 kcal", "142 g", "2,300 mg". */
export const amt = (n: number | null | undefined, unit: string) => (n == null ? "—" : `${num(n)}${unit ? ` ${unit}` : ""}`);
export const pct = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n * 100)}%`);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10-31" → "Oct 31, 2026" */
export const day = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};
/** "2026-10-31" → "Oct 31" */
export const shortDay = (iso: string) => {
  const [, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
};
/** "2026-10-31" → "Oct ’26" */
export const shortMonth = (iso: string) => {
  const [y, m] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ’${String(y).slice(2)}`;
};
/** "2026-11-03" → "Tuesday, November 3" */
export const longDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
export const todayIso = () => new Date().toLocaleDateString("en-CA"); // local date, YYYY-MM-DD
export const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("en-CA");
};
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const k of kids) if (k !== null && k !== undefined && k !== false) el.append(k);
  return el;
}
