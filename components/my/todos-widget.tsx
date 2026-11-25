"use client";

// To-dos on My Surroundings. Your own list (add, tick off, remove), kept
// private to you; time-off requests waiting for you to approve; your to-dos
// from the L10 meeting boards, where ticking one sends it to review on the
// board for the next L10; and the project tasks assigned to you on Monday that
// are due soon or overdue.
//
// The card is compact by default (a few rows of each) so it sits level with
// the card beside it; "Show all" opens the full lists and is remembered.

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, ChevronDown, Plus, X } from "lucide-react";
import type { MyTask } from "@/lib/monday/my-tasks";
import type { L10Todo } from "@/lib/monday/l10";
import type { PtoApproval } from "@/lib/monday/pto";
import { PtoDecide } from "@/components/my/pto-decide";
import { cn } from "@/lib/utils";

type Todo = { id: string; text: string; done: boolean; done_at: string | null; created_at: string; due_date?: string | null; source?: string | null };
type NotebookTask = { id: string; text: string; done: boolean; month: string; late: boolean; client: string; url: string };

const dayLabel = (iso: string, today: string): { text: string; tone: "late" | "today" | "soon" } => {
  if (iso < today) return { text: fmt(iso), tone: "late" };
  if (iso === today) return { text: "Today", tone: "today" };
  const t = new Date(`${today}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  if (iso === t.toISOString().slice(0, 10)) return { text: "Tomorrow", tone: "soon" };
  return { text: fmt(iso, true), tone: "soon" };
};
const fmt = (iso: string, weekday = false) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { ...(weekday ? { weekday: "short" } : {}), month: "short", day: "numeric", timeZone: "UTC" });

export function TodosWidget({
  tasks,
  other,
  mondayOk,
  today,
  l10,
  l10Ok,
  approvals = [],
}: {
  approvals?: PtoApproval[]; // time-off requests waiting for this person to approve
  tasks: MyTask[];
  other: number;
  mondayOk: boolean;
  today: string;
  l10: L10Todo[];
  l10Ok: boolean;
}) {
  const [ready, setReady] = useState<boolean | null>(null); // null = still loading
  const [todos, setTodos] = useState<Todo[]>([]);
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false); // false = the compact view
  // Ticked = in review on the board. Starts from what the board says.
  const [l10Done, setL10Done] = useState<Record<string, boolean>>(() => Object.fromEntries(l10.map((t) => [t.id, t.inReview])));
  const [l10Error, setL10Error] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // SocialDesk notebook items for the clients this person works.
  const [notebook, setNotebook] = useState<NotebookTask[]>([]);
  useEffect(() => {
    let live = true;
    fetch("/api/my/notebook")
      .then((r) => r.json())
      .then((j: { tasks?: NotebookTask[] }) => live && setNotebook(j.tasks ?? []))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  async function toggleNotebook(n: NotebookTask) {
    const done = !n.done;
    setNotebook((cur) => cur.map((x) => (x.id === n.id ? { ...x, done } : x)));
    const res = await fetch("/api/my/notebook", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client: n.client, id: n.id, done }) }).catch(() => null);
    if (!res?.ok) setNotebook((cur) => cur.map((x) => (x.id === n.id ? { ...x, done: n.done } : x)));
  }

  useEffect(() => {
    try {
      setOpen(localStorage.getItem("sg-todos-open") === "1");
    } catch {
      // Private window: starts compact.
    }
  }, []);
  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem("sg-todos-open", next ? "1" : "0");
    } catch {
      // Not remembered, still works.
    }
  };

  useEffect(() => {
    let live = true;
    fetch("/api/my/todos")
      .then((r) => r.json())
      .then((j: { ready?: boolean; todos?: Todo[] }) => {
        if (!live) return;
        setReady(!!j.ready);
        setTodos(j.todos ?? []);
      })
      .catch(() => live && setReady(false));
    return () => {
      live = false;
    };
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (!value || adding) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/my/todos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: value }) });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; todo?: Todo; error?: string } | null;
      if (!res.ok || !json?.todo) {
        setError(json?.error ?? "That did not save. Try again.");
        return;
      }
      setTodos((cur) => [json.todo as Todo, ...cur]);
      setText("");
      inputRef.current?.focus();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setAdding(false);
    }
  }

  async function toggle(t: Todo) {
    const done = !t.done;
    setTodos((cur) => cur.map((x) => (x.id === t.id ? { ...x, done } : x)));
    const res = await fetch("/api/my/todos", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: t.id, done }) }).catch(() => null);
    if (!res?.ok) setTodos((cur) => cur.map((x) => (x.id === t.id ? { ...x, done: t.done } : x)));
  }

  async function remove(t: Todo) {
    const before = todos;
    setTodos((cur) => cur.filter((x) => x.id !== t.id));
    const res = await fetch(`/api/my/todos?id=${t.id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) setTodos(before);
  }

  // Tick an L10 to-do: it goes to review on its board, and stays here ticked until
  // it is closed in the L10 meeting. Un-ticking puts it back.
  async function toggleL10(t: L10Todo) {
    const done = !l10Done[t.id];
    setL10Done((cur) => ({ ...cur, [t.id]: done }));
    setL10Error(null);
    const res = await fetch("/api/my/l10", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ boardId: t.boardId, itemId: t.id, done, restore: t.status ?? "" }),
    }).catch(() => null);
    if (!res?.ok) {
      setL10Done((cur) => ({ ...cur, [t.id]: !done }));
      const json = (await res?.json().catch(() => null)) as { error?: string } | null;
      setL10Error(json?.error ?? "That did not save on Monday. Try again.");
    }
  }

  // Open first; dated ones by due date (late ones lead), then the rest newest first.
  const mine = [...todos].sort(
    (a, b) =>
      Number(a.done) - Number(b.done) ||
      (a.due_date ? 0 : 1) - (b.due_date ? 0 : 1) ||
      (a.due_date && b.due_date ? a.due_date.localeCompare(b.due_date) : 0) ||
      b.created_at.localeCompare(a.created_at)
  );
  const l10Late = l10.filter((t) => t.due && t.due < today && !l10Done[t.id]).length;
  const mineShown = open ? mine : mine.slice(0, 3);
  const l10Shown = open ? l10 : l10.slice(0, 2);
  const hidden = mine.length - mineShown.length + (l10.length - l10Shown.length) + Math.max(0, tasks.length - (open ? tasks.length : 2)) + Math.max(0, notebook.length - (open ? notebook.length : 3));
  const [decided, setDecided] = useState<Record<string, boolean>>({});
  const waiting = approvals.filter((a) => !decided[a.id]).length;
  const total = mine.filter((t) => !t.done).length + l10.filter((t) => !l10Done[t.id]).length + tasks.length + waiting + notebook.filter((n) => !n.done).length;
  const late = tasks.filter((t) => t.due < today).length;
  const shown = open ? tasks : tasks.slice(0, 2);

  return (
    <div className="space-y-4">
      {/* Your own list */}
      {ready ? (
        <div>
          <form onSubmit={add} className="flex items-center gap-2">
            <input
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={300}
              placeholder="Add a to-do"
              className="w-full rounded-lg border border-border bg-panel px-3 py-2 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-foreground/50"
            />
            <button
              type="submit"
              disabled={adding || !text.trim()}
              aria-label="Add to-do"
              className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-foreground text-background transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <Plus className="h-4 w-4" />
            </button>
          </form>
          {error ? <p className="mt-1.5 text-[12px] text-red-700">{error}</p> : null}
          {mine.length ? (
            <ul className="mt-2.5 space-y-0.5">
              {mineShown.map((t) => (
                <li key={t.id} className="group/todo flex items-start gap-2.5 rounded-lg px-1 py-1.5 transition-colors hover:bg-secondary/50">
                  <button
                    type="button"
                    onClick={() => void toggle(t)}
                    aria-label={t.done ? "Mark as not done" : "Mark as done"}
                    className={cn(
                      "mt-0.5 flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-md border transition-colors",
                      t.done ? "border-emerald-600 bg-emerald-600 text-white" : "border-foreground/30 hover:border-foreground"
                    )}
                  >
                    {t.done ? <Check className="h-3 w-3" /> : null}
                  </button>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block break-words text-[13px] leading-snug", t.done ? "text-muted-foreground line-through" : "text-foreground")}>{t.text}</span>
                    {t.due_date && !t.done
                      ? (() => {
                          const d = dayLabel(t.due_date, today);
                          return (
                            <span className={cn("mt-0.5 block text-[11px]", d.tone === "late" ? "font-medium text-red-700" : d.tone === "today" ? "font-medium text-amber-700" : "text-muted-foreground")}>
                              {d.tone === "late" ? `was due ${d.text}` : `due ${d.text}`}
                              {t.source === "recurring" ? " · monthly" : ""}
                            </span>
                          );
                        })()
                      : null}
                  </span>
                  <button
                    type="button"
                    onClick={() => void remove(t)}
                    aria-label="Remove"
                    className="mt-0.5 flex-shrink-0 rounded p-0.5 text-muted-foreground opacity-60 transition-opacity hover:text-foreground md:opacity-0 md:group-hover/todo:opacity-100"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[12px] text-muted-foreground">Nothing on your own list. Only you can see what you add here.</p>
          )}
        </div>
      ) : ready === null ? (
        <div className="h-9 animate-pulse rounded-lg bg-foreground/5" aria-hidden />
      ) : null}

      {/* SocialDesk notebook: the To Produce items on your clients' notebooks */}
      {notebook.length ? (
        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              SocialDesk notebook <span className="ml-1 text-foreground/50">{notebook.filter((n) => !n.done).length}</span>
            </span>
          </div>
          <ul className="space-y-0.5">
            {(open ? notebook : notebook.slice(0, 3)).map((n) => (
              <li key={n.id} className="flex items-start gap-2.5 rounded-lg px-1 py-1.5 transition-colors hover:bg-secondary/50">
                <button
                  type="button"
                  onClick={() => void toggleNotebook(n)}
                  aria-label={n.done ? "Mark as not done" : "Mark as done"}
                  className={cn(
                    "mt-0.5 flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-md border transition-colors",
                    n.done ? "border-emerald-600 bg-emerald-600 text-white" : "border-foreground/30 hover:border-foreground"
                  )}
                >
                  {n.done ? <Check className="h-3 w-3" /> : null}
                </button>
                <span className="min-w-0 flex-1">
                  <span className={cn("block break-words text-[13px] leading-snug", n.done ? "text-muted-foreground line-through" : "text-foreground")}>{n.text}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
                    <a href={n.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                      {n.client}
                    </a>
                    <span className={cn(n.late && !n.done ? "font-medium text-red-700" : "")}>{n.late ? `from ${n.month}` : n.month}</span>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Time off waiting for you to approve: always shown in full */}
      {approvals.length ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50/70 px-3 py-2.5">
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-amber-900">
              Time off to approve <span className="ml-1 text-amber-900/60">{waiting}</span>
            </span>
            <a href="/my/pto" className="text-[11px] font-medium text-amber-900 underline-offset-2 hover:underline">
              Time off page
            </a>
          </div>
          <ul className="divide-y divide-amber-200/70">
            {approvals.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <a href={a.url} target="_blank" rel="noopener noreferrer" className="block truncate text-[13px] font-medium text-foreground hover:underline">
                    {a.name}
                  </a>
                  <span className="block text-[11.5px] text-amber-900/80">
                    {a.from ? fmt(a.from, true) : "No dates"}
                    {a.to && a.to !== a.from ? ` to ${fmt(a.to, true)}` : ""}
                    {a.hours != null ? ` · ${a.hours} hours` : ""}
                    {a.kind && /half/i.test(a.kind) ? " · half day" : ""}
                  </span>
                </span>
                <PtoDecide itemId={a.id} compact onDone={() => setDecided((cur) => ({ ...cur, [a.id]: true }))} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* From the L10 boards */}
      {l10Ok && l10.length ? (
        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              From your L10s <span className="ml-1 text-foreground/50">{l10.length}</span>
            </span>
            {l10Late ? <span className="text-[11px] font-medium text-red-700">{l10Late} past due</span> : null}
          </div>
          <ul className="space-y-0.5">
            {l10Shown.map((t) => {
              const done = !!l10Done[t.id];
              const d = t.due ? dayLabel(t.due, today) : null;
              return (
                <li key={t.id} className="flex items-start gap-2.5 rounded-lg px-1 py-1.5 transition-colors hover:bg-secondary/50">
                  <button
                    type="button"
                    onClick={() => void toggleL10(t)}
                    aria-label={done ? "Take it out of review" : "Send to review on Monday"}
                    title={done ? "Take it out of review" : "Done: send it to review for the L10 meeting"}
                    className={cn(
                      "mt-0.5 flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-md border transition-colors",
                      done ? "border-emerald-600 bg-emerald-600 text-white" : "border-foreground/30 hover:border-foreground"
                    )}
                  >
                    {done ? <Check className="h-3 w-3" /> : null}
                  </button>
                  <span className="min-w-0 flex-1">
                    <a
                      href={t.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn("block break-words text-[13px] leading-snug hover:underline", done ? "text-muted-foreground" : "text-foreground")}
                    >
                      {t.name}
                    </a>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
                      <span>{t.board}</span>
                      {done ? <span className="rounded bg-emerald-100 px-1 font-medium text-emerald-800">In review</span> : null}
                      {d && !done ? (
                        <span className={cn(d.tone === "late" && !done ? "font-medium text-red-700" : "")}>
                          {d.tone === "late" ? `was due ${d.text}` : `due ${d.text}`}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
          {l10Error ? <p className="mt-1 text-[12px] text-red-700">{l10Error}</p> : null}
        </div>
      ) : null}

      {/* Assigned on Monday */}
      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Project tasks due {tasks.length ? <span className="ml-1 text-foreground/50">{tasks.length}</span> : null}
          </span>
          {late ? <span className="text-[11px] font-medium text-red-700">{late} overdue</span> : null}
        </div>
        {!mondayOk ? (
          <p className="text-[12px] text-muted-foreground">Your Monday tasks could not be read just now.</p>
        ) : tasks.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">Nothing assigned to you is due in the next two weeks.</p>
        ) : (
          <>
            <ul className="divide-y divide-border/50">
              {shown.map((t) => {
                const d = dayLabel(t.due, today);
                return (
                  <li key={t.id}>
                    <a href={t.url} target="_blank" rel="noopener noreferrer" className="group/row flex items-center gap-3 py-2">
                      <span
                        className={cn(
                          "w-[68px] flex-shrink-0 rounded-md px-1.5 py-0.5 text-center text-[10.5px] font-semibold",
                          d.tone === "late" ? "bg-red-50 text-red-700" : d.tone === "today" ? "bg-foreground text-background" : "bg-secondary text-foreground/75"
                        )}
                      >
                        {d.text}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-foreground group-hover/row:underline">{t.type ?? t.name}</span>
                        <span className="block truncate text-[11.5px] text-muted-foreground">{t.project ?? t.name}</span>
                      </span>
                      <ArrowUpRight className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                    </a>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {open && mondayOk && other > 0 ? <p className="mt-2 text-[11px] text-muted-foreground">{other} more open on Monday with no due date or one further out.</p> : null}
      </div>

      {open || hidden > 0 ? (
        <button
          type="button"
          onClick={toggleOpen}
          aria-expanded={open}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-panel px-3 py-2 text-[12.5px] font-semibold text-foreground transition-colors hover:bg-secondary"
        >
          {open ? "Show less" : `Show all ${total}`}
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
        </button>
      ) : null}
    </div>
  );
}
