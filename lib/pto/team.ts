// PTO balances for the team: everyone's start date and every approved time-off
// request on the Monday "Time Off Request" boards, run through the policy math
// in ./policy.
//
// What counts as used: a request that is Approved or Complete, not marked
// Unpaid, and is actual time off (working from home or remotely is not).
// Unapproved and unpaid requests are kept as the open queue.
//
// Who sees what (Billy, 2026-11-23): each person their own, managers their
// team, Billy and Justin everyone. Until the start dates and balances have
// been checked, only Billy and Justin see balances at all (PTO_OPEN_TO_TEAM).

import { ptoStatement, type PtoStatement } from "./policy";
import { SEES_EVERYTHING } from "../access";

export const PTO_OPEN_TO_TEAM = true; // switched on 2026-11-23 by Billy: "turn it on, let's roll it out"
export const PTO_ADMIN_NAMES = SEES_EVERYTHING;

const API = "https://api.monday.com/v2";
// Newest first: the board in use, the one before it, and the 2022 original.
const BOARDS = ["9612850479", "4395377522", "2715552841"];

export type PtoEntry = {
  person: string; // normalized name
  rawName: string;
  created: string; // the day the request was filed, YYYY-MM-DD
  status: string;
  from: string; // YYYY-MM-DD
  to: string;
  hours: number;
  estimated: boolean; // hours worked out from the dates because none were entered
  unpaid: boolean;
  notTimeOff: boolean;
  url: string;
};

export type PtoPerson = {
  name: string;
  email: string;
  managerEmail: string | null;
  startDate: string | null;
  statement: PtoStatement | null;
  counted: number; // approved requests counted
  estimated: number; // of those, how many had their hours estimated
  open: PtoEntry[]; // new or unpaid requests
};

export const normName = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

// People who filed requests in the past and are no longer on the team full
// time (Billy, 2026-11-23). They are left out of every PTO list. Requests were
// often filed under a first name alone, so those are listed too.
const FORMER_TEAM = ["Andre Gonzalez", "Brandon Ricketts", "Justin Roseman", "Noah Rahman", "Sophia Moore", "Loic Gergaud", "Andre", "Brandon", "Noah", "Sophia", "Loic"];
const unaccent = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const FORMER = new Set(FORMER_TEAM.map((n) => normName(unaccent(n))));
export const isFormerTeam = (name: string) => FORMER.has(normName(unaccent(name)));

// People who file time off here but do not have a balance kept in Surroundings (Billy, 2026-11-23: "I really don't
// need one for Arial, Stephen, Justin and I"). Rendi works from overseas and is not on the US PTO policy (handbook 6.2
// covers regular full-time employees). They can still use the request form; they are left out of every balance list.
export const PTO_NOT_TRACKED = ["Billy Pavlock", "Justin Tarr", "Arial Pavlock", "Stephen Massaro", "Rendi Andrianto"];
const NOT_TRACKED = new Set(PTO_NOT_TRACKED.map((n) => normName(unaccent(n))));
export const isNotTracked = (name: string | null | undefined) => !!name && NOT_TRACKED.has(normName(unaccent(name)));

/** Does a name on a time-off request belong to this person? Full name, a lone first name, or a short first name with the same last name. */
export function sameRequester(requestName: string, fullName: string): boolean {
  const asked = normName(requestName);
  const full = normName(fullName);
  if (!asked || !full) return false;
  if (asked === full) return true;
  const w = asked.split(" ");
  const f = full.split(" ");
  if (w.length === 1 || f.length === 1) return w[0] === f[0];
  return w.slice(1).join(" ") === f.slice(1).join(" ") && (f[0].startsWith(w[0]) || w[0].startsWith(f[0]));
}

function weekdays(a: string, b: string): number {
  let n = 0;
  const end = new Date(`${b}T12:00:00Z`);
  for (const d = new Date(`${a}T12:00:00Z`); d <= end; d.setUTCDate(d.getUTCDate() + 1)) if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) n++;
  return n;
}

type Col = { id: string; title: string; type: string };
type Item = { id: string; name: string; created_at?: string | null; column_values: { id: string; text: string | null }[] };

async function call<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) throw new Error("monday_not_configured");
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token, "API-Version": "2025-04" },
    body: JSON.stringify({ query, variables }),
    next: { revalidate: 300 },
  });
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length || !json.data) throw new Error(json.errors?.map((e) => e.message).join("; ") ?? `HTTP ${res.status}`);
  return json.data;
}

/** Every request on the three boards, tests removed and a request logged on two boards counted once. */
export async function fetchPtoEntries(): Promise<{ ok: boolean; entries: PtoEntry[] }> {
  try {
    const all: PtoEntry[] = [];
    for (const board of BOARDS) {
      const meta = (await call<{ boards: { columns: Col[] }[] }>("query($b:[ID!]){ boards(ids:$b){ columns{ id title type } } }", { b: [board] })).boards[0];
      const col = (re: RegExp) => meta.columns.find((c) => re.test(c.title));
      const cStatus = meta.columns.find((c) => c.id === "status") ?? col(/^status$/i);
      const cHours = col(/hours requested/i);
      const cTimeline = col(/time off dates/i);
      const cStart = col(/^start date$/i);
      const cEnd = col(/^end date$/i);
      const cWorkDays = col(/working days/i);
      const cUnpaid = col(/unpaid/i);
      const cAway = col(/status while away/i);
      let cursor: string | null = null;
      for (let guard = 0; guard < 10; guard++) {
        const page: { cursor: string | null; items: Item[] } = cursor
          ? (await call<{ next_items_page: { cursor: string | null; items: Item[] } }>("query($c:String!){ next_items_page(limit:200, cursor:$c){ cursor items{ id name created_at column_values{ id text } } } }", { c: cursor })).next_items_page
          : (await call<{ boards: { items_page: { cursor: string | null; items: Item[] } }[] }>("query($b:[ID!]){ boards(ids:$b){ items_page(limit:200){ cursor items{ id name created_at column_values{ id text } } } } }", { b: [board] })).boards[0].items_page;
        for (const it of page.items) {
          if (/test/i.test(it.name)) continue;
          const v = (c: Col | undefined) => (c ? (it.column_values.find((x) => x.id === c.id)?.text ?? "").trim() : "");
          const tl = v(cTimeline).match(/(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})/);
          const from = tl?.[1] ?? v(cStart).slice(0, 10);
          if (!from) continue;
          const to = tl?.[2] ?? (v(cEnd).slice(0, 10) || from);
          const away = v(cAway);
          const entered = Number(v(cHours)) > 0;
          let hours = Number(v(cHours)) || 0;
          let estimated = false;
          if (!hours && Number(v(cWorkDays)) > 0) {
            hours = Number(v(cWorkDays)) * 8;
            estimated = true;
          }
          if (!hours) {
            hours = weekdays(from, to) * (/half/i.test(away) ? 4 : 8);
            estimated = true;
          }
          all.push({
            person: normName(it.name),
            rawName: it.name.trim(),
            created: (it.created_at ?? "").slice(0, 10),
            status: v(cStatus) || "",
            from,
            to,
            hours,
            estimated,
            unpaid: v(cUnpaid).toLowerCase() === "unpaid",
            // Working from home or remotely is not time off. "Can partially work" and "Other" count only when hours were entered.
            notTimeOff: /working (from home|remote)/i.test(away) || (/partially work|other/i.test(away) && !entered),
            url: `https://nauticalnetwork.monday.com/boards/${board}/pulses/${it.id}`,
          });
        }
        cursor = page.cursor;
        if (!cursor) break;
      }
    }
    const seen = new Set<string>();
    const entries = all.filter((r) => {
      const k = `${r.person}|${r.from}|${r.to}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return { ok: true, entries };
  } catch {
    return { ok: false, entries: [] };
  }
}

export const countsAsUsed = (r: PtoEntry) => /^(approved|complete)$/i.test(r.status) && !r.unpaid && !r.notTimeOff;
export const isOpenRequest = (r: PtoEntry) => /new request/i.test(r.status) || (r.unpaid && !/rejected/i.test(r.status));

export type ProfileRow = { name: string | null; email: string; start_date: string | null; manager_email: string | null };

/**
 * Balances for every profile, plus the names on the boards that could not be
 * tied to anyone. A request filed under a lone first name is tied to a person
 * when exactly one profile has that first name; a full name with a different
 * last name is always a different person.
 */
export function buildPtoTeam(profiles: ProfileRow[], entries: PtoEntry[], asOf: string): { people: PtoPerson[]; unmatched: { name: string; requests: number }[] } {
  const full = profiles.map((p) => normName(p.name ?? ""));
  const alias = new Map<string, string>();
  for (const r of entries) {
    if (full.includes(r.person) || alias.has(r.person)) continue;
    const words = r.person.split(" ");
    const cands = full.filter((f) => {
      const fw = f.split(" ");
      if (words.length === 1) return fw[0] === words[0];
      return fw.slice(1).join(" ") === words.slice(1).join(" ") && fw[0].startsWith(words[0]);
    });
    if (cands.length === 1) alias.set(r.person, cands[0]);
  }
  const keyOf = (r: PtoEntry) => alias.get(r.person) ?? r.person;

  const people: PtoPerson[] = profiles.map((p) => {
    const key = normName(p.name ?? "");
    const mine = entries.filter((r) => keyOf(r) === key);
    const used = mine.filter(countsAsUsed);
    const start = p.start_date?.slice(0, 10) || null;
    return {
      name: (p.name ?? "").trim() || p.email.split("@")[0],
      email: p.email.toLowerCase(),
      managerEmail: p.manager_email?.toLowerCase() ?? null,
      startDate: start,
      statement: start ? ptoStatement(start, used.map((r) => ({ date: r.from, hours: r.hours })), asOf) : null,
      counted: used.length,
      estimated: used.filter((r) => r.estimated).length,
      open: mine.filter(isOpenRequest),
    };
  });

  const known = new Set(full);
  const others = new Map<string, number>();
  const since = `${Number(asOf.slice(0, 4)) - 1}-01-01`;
  for (const r of entries) {
    if (known.has(keyOf(r)) || r.from < since || isFormerTeam(r.rawName)) continue;
    others.set(r.rawName, (others.get(r.rawName) ?? 0) + 1);
  }
  return { people, unmatched: [...others.entries()].map(([name, requests]) => ({ name, requests })).sort((a, b) => b.requests - a.requests) };
}
