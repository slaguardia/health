import type { View } from "@brainbot/web-toolkit/shell";
import { button, table } from "@brainbot/web-toolkit/components";
import { api, send, type Doc } from "../api";
import { day, h, todayIso } from "../fmt";
import { editable } from "../edit";
import { pageHead, removeBtn, section, withTip } from "../ui";
import { icon } from "../icons";

const TYPES = ["Nutrition label", "Lab report", "Other"];

export const DocumentsView = (): View => ({
  async mount(el) {
    const docs = await api.documents();
    const waiting = docs.filter((d) => !d.applied_to);
    el.replaceChildren(
      pageHead("Documents", "Nutrition labels and lab reports, with what each one changed. Upload the original here, then show the same file to Claude and ask it to file it."),
      uploadForm(),
      waiting.length ? section(h("span", {}, icon("bell", 16), ` Not filed yet (${waiting.length})`),
        h("p", { class: "fn-muted fn-note" }, "Claude matches the file you show it in a chat to one of these by name and date, reads it, and fills in the entry."),
        h("ul", { class: "fn-list" }, ...waiting.map((d) => h("li", { class: "fn-li" },
          h("span", {}, link(d), h("small", {}, [d.type, d.issuer, `added ${day(d.added_at)}`].filter(Boolean).join(" · "))),
          h("span", { class: "fn-pill fn-pill-maybe fn-pill-sm" }, "Not filed yet"))))) : "",
      section(`Catalog (${docs.length})`, docs.length ? table({
        columns: ["Date", "Type", "From", "Description", "Applied to", "Notes", ""],
        rows: docs.map((d) => [
          h("span", { class: "fn-nowrap" }, day(d.doc_date ?? d.added_at)),
          editable({ value: d.type ?? "", display: d.type || "—", type: "select", options: ["", ...TYPES].map((t) => ({ value: t, label: t || "—" })), save: (v) => patch(d, { type: v }) }),
          editable({ value: d.issuer ?? "", display: d.issuer || "—", save: (v) => patch(d, { issuer: v }) }),
          h("span", { class: "fn-desc" }, link(d)),
          d.applied_to ? applied(d) : h("span", { class: "fn-pill fn-pill-maybe fn-pill-sm" }, "Not filed yet"),
          clamp(editable({ value: d.notes ?? "", display: d.notes || "—", save: (v) => patch(d, { notes: v }) }), d.notes ?? ""),
          removeBtn(`document #${d.id} from the catalog`, () => send("DELETE", `/api/documents/${d.id}`)),
        ]),
        sortable: true,
      }) : h("p", { class: "fn-muted" }, "Nothing yet.")),
    );
  },
});

/** What filing changed, with links to the foods and lab results it fed. */
function applied(d: Doc): HTMLElement {
  const box = clamp(d.applied_to ?? "");
  const links: Node[] = [];
  if (d.lab_results) links.push(h("a", { href: "#labs" }, `${d.lab_results} lab result${d.lab_results === 1 ? "" : "s"}`));
  for (const id of (d.food_ids ?? "").split(",").filter(Boolean)) links.push(h("a", { href: `#food/${id}` }, `food #${id}`));
  return links.length ? h("div", {}, box, h("small", { class: "fn-sub fn-row fn-tight" }, ...links)) : box;
}

/** Long text cut to three lines; hovering shows all of it (an editable cell opens the full text on click). */
function clamp(content: string | HTMLElement, full = typeof content === "string" ? content : ""): HTMLElement {
  const box = typeof content === "string" ? h("span", { tabindex: "0" }, content) : content;
  box.classList.add("fn-clamp3");
  return full.length > 140 ? withTip(box, () => [h("p", { class: "fn-tip-full" }, full)], box, false) : box;
}

const baseName = (f: File) => f.name.replace(/\.[^.]+$/, "");
const patch = (d: Doc, body: object) => send("PATCH", `/api/documents/${d.id}`, body);

function link(d: Doc): Node {
  const text = d.description || d.file_name || `Document #${d.id}`;
  if (d.file_name) return h("a", { href: `/api/documents/${d.id}/file`, target: "_blank", rel: "noopener" }, text);
  return document.createTextNode(text);
}

/** Take a photo (phones open the camera), pick files, or drop them. Each file becomes one "Not filed yet" entry. */
function uploadForm(): HTMLElement {
  const file = h("input", { type: "file", multiple: "", accept: "image/*,application/pdf", class: "fn-hidden-file", id: "fn-pick" });
  const camera = h("input", { type: "file", accept: "image/*", capture: "environment", class: "fn-hidden-file", id: "fn-camera" });
  const type = h("select", { class: "fn-input", "aria-label": "Type" }, ...TYPES.map((t) => h("option", { value: t }, t)));
  const date = h("input", { type: "date", class: "fn-input", "aria-label": "Date (drawn, or photo taken)" });
  date.value = todayIso();
  const hint = h("span", { class: "fn-drop-hint" }, "Drop photos or PDFs here");
  const drop = h("div", { class: "fn-drop" }, icon("upload", 22), hint,
    h("label", { class: "tk-btn tk-btn-primary fn-filebtn", for: "fn-camera" }, icon("camera", 16), " Take photo"), camera,
    h("label", { class: "tk-btn fn-filebtn", for: "fn-pick" }, icon("file", 16), " Choose files"), file);

  let picked: File[] = [];
  const pickFiles = (fs: File[]) => {
    picked = fs;
    if (!fs.length) return;
    hint.textContent = fs.length === 1 ? fs[0].name : `${fs.length} files: ${fs.map((f) => f.name).join(", ")}`;
    if (fs.some((f) => f.type === "application/pdf")) type.value = "Lab report";
    save.disabled = false;
  };
  file.addEventListener("change", () => pickFiles(Array.from(file.files ?? [])));
  camera.addEventListener("change", () => pickFiles(Array.from(camera.files ?? [])));
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("fn-drop-on"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("fn-drop-on"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("fn-drop-on");
    if (e.dataTransfer?.files.length) pickFiles(Array.from(e.dataTransfer.files));
  });

  const save = button({
    label: "Upload", variant: "primary", disabled: true,
    onClick: async () => {
      if (!picked.length) return;
      save.disabled = true;
      try {
        for (const f of picked) {
          const { id } = await send<{ id: number }>("POST", "/api/documents", {
            type: type.value === "Other" ? null : type.value, doc_date: date.value || null, description: baseName(f),
          });
          await api.uploadFile(id, f);
        }
      } catch (e) {
        alert((e as Error).message);
        save.disabled = false;
      }
    },
  });
  return section("Add a label or report", drop,
    h("div", { class: "fn-row fn-addrow" }, h("label", { class: "fn-field" }, "Type", type), h("label", { class: "fn-field" }, "Date drawn or taken", date), save));
}
