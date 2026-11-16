import "@brainbot/web-toolkit/base.css";
import "@brainbot/web-toolkit/components.css";
import "./style.css";
import { mountApp, type View } from "@brainbot/web-toolkit/shell";
import { registerSW } from "@brainbot/web-toolkit/pwa";
import { TodayView } from "./views/today";
import { FoodDetailView, FoodView } from "./views/food";
import { LabsView, MarkerView } from "./views/labs";
import { DocumentsView } from "./views/documents";
import { LogView } from "./views/log";
import { BacklogView } from "./views/backlog";
import { SupplementsView } from "./views/supplements";
import { startLive } from "./live";
import { icon } from "./icons";

const routes: Record<string, () => View> = {
  "": TodayView,
  "day/": TodayView,
  "food": FoodView,
  "food/": FoodDetailView,
  "labs": LabsView,
  "marker/": MarkerView,
  "supplements": SupplementsView,
  "documents": DocumentsView,
  "backlog": BacklogView,
  "log": LogView,
};

mountApp(routes, {
  title: "health",
  layout: "sidebar",
  nav: [
    { label: "Today", href: "#" },
    { label: "Food", href: "#food" },
    { label: "Labs", href: "#labs" },
    { label: "Supplements", href: "#supplements" },
    { label: "Documents", href: "#documents" },
    { label: "Backlog", href: "#backlog" },
    { label: "Log", href: "#log" },
  ],
});
registerSW();
decorateChrome();

// Icons on the nav pills + the app icon beside the wordmark, and keep "Today" lit on
// its routes (the shell doesn't mark the "" route as current), Food on a food, Labs on a marker.
function decorateChrome(): void {
  const icons: Record<string, string> = { "#": "home", "#food": "apple", "#labs": "flask", "#supplements": "pill", "#documents": "file", "#backlog": "list", "#log": "clock" };
  for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>(".cap-nav a"))) {
    // The label goes in a span so the phone tab bar can swap in a shorter word where it has one.
    const label = document.createElement("span");
    label.textContent = a.textContent;
    if (a.getAttribute("href") === "#documents") label.dataset.short = "Docs";
    if (a.getAttribute("href") === "#supplements") label.dataset.short = "Supps";
    a.replaceChildren(icon(icons[a.getAttribute("href") ?? ""] ?? "home", 18), label);
  }
  const brand = document.querySelector(".brand");
  const logo = document.createElement("img");
  logo.src = "/icon-192.png";
  logo.alt = "";
  brand?.prepend(logo);
  const lit: [string, RegExp][] = [["#", /^(day\/.*)?$/], ["#food", /^food\//], ["#labs", /^marker\//]];
  const sync = () => {
    const path = location.hash.replace(/^#/, "");
    for (const [href, re] of lit) document.querySelector(`.cap-nav a[href="${href}"]`)?.classList.toggle("fn-home-on", re.test(path));
  };
  window.addEventListener("hashchange", sync);
  sync();
}

// Same longest-prefix match as the shell, so a live refresh re-renders the view on screen.
async function rerender(): Promise<void> {
  const path = location.hash.replace(/^#/, "");
  const key = Object.keys(routes).filter((k) => path.startsWith(k)).sort((a, b) => b.length - a.length)[0] ?? "";
  const content = document.querySelector<HTMLElement>(".tk-content");
  if (!content) return;
  const next = document.createElement("div");
  await routes[key]().mount(next);
  content.replaceChildren(...next.childNodes);
}
startLive(rerender);
// A view's own controls (a chart's window or nutrient) ask for a redraw the same way.
window.addEventListener("fn-rerender", () => rerender().catch((e) => console.error(e)));
