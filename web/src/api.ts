// Thin wrappers over the backend's /api/* (the app's whole control surface).
export type Nutrient = { key: string; name: string; unit: string; sort: number };
export type Totals = Record<string, number>;
export type Direction = "at_least" | "at_most" | "about";
export type Target = { nutrient: string; amount: number; direction: Direction; name: string; unit: string };
export type Progress = Target & { total: number; share: number | null; remaining: number; status: "met" | "under" | "over" | "ok" };
export type Meal = "breakfast" | "lunch" | "dinner" | "snack";
export type Entry = {
  id: number; date: string; meal: Meal | null; food_id: number; servings: number; notes: string | null; logged_at: string;
  name: string; brand: string | null; serving_size: string | null; nutrients: Totals;
};
export type Day = { date: string; entries: Entry[]; totals: Totals; targets: Progress[] };
export type RecentFood = { id: number; name: string; brand: string | null; serving_size: string | null; times: number; last_date: string; last_servings: number; last_meal: Meal | null; calories: number | null };
export type Draw = { drawn_on: string; lab: string; results: number; out_of_range: { marker_id: string; marker: string; value: number | null; value_text: string | null; unit: string | null; ref_text: string | null; range: string }[] };
export type Activity = { id: number; at: string; summary: string };
export type Overview = {
  date: string; totals: Totals; entries: number; targets: Progress[];
  week: { days_logged: number; average: Totals };
  recent_foods: RecentFood[]; latest_draw: Draw | null; unfiled_documents: number; activity: Activity[];
};
export type Food = {
  id: number; name: string; brand: string | null; serving_size: string | null; serving_grams: number | null;
  servings_per_container: number | null; upc: string | null; notes: string | null; archived: number;
  times_logged: number; last_logged: string | null; source_kinds: string | null; nutrients: Totals;
};
export type Source = { id: number; kind: "label" | "usda" | "web" | "manual"; document_id: number | null; fdc_id: string | null; url: string | null; note: string | null; recorded_at: string; document: string | null; has_file: number };
export type FoodDetail = Omit<Food, "times_logged" | "last_logged" | "source_kinds" | "nutrients"> & {
  values: { nutrient: string; amount: number; source_id: number | null; name: string; unit: string }[];
  sources: Source[];
  recent_log: { id: number; date: string; meal: Meal | null; servings: number }[];
};
export type Trends = { from: string; to: string; days_logged: number; average: Totals; series: { date: string; totals: Totals }[]; targets: Target[] };
export type Range = "low" | "high" | "flagged" | "in" | "unknown";
export type LabResult = {
  id: number; drawn_on: string; lab: string; marker_id: string; name_on_report: string | null; value: number | null; value_text: string | null;
  unit: string | null; ref_low: number | null; ref_high: number | null; ref_text: string | null; flag: string | null;
  document_id: number | null; document?: string | null; notes: string | null; range: Range; out_of_range: boolean;
};
export type Marker = {
  id: string; name: string; panel: string | null; unit: string | null; notes: string | null; sort: number; aliases: string[];
  count: number; latest: LabResult | null;
  history: { drawn_on: string; value: number | null; unit: string | null; ref_low: number | null; ref_high: number | null; out_of_range: boolean }[];
};
export type Doc = {
  id: number; added_at: string; doc_date: string | null; type: string | null; issuer: string | null; description: string | null;
  applied_to: string | null; notes: string | null; file_name: string | null; mime: string | null; size: number | null;
  lab_results: number; food_ids: string | null;
};
export type Supplement = {
  id: number; name: string; brand: string | null; dose: string | null;
  timing: "waking" | "breakfast" | "midday" | "dinner" | "bedtime" | "apart" | "anytime";
  frequency: string | null; directions: string | null; purpose: string | null; recommended_by: string | null; bought_from: string | null;
  status: "taking" | "planned" | "stopped"; started_on: string | null; stopped_on: string | null; notes: string | null; created_at: string;
  url: string | null; plan_product: string | null; plan_url: string | null;
};
export type AccessKey ={ id: string; label: string; created_at: string; last_used_at: string | null };
export type BacklogItem = { id: number; title: string; details: string | null; status: "open" | "done"; source: "dashboard" | "claude"; created_at: string; done_at: string | null };

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
  return r.json();
}
const get = <T>(p: string) => fetch(p).then((r) => j<T>(r));
export const send = <T = { ok: true }>(method: string, p: string, body?: unknown) =>
  fetch(p, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }).then((r) => j<T>(r));

export const api = {
  overview: (date?: string) => get<Overview>(`/api/overview${date ? `?date=${date}` : ""}`),
  day: (date: string) => get<Day>(`/api/day/${date}`),
  trends: (days: number, end: string) => get<Trends>(`/api/trends?days=${days}&end=${end}`),
  nutrients: () => get<{ nutrients: Nutrient[] }>("/api/nutrients").then((d) => d.nutrients),
  foods: (archived = false) => get<{ foods: Food[] }>(`/api/foods${archived ? "?archived=1" : ""}`).then((d) => d.foods),
  food: (id: number) => get<FoodDetail>(`/api/foods/${id}`),
  targets: () => get<{ targets: Target[] }>("/api/targets").then((d) => d.targets),
  markers: () => get<{ markers: Marker[] }>("/api/markers").then((d) => d.markers),
  marker: (id: string) => get<{ marker: Omit<Marker, "count" | "latest" | "history">; results: LabResult[] }>(`/api/markers/${encodeURIComponent(id)}`),
  draws: () => get<{ draws: Draw[] }>("/api/draws").then((d) => d.draws),
  documents: () => get<{ documents: Doc[] }>("/api/documents").then((d) => d.documents),
  activity: () => get<{ activity: Activity[] }>("/api/activity").then((d) => d.activity),
  keys: () => get<{ keys: AccessKey[] }>("/api/keys").then((d) => d.keys),
  supplements: () => get<{ supplements: Supplement[] }>("/api/supplements").then((d) => d.supplements),
  backlog: () => get<{ backlog: BacklogItem[] }>("/api/backlog").then((d) => d.backlog),
  backups: () => get<{ backups: { name: string; size: number }[] }>("/api/backups").then((d) => d.backups),
  log: (b: { food_id: number; servings: number; date: string; meal?: Meal | null }) => send<{ id: number }>("POST", "/api/log", b),
  uploadFile: (id: number, file: File) =>
    fetch(`/api/documents/${id}/file`, {
      method: "PUT", body: file,
      headers: { "Content-Type": file.type || "application/octet-stream", "X-Filename": encodeURIComponent(file.name) },
    }).then((r) => j(r)),
};
