// Client to-dos. Every to-do is a row in my_todos under one person's email,
// so it shows on their To-dos card in My Surroundings; a client's to-dos are
// the rows tagged with that client (brand_id), whoever owns them. Where they
// come from (source):
//   manual     typed in on the client page (or My Surroundings)
//   meeting    an action item from saved meeting notes
//   recurring  the monthly ones: content calendar to the client for review
//              (by the 20th) and the monthly report (by the first Monday)
// Plus, read live from SocialDesk, the client's notebook "To Produce" items.
//
// The text always starts "<Client>: " so My Surroundings reads well on its own.
//
// Until the client_todos migration runs, the extra columns are missing; the
// helpers fall back to plain rows matched by that text prefix.

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type ClientTodo = {
  id: string;
  text: string; // without the "<Client>: " prefix
  done: boolean;
  done_at: string | null;
  created_at: string;
  owner_email: string;
  owner_name: string | null;
  due_date: string | null;
  source: "manual" | "meeting" | "recurring" | null;
  source_ref: string | null;
};

export type TodoSchedule = {
  /** Day of the month the next month's content calendar goes to the client; null = off. */
  calendar_day: number | null;
  /** When last month's report is due: "first_monday", a day of the month, or null = off. */
  report: "first_monday" | number | null;
  /** Who gets them; null = the client's account manager. */
  owner_email: string | null;
};

export const DEFAULT_SCHEDULE: TodoSchedule = { calendar_day: 20, report: "first_monday", owner_email: null };

export type NewTodo = {
  owner_email: string;
  text: string;
  brand_id?: string | null;
  due_date?: string | null;
  source?: string | null;
  source_ref?: string | null;
};

const EXT = ["brand_id", "due_date", "source", "source_ref"] as const;

/** A column the client_todos migration adds is not there yet. */
export function missingColumn(e: { code?: string; message?: string } | null | undefined): boolean {
  return !!e && (e.code === "42703" || e.code === "PGRST204" || /column .* does not exist|could not find the .* column/i.test(e.message ?? ""));
}

/** Insert to-dos, without the new columns if the migration has not run yet. */
export async function insertTodos(rows: NewTodo[]): Promise<{ count: number; extended: boolean }> {
  if (!rows.length) return { count: 0, extended: true };
  const admin = createSupabaseAdminClient();
  const clean = rows.map((r) => ({ ...r, owner_email: r.owner_email.toLowerCase(), text: r.text.slice(0, 300) }));
  const { error } = await admin.from("my_todos").insert(clean);
  if (!error) return { count: clean.length, extended: true };
  if (!missingColumn(error)) throw new Error(error.message);
  const plain = clean.map((r) => {
    const o: Record<string, unknown> = { ...r };
    for (const k of EXT) delete o[k];
    return o;
  });
  const { error: e2 } = await admin.from("my_todos").insert(plain);
  if (e2) throw new Error(e2.message);
  return { count: plain.length, extended: false };
}

export const prefixFor = (client: string) => `${client}: `;
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

// ── Dates (Eastern) ─────────────────────────────────────────────────────────
export function easternToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}
const iso = (y: number, m0: number, d: number) => {
  const dt = new Date(Date.UTC(y, m0, d));
  return dt.toISOString().slice(0, 10);
};
const daysIn = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
const dayOf = (y: number, m0: number, d: number) => iso(y, m0, Math.min(Math.max(1, d), daysIn(y, m0)));
function firstMonday(y: number, m0: number): string {
  const dow = new Date(Date.UTC(y, m0, 1)).getUTCDay(); // 0 = Sunday
  return iso(y, m0, 1 + ((8 - dow) % 7));
}
const monthName = (y: number, m0: number) => new Date(Date.UTC(y, m0, 15)).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
const ym = (y: number, m0: number) => {
  const d = new Date(Date.UTC(y, m0, 15));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

/** Read a saved schedule (brands.todo_schedule); null when none is saved. */
export function parseSchedule(raw: unknown): TodoSchedule | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const day = (v: unknown) => (typeof v === "number" && v >= 1 && v <= 28 ? Math.round(v) : null);
  return {
    calendar_day: day(o.calendar_day),
    report: o.report === "first_monday" ? "first_monday" : day(o.report),
    owner_email: typeof o.owner_email === "string" && o.owner_email.includes("@") ? o.owner_email.toLowerCase() : null,
  };
}

/** The recurring to-dos due in the next `lead` days for this schedule. */
export function upcomingRecurring(s: TodoSchedule, today: string, client: string, contactFirst: string | null, lead = 30) {
  const [ty, tm] = today.split("-").map(Number);
  const out: { ref: string; text: string; due_date: string }[] = [];
  const who = contactFirst || "the client";
  for (const k of [0, 1]) {
    const y = ty;
    const m0 = tm - 1 + k;
    if (s.calendar_day) {
      const due = dayOf(y, m0, s.calendar_day);
      const gap = daysBetween(today, due);
      if (gap >= 0 && gap <= lead) {
        out.push({ ref: `calendar:${ym(y, m0 + 1)}`, due_date: due, text: `${prefixFor(client)}Send the ${monthName(y, m0 + 1)} content calendar to ${who} for review` });
      }
    }
    if (s.report) {
      const yy = new Date(Date.UTC(y, m0, 15));
      const due = s.report === "first_monday" ? firstMonday(yy.getUTCFullYear(), yy.getUTCMonth()) : dayOf(y, m0, s.report);
      const gap = daysBetween(today, due);
      if (gap >= 0 && gap <= lead) {
        out.push({ ref: `report:${ym(y, m0 - 1)}`, due_date: due, text: `${prefixFor(client)}Send the ${monthName(y, m0 - 1)} report to ${who}` });
      }
    }
  }
  return out;
}

// ── Team ────────────────────────────────────────────────────────────────────
export type TeamMember = { email: string; name: string };
export async function teamDirectory(): Promise<TeamMember[]> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("team_profiles").select("email, name").order("name");
  return ((data ?? []) as { email: string | null; name: string | null }[])
    .filter((p) => p.email && p.name)
    .map((p) => ({ email: p.email!.toLowerCase(), name: p.name!.trim() }));
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, "").trim();
export function emailForName(team: TeamMember[], name: string | null | undefined): string | null {
  const n = norm(name ?? "");
  if (!n) return null;
  const exact = team.find((p) => norm(p.name) === n);
  if (exact) return exact.email;
  const first = team.filter((p) => norm(p.name).split(" ")[0] === n.split(" ")[0]);
  return first.length === 1 ? first[0].email : null;
}

// ── Recurring generation ────────────────────────────────────────────────────
/**
 * Make sure this client's recurring to-dos for the coming month exist. Safe to
 * call on every page load: each one is made once (a cleared one is marked
 * done, not deleted, so it does not come back).
 */
export async function ensureRecurring(input: {
  brandId: string;
  client: string;
  contactFirst: string | null;
  schedule: TodoSchedule;
  ownerEmail: string | null;
  today?: string;
}): Promise<number> {
  const owner = input.schedule.owner_email || input.ownerEmail;
  if (!owner) return 0;
  const due = upcomingRecurring(input.schedule, input.today ?? easternToday(), input.client, input.contactFirst);
  if (!due.length) return 0;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("my_todos")
    .select("source_ref")
    .eq("brand_id", input.brandId)
    .eq("source", "recurring")
    .in(
      "source_ref",
      due.map((d) => d.ref)
    );
  if (error) return 0; // migration not run yet: nothing to track them by
  const have = new Set(((data ?? []) as { source_ref: string }[]).map((r) => r.source_ref));
  const fresh = due.filter((d) => !have.has(d.ref));
  if (!fresh.length) return 0;
  const { count } = await insertTodos(
    fresh.map((d) => ({ owner_email: owner, text: d.text, brand_id: input.brandId, due_date: d.due_date, source: "recurring", source_ref: d.ref }))
  );
  return count;
}

// ── Reading a client's list ─────────────────────────────────────────────────
export async function listClientTodos(brandId: string, client: string, team: TeamMember[]): Promise<{ ready: boolean; todos: ClientTodo[] }> {
  const admin = createSupabaseAdminClient();
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const nameOf = (email: string) => team.find((p) => p.email === email.toLowerCase())?.name ?? null;
  const strip = (t: string) => (t.startsWith(prefixFor(client)) ? t.slice(prefixFor(client).length) : t);
  const ext = await admin
    .from("my_todos")
    .select("id, text, done, done_at, created_at, owner_email, due_date, source, source_ref")
    .eq("brand_id", brandId)
    .or(`done.eq.false,done_at.gte.${since}`)
    .order("done", { ascending: true })
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(150);
  if (!ext.error) {
    return {
      ready: true,
      todos: ((ext.data ?? []) as Omit<ClientTodo, "owner_name">[]).map((r) => ({ ...r, text: strip(r.text), owner_name: nameOf(r.owner_email) })),
    };
  }
  // Before the migration: the client's to-dos by their text.
  const plain = await admin
    .from("my_todos")
    .select("id, text, done, done_at, created_at, owner_email")
    .like("text", `${likeEscape(prefixFor(client))}%`)
    .or(`done.eq.false,done_at.gte.${since}`)
    .order("done", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(150);
  return {
    ready: false,
    todos: ((plain.data ?? []) as { id: string; text: string; done: boolean; done_at: string | null; created_at: string; owner_email: string }[]).map((r) => ({
      ...r,
      text: strip(r.text),
      owner_name: nameOf(r.owner_email),
      due_date: null,
      source: null,
      source_ref: null,
    })),
  };
}

// ── SocialDesk notebook ─────────────────────────────────────────────────────
export type NotebookTask = { id: string; text: string; done: boolean; month: string; late: boolean; client: string; url: string };
export type ClientNotebook = { found: boolean; tasks: NotebookTask[]; url?: string; smm?: TeamMember | null; am?: TeamMember | null };

function socialdesk() {
  const token = process.env.SOCIALDESK_PROVISION_TOKEN;
  const base = (process.env.SOCIALDESK_URL ?? "https://socialdesk-lac.vercel.app").replace(/\/$/, "");
  return token ? { token, base } : null;
}

export async function clientNotebook(client: string): Promise<ClientNotebook> {
  const sd = socialdesk();
  if (!sd) return { found: false, tasks: [] };
  try {
    const res = await fetch(`${sd.base}/api/hub-notebook?client_name=${encodeURIComponent(client)}`, {
      headers: { Authorization: `Bearer ${sd.token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    const j = (await res.json()) as ClientNotebook;
    const low = (p?: TeamMember | null) => (p?.email ? { name: p.name, email: p.email.toLowerCase() } : null);
    return { found: !!j.found, tasks: Array.isArray(j.tasks) ? j.tasks : [], url: j.url, smm: low(j.smm), am: low(j.am) };
  } catch {
    return { found: false, tasks: [] };
  }
}

export async function personNotebook(email: string): Promise<NotebookTask[]> {
  const sd = socialdesk();
  if (!sd) return [];
  try {
    const res = await fetch(`${sd.base}/api/hub-notebook?assignee_email=${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${sd.token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    const j = (await res.json()) as { tasks?: NotebookTask[] };
    return Array.isArray(j.tasks) ? j.tasks : [];
  } catch {
    return [];
  }
}

/** Names of the clients with a SocialDesk calendar (social was sold). */
export async function socialdeskClients(): Promise<string[]> {
  const sd = socialdesk();
  if (!sd) return [];
  try {
    const res = await fetch(`${sd.base}/api/hub-notebook?list=1`, { headers: { Authorization: `Bearer ${sd.token}` }, next: { revalidate: 600 } });
    const j = (await res.json()) as { clients?: string[] };
    return Array.isArray(j.clients) ? j.clients : [];
  } catch {
    return [];
  }
}

export async function setNotebookDone(client: string, taskId: string, done: boolean): Promise<boolean> {
  const sd = socialdesk();
  if (!sd) return false;
  const res = await fetch(`${sd.base}/api/hub-notebook`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${sd.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: client, task_id: taskId, done }),
    cache: "no-store",
  }).catch(() => null);
  return !!res?.ok;
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
/** Same loose name match SocialDesk uses. */
export function hasSocialdesk(names: string[], client: string): boolean {
  const n = squash(client);
  if (!n) return false;
  if (names.some((x) => squash(x) === n)) return true;
  const c = names.filter((x) => {
    const m = squash(x);
    const [a, b] = m.length <= n.length ? [m, n] : [n, m];
    return a.length >= 5 && b.startsWith(a);
  });
  return c.length === 1;
}

/**
 * Recurring to-dos for every client this person is the AM of (or owns the
 * schedule for). Run when their My Surroundings loads, so the monthly ones
 * show up without anyone opening the client page.
 */
// Checked at most every 20 minutes per person on a server, so My Surroundings
// doesn't pay for it on every load.
const recurringCheckedAt = new Map<string, number>();

export async function ensureRecurringForPerson(email: string): Promise<void> {
  const key = email.toLowerCase();
  if (Date.now() - (recurringCheckedAt.get(key) ?? 0) < 20 * 60 * 1000) return;
  recurringCheckedAt.set(key, Date.now());
  const admin = createSupabaseAdminClient();
  const team = await teamDirectory();
  const me = team.find((p) => p.email === key);
  if (!me) return;
  // Only this person's clients: AM by name (either column) or owner of the schedule.
  const quoted = `"${me.name.replace(/"/g, "")}"`;
  const [{ data }, names] = await Promise.all([
    admin
      .from("brands")
      .select("id, business_name, account_manager, am, submitter_name, status, todo_schedule")
      .or(`account_manager.ilike.${quoted},am.ilike.${quoted},todo_schedule->>owner_email.eq.${key}`),
    socialdeskClients(),
  ]);
  const brands = ((data ?? []) as Record<string, unknown>[]).filter((b) => b.status !== "archived");
  const today = easternToday();
  await Promise.all(
    brands.map(async (b) => {
      const saved = parseSchedule(b.todo_schedule);
      const amEmail = emailForName(team, (b.account_manager as string | null) ?? (b.am as string | null));
      const owner = saved?.owner_email || amEmail;
      if (owner !== me.email) return;
      const client = String(b.business_name ?? "");
      const schedule = saved ?? (hasSocialdesk(names, client) ? DEFAULT_SCHEDULE : null);
      if (!schedule) return;
      const first = String(b.submitter_name ?? "").trim().split(/\s+/)[0] || null;
      await ensureRecurring({ brandId: String(b.id), client, contactFirst: first, schedule, ownerEmail: amEmail, today }).catch(() => 0);
    })
  );
}
