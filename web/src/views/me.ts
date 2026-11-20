import type { View } from "@brainbot/web-toolkit/shell";
import { button } from "@brainbot/web-toolkit/components";
import { api, send, type CareTodo, type Memory } from "../api";
import { day, h } from "../fmt";
import { editable } from "../edit";
import { icon } from "../icons";
import { pageHead, removeBtn, section } from "../ui";

const SECTIONS: { key: string; label: string; hint: string; long?: boolean }[] = [
  { key: "name", label: "What to call you", hint: "A first name or nickname is enough" },
  { key: "about", label: "About you", hint: "Age range, work, activity, how you live: whatever helps", long: true },
  { key: "goals", label: "Health goals", hint: "What you're working toward", long: true },
  { key: "history", label: "Health history", hint: "Conditions, family history, past care: only what you want Claude to know", long: true },
  { key: "care_team", label: "Care team", hint: "Who you see, for what, and how to reach them", long: true },
  { key: "preferences", label: "Care preferences", hint: "The kind of care you want, insurance or HSA, how you like information", long: true },
];
const TODO_STATUS = [{ value: "open", label: "To do" }, { value: "waiting", label: "Waiting on someone" }, { value: "done", label: "Done" }];

/** What Claude reads before it helps: the owner's own words, their care to-dos, and memories from earlier chats. */
export const AboutMeView = (): View => ({
  async mount(el) {
    const { profile, todos, memories } = await api.profile();
    const open = todos.filter((t) => t.status !== "done");
    const done = todos.filter((t) => t.status === "done");
    el.replaceChildren(
      pageHead("About me", "What Claude reads first in any chat that has your access key, so it can guide you toward the care you want. Write it in your own words; Claude only changes it with your OK."),
      section("About you", h("div", { class: "fn-me" }, ...SECTIONS.map((s) => h("div", { class: "fn-fact" },
        h("span", {}, s.label),
        editable({
          value: profile[s.key] ?? "", display: profile[s.key] || s.hint, empty: !profile[s.key], placeholder: s.hint,
          type: s.long ? "textarea" : "text", save: (v) => send("PUT", `/api/profile/${s.key}`, { value: v }),
        }))))),
      section(`Care to-dos (${open.length})`,
        open.length ? h("ul", { class: "fn-backlog" }, ...open.map(todo)) : h("p", { class: "fn-empty" }, icon("check", 16), " Nothing to do right now."),
        todoForm(),
        done.length ? h("details", { class: "fn-backlog-done fn-me-done" }, h("summary", {}, `Done (${done.length})`), h("ul", { class: "fn-backlog" }, ...done.map(todo))) : ""),
      section(`Memories (${memories.length})`,
        h("p", { class: "fn-muted fn-note" }, "Short facts and preferences Claude saved from your chats. Fix any that are wrong, or delete them."),
        memories.length ? h("ul", { class: "fn-backlog" }, ...memories.map(memory)) : h("p", { class: "fn-muted" }, "None yet."),
        memoryForm()),
    );
  },
});

function todo(t: CareTodo): HTMLElement {
  const isDone = t.status === "done";
  const tick = h("button", { class: `fn-tick${isDone ? " fn-tick-on" : ""}`, "aria-label": isDone ? `Reopen ${t.title}` : `Mark ${t.title} done`, title: isDone ? "Reopen" : "Mark done" }, isDone ? icon("check", 14) : "");
  tick.addEventListener("click", () => send("PATCH", `/api/todos/${t.id}`, { status: isDone ? "open" : "done" }).catch((e) => alert(e.message)));
  const patch = (body: object) => send("PATCH", `/api/todos/${t.id}`, body);
  const when = isDone && t.done_at ? `Done ${day(t.done_at)}` : `Added ${day(t.created_at)}${t.source === "claude" ? " by Claude" : ""}`;
  return h("li", { class: isDone ? "fn-backlog-item fn-off" : "fn-backlog-item" },
    tick,
    h("div", {},
      h("strong", {}, editable({ value: t.title, display: t.title, save: (v) => patch({ title: v }) })),
      h("p", {}, editable({ value: t.details ?? "", display: t.details || "Add details", empty: !t.details, type: "textarea", save: (v) => patch({ details: v }) })),
      h("small", { class: "fn-me-meta" },
        editable({ value: t.status, display: TODO_STATUS.find((s) => s.value === t.status)!.label, type: "select", options: TODO_STATUS, missing: t.status === "waiting", save: (v) => patch({ status: v }) }),
        " · ", editable({ value: t.due_on ?? "", display: t.due_on ? `Due ${day(t.due_on)}` : "Add a due date", empty: !t.due_on, type: "date", save: (v) => patch({ due_on: v }) }),
        ` · ${when}`)),
    removeBtn(`"${t.title}" from your to-dos`, () => send("DELETE", `/api/todos/${t.id}`)));
}

function memory(m: Memory): HTMLElement {
  return h("li", { class: "fn-backlog-item fn-me-memory" },
    h("div", {},
      h("p", {}, editable({ value: m.text, display: m.text, type: "textarea", save: (v) => send("PATCH", `/api/memories/${m.id}`, { text: v }) })),
      h("small", {}, `${m.source === "claude" ? "Saved by Claude" : "Added by you"} ${day(m.created_at)}${m.updated_at ? ` · edited ${day(m.updated_at)}` : ""}`)),
    removeBtn("this memory", () => send("DELETE", `/api/memories/${m.id}`)));
}

/** One-line add form: a text box and a button that posts it. */
function addRow(placeholder: string, label: string, post: (v: string) => Promise<unknown>, extra?: HTMLInputElement): HTMLElement {
  const input = h("input", { class: "fn-input", placeholder, "aria-label": placeholder });
  const add = button({ label, onClick: async () => {
    if (!input.value.trim()) return input.focus();
    add.disabled = true;
    try { await post(input.value.trim()); } catch (e) { alert((e as Error).message); add.disabled = false; }
  } });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") add.click(); });
  return h("div", { class: "fn-row fn-addrow fn-me-add" }, input, extra ?? "", add);
}

function todoForm(): HTMLElement {
  const due = h("input", { class: "fn-input", type: "date", "aria-label": "Due date" });
  return addRow("A new to-do, e.g. book a physical", "Add to-do", (title) => send("POST", "/api/todos", { title, due_on: due.value || undefined }), due);
}
const memoryForm = () => addRow("Something Claude should remember", "Remember", (text) => send("POST", "/api/memories", { text }));
