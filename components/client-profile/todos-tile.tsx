"use client";

// To-dos for one client: what came out of meetings, the monthly ones (content
// calendar to the client for review, the monthly report), the SMM's SocialDesk
// notebook items and anything typed in here. Each one (except SocialDesk's,
// which live in SocialDesk) is also on its owner's To-dos in My Surroundings,
// so ticking it in either place ticks it in both.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CalendarClock, Check, ChevronDown, ListChecks, Loader2, Plus, Repeat, Settings2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Tile } from "./tile";
import { cn } from "@/lib/utils";

type Todo = {
  id: string;
  text: string;
  done: boolean;
  done_at: string | null;
  created_at: string;
  owner_email: string;
  owner_name: string | null;
  due_date: string | null;
  source: "manual" | "meeting" | "recurring" | null;
  source_ref: string | null;
};
type NotebookTask = { id: string; text: string; done: boolean; month: string; late: boolean; url: string };
type Member = { email: string; name: string };
type Schedule = { calendar_day: number | null; report: "first_monday" | number | null; owner_email: string | null };
type Payload = {
  ready: boolean;
  me: string;
  todos: Todo[];
  notebook: { found: boolean; tasks: NotebookTask[]; url?: string; smm?: Member | null };
  schedule: Schedule;
  scheduleSaved: boolean;
  social: boolean;
  amEmail: string | null;
  team: Member[];
};

// One row in the list, whichever kind it is.
type Row =
  | { kind: "todo"; key: string; t: Todo }
  | { kind: "notebook"; key: string; n: NotebookTask };

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const fmtDay = (iso: string, weekday = true) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { ...(weekday ? { weekday: "short" } : {}), month: "short", day: "numeric", timeZone: "UTC" });
const first = (name: string | null | undefined, email: string) => (name ? name.split(" ")[0] : email.split("@")[0]);
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

function dueChip(due: string, now: string): { label: string; tone: "late" | "today" | "soon" | "later" } {
  const days = Math.round((Date.parse(`${due}T12:00:00Z`) - Date.parse(`${now}T12:00:00Z`)) / 86400000);
  if (days < 0) return { label: `${fmtDay(due, false)} · ${-days}d late`, tone: "late" };
  if (days === 0) return { label: "Today", tone: "today" };
  if (days === 1) return { label: "Tomorrow", tone: "soon" };
  return { label: fmtDay(due), tone: days <= 7 ? "soon" : "later" };
}

export function TodosTile({ brandId, brandName }: { brandId: string; brandName: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState("");
  const [owner, setOwner] = useState("");
  const [due, setDue] = useState("");
  const [adding, setAdding] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const now = today();

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/brand/${brandId}/todos`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      const j = (await res.json()) as Payload;
      setData(j);
      setOwner((o) => o || j.me);
    } catch {
      setFailed(true);
    }
  }, [brandId]);
  useEffect(() => {
    void load();
  }, [load]);

  const { open, done } = useMemo(() => {
    if (!data) return { open: [] as Row[], done: [] as Row[] };
    const rows: Row[] = [
      ...data.todos.map((t) => ({ kind: "todo" as const, key: t.id, t })),
      ...data.notebook.tasks.map((n) => ({ kind: "notebook" as const, key: `nb-${n.id}`, n })),
    ];
    const isDone = (r: Row) => (r.kind === "todo" ? r.t.done : r.n.done);
    // Dated first (soonest, so late ones lead), then SocialDesk's, then undated newest.
    const rank = (r: Row) =>
      r.kind === "todo" ? (r.t.due_date ? `0${r.t.due_date}` : `2${9999999999999 - Date.parse(r.t.created_at)}`) : `1${r.n.late ? "0" : "1"}`;
    const sorted = rows.sort((a, b) => rank(a).localeCompare(rank(b)));
    return { open: sorted.filter((r) => !isDone(r)), done: sorted.filter(isDone) };
  }, [data]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (!value || adding) return;
    setAdding(true);
    const res = await fetch(`/api/brand/${brandId}/todos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: value, owner_email: owner || undefined, due_date: due || undefined }),
    }).catch(() => null);
    setAdding(false);
    if (!res?.ok) {
      const j = (await res?.json().catch(() => null)) as { error?: string } | null;
      toast.error(j?.error ?? "That didn't save. Try again.");
      return;
    }
    setText("");
    setDue("");
    inputRef.current?.focus();
    const who = data?.team.find((m) => m.email === owner);
    if (owner && owner !== data?.me) toast.success(`Added to ${first(who?.name ?? null, owner)}'s To-dos`);
    void load();
  }

  async function patch(body: Record<string, unknown>, optimistic: (d: Payload) => Payload) {
    if (!data) return;
    const before = data;
    setData(optimistic(data));
    const res = await fetch(`/api/brand/${brandId}/todos`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (!res?.ok) {
      setData(before);
      const j = (await res?.json().catch(() => null)) as { error?: string } | null;
      toast.error(j?.error ?? "That didn't save. Try again.");
    }
  }

  const toggle = (r: Row) =>
    r.kind === "todo"
      ? patch({ id: r.t.id, done: !r.t.done }, (d) => ({ ...d, todos: d.todos.map((x) => (x.id === r.t.id ? { ...x, done: !x.done } : x)) }))
      : patch({ notebook_id: r.n.id, done: !r.n.done }, (d) => ({
          ...d,
          notebook: { ...d.notebook, tasks: d.notebook.tasks.map((x) => (x.id === r.n.id ? { ...x, done: !x.done } : x)) },
        }));

  const clear = (t: Todo) => patch({ id: t.id, clear: true }, (d) => ({ ...d, todos: d.todos.filter((x) => x.id !== t.id) }));

  const openCount = open.length;
  const late = open.filter((r) => (r.kind === "todo" ? !!r.t.due_date && r.t.due_date < now : r.n.late)).length;

  return (
    <Tile id="todos" label="To-dos" icon={<ListChecks className="h-3.5 w-3.5" />} spans={2}>
      {!data ? (
        <div className="flex items-center gap-2 py-3 text-[12px] text-muted-foreground">
          {failed ? "Couldn't load the to-dos." : (<><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading to-dos</>)}
        </div>
      ) : (
        <div className="-mt-1 space-y-3">
          {/* Status line */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
            <span className="font-medium text-foreground">{openCount ? `${openCount} open` : "All clear"}</span>
            {late ? <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-600 dark:text-red-400">{late} late</span> : null}
            <span className="text-muted-foreground">Each one is also on its owner&apos;s To-dos in My Surroundings.</span>
          </div>

          {/* Add */}
          <form onSubmit={add} className="flex flex-wrap items-center gap-2">
            <input
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={260}
              placeholder={`Add a to-do for ${brandName}`}
              className="min-w-[200px] flex-1 rounded-lg border border-border bg-panel px-3 py-2 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-foreground/50"
            />
            <select
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              aria-label="Who"
              className="h-9 rounded-lg border border-border bg-panel px-2 text-[12px] text-foreground outline-none focus:border-foreground/50"
            >
              {data.team.map((m) => (
                <option key={m.email} value={m.email}>
                  {m.email === data.me ? `Me (${first(m.name, m.email)})` : m.name}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              aria-label="Due"
              className="h-9 rounded-lg border border-border bg-panel px-2 text-[12px] text-foreground outline-none focus:border-foreground/50"
            />
            <button
              type="submit"
              disabled={adding || !text.trim()}
              aria-label="Add to-do"
              className="inline-flex h-9 items-center gap-1 rounded-lg bg-foreground px-3 text-[12px] font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Add
            </button>
          </form>

          {/* The list */}
          {open.length ? (
            <ul className="divide-y divide-border/50">
              {open.map((r) => (
                <RowItem key={r.key} r={r} now={now} brandId={brandId} smm={data.notebook.smm ?? null} onToggle={() => void toggle(r)} onClear={r.kind === "todo" ? () => void clear(r.t) : undefined} />
              ))}
            </ul>
          ) : (
            <p className="py-2 text-[12.5px] text-muted-foreground">Nothing open for {brandName}.</p>
          )}

          {done.length ? (
            <div>
              <button
                type="button"
                onClick={() => setShowDone((v) => !v)}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronDown className={cn("h-3 w-3 transition-transform", showDone && "rotate-180")} />
                Done lately · {done.length}
              </button>
              {showDone ? (
                <ul className="mt-1 divide-y divide-border/50">
                  {done.map((r) => (
                    <RowItem key={r.key} r={r} now={now} brandId={brandId} smm={data.notebook.smm ?? null} onToggle={() => void toggle(r)} />
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {/* Monthly schedule */}
          <ScheduleLine
            data={data}
            editing={editing}
            setEditing={setEditing}
            onSave={async (s) => {
              const res = await fetch(`/api/brand/${brandId}/todos`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ schedule: s }),
              }).catch(() => null);
              if (!res?.ok) {
                const j = (await res?.json().catch(() => null)) as { error?: string } | null;
                toast.error(j?.error ?? "Couldn't save the schedule.");
                return;
              }
              setEditing(false);
              toast.success("Monthly to-dos updated.");
              void load();
            }}
          />

          {!data.ready ? (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11.5px] text-amber-800 dark:text-amber-300">
              One setup step left: run the client to-dos SQL in Supabase. Until then, due dates and the monthly to-dos can&apos;t be saved.
            </p>
          ) : null}
        </div>
      )}
    </Tile>
  );
}

function RowItem({
  r,
  now,
  brandId,
  smm,
  onToggle,
  onClear,
}: {
  r: Row;
  now: string;
  brandId: string;
  smm: Member | null;
  onToggle: () => void;
  onClear?: () => void;
}) {
  const isDone = r.kind === "todo" ? r.t.done : r.n.done;
  const text = r.kind === "todo" ? r.t.text : r.n.text;
  const due = r.kind === "todo" && r.t.due_date ? dueChip(r.t.due_date, now) : null;
  return (
    <li className="group/todo flex items-start gap-2.5 py-2">
      <button
        type="button"
        onClick={onToggle}
        aria-label={isDone ? "Mark as not done" : "Mark as done"}
        className={cn(
          "mt-0.5 flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-md border transition-colors",
          isDone ? "border-emerald-600 bg-emerald-600 text-white" : "border-foreground/30 hover:border-emerald-600 hover:text-emerald-600"
        )}
      >
        {isDone ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
      </button>
      <div className="min-w-0 flex-1">
        <div className={cn("break-words text-[13px] leading-snug", isDone ? "text-muted-foreground line-through decoration-foreground/30" : "text-foreground")}>{text}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10.5px] text-muted-foreground">
          {r.kind === "todo" ? (
            <>
              {r.t.source === "meeting" ? (
                r.t.source_ref ? (
                  <Link href={`/client/${brandId}/meeting/${r.t.source_ref}`} className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 transition-colors hover:border-foreground/40 hover:text-foreground">
                    <Sparkles className="h-2.5 w-2.5" />
                    Meeting
                  </Link>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5">
                    <Sparkles className="h-2.5 w-2.5" />
                    Meeting
                  </span>
                )
              ) : r.t.source === "recurring" ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5">
                  <Repeat className="h-2.5 w-2.5" />
                  Monthly
                </span>
              ) : null}
              <span className="rounded-full bg-muted/70 px-1.5 py-0.5 text-foreground/75">{first(r.t.owner_name, r.t.owner_email)}</span>
              {due ? (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5",
                    !isDone && due.tone === "late" && "bg-red-500/10 font-medium text-red-600 dark:text-red-400",
                    !isDone && due.tone === "today" && "bg-amber-500/15 font-medium text-amber-700 dark:text-amber-300",
                    !isDone && due.tone === "soon" && "bg-muted/70 text-foreground/80",
                    (isDone || due.tone === "later") && "bg-muted/50"
                  )}
                >
                  <CalendarClock className="h-2.5 w-2.5" />
                  {due.label}
                </span>
              ) : null}
            </>
          ) : (
            <>
              <a href={r.n.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 transition-colors hover:border-foreground/40 hover:text-foreground">
                SocialDesk notebook
                <ArrowUpRight className="h-2.5 w-2.5" />
              </a>
              {smm ? <span className="rounded-full bg-muted/70 px-1.5 py-0.5 text-foreground/75">{first(smm.name, smm.email)}</span> : null}
              <span className={cn("rounded-full px-1.5 py-0.5", r.n.late && !isDone ? "bg-red-500/10 font-medium text-red-600 dark:text-red-400" : "bg-muted/50")}>
                {r.n.late ? `From ${r.n.month}` : r.n.month}
              </span>
            </>
          )}
        </div>
      </div>
      {onClear ? (
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear"
          title="Clear this to-do"
          className="mt-0.5 rounded-full p-0.5 text-muted-foreground/60 opacity-40 transition hover:bg-muted hover:text-foreground focus:opacity-100 group-hover/todo:opacity-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </li>
  );
}

function ScheduleLine({
  data,
  editing,
  setEditing,
  onSave,
}: {
  data: Payload;
  editing: boolean;
  setEditing: (v: boolean) => void;
  onSave: (s: Schedule) => Promise<void>;
}) {
  const s = data.schedule;
  const [cal, setCal] = useState<string>(s.calendar_day ? String(s.calendar_day) : "off");
  const [rep, setRep] = useState<string>(s.report === "first_monday" ? "first_monday" : s.report ? String(s.report) : "off");
  const [own, setOwn] = useState<string>(s.owner_email ?? "");
  const [saving, setSaving] = useState(false);
  const ownerName = (() => {
    const e = s.owner_email ?? data.amEmail;
    const m = data.team.find((x) => x.email === e);
    return m ? first(m.name, m.email) : null;
  })();
  const days = Array.from({ length: 28 }, (_, i) => i + 1);
  const parts = [
    s.calendar_day ? `content calendar to the client by the ${ordinal(s.calendar_day)}` : null,
    s.report === "first_monday" ? "report by the first Monday" : s.report ? `report by the ${ordinal(s.report)}` : null,
  ].filter(Boolean);

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2.5 text-[11.5px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Repeat className="h-3 w-3" />
          {parts.length ? (
            <>
              Monthly: {parts.join(" · ")}
              {ownerName ? ` · ${ownerName}` : ""}
            </>
          ) : (
            "No monthly to-dos for this client"
          )}
        </span>
        <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1 transition-colors hover:text-foreground">
          <Settings2 className="h-3 w-3" />
          {parts.length ? "Change" : "Set up"}
        </button>
      </div>
    );
  }
  const sel = "h-8 rounded-lg border border-border bg-panel px-2 text-[12px] text-foreground outline-none focus:border-foreground/50";
  return (
    <div className="space-y-2.5 rounded-xl border border-border/70 bg-panel/60 p-3 text-[12px]">
      <div className="grid gap-2.5 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">Calendar to client by</span>
          <select value={cal} onChange={(e) => setCal(e.target.value)} className={sel}>
            <option value="off">Off</option>
            {days.map((d) => (
              <option key={d} value={d}>
                The {ordinal(d)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">Monthly report by</span>
          <select value={rep} onChange={(e) => setRep(e.target.value)} className={sel}>
            <option value="off">Off</option>
            <option value="first_monday">The first Monday</option>
            {days.map((d) => (
              <option key={d} value={d}>
                The {ordinal(d)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">Who gets them</span>
          <select value={own} onChange={(e) => setOwn(e.target.value)} className={sel}>
            <option value="">The account manager</option>
            {data.team.map((m) => (
              <option key={m.email} value={m.email}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-[11px] text-muted-foreground">Each one shows up about a month ahead, due on that day.</p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            await onSave({
              calendar_day: cal === "off" ? null : Number(cal),
              report: rep === "off" ? null : rep === "first_monday" ? "first_monday" : Number(rep),
              owner_email: own || null,
            });
            setSaving(false);
          }}
          className="inline-flex h-8 items-center gap-1 rounded-lg bg-foreground px-3 text-[12px] font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Save
        </button>
        <button type="button" onClick={() => setEditing(false)} className="h-8 px-2 text-[12px] text-muted-foreground transition-colors hover:text-foreground">
          Cancel
        </button>
      </div>
    </div>
  );
}
