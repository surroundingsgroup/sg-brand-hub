// The Monday "PTO Balances" board (18441242268): one row per person with
// their balance, so Monday holds the same numbers Surroundings shows and
// Justin can work from Monday alone.
//
// Surroundings works the numbers out (lib/pto/ledgers.ts) and writes them
// here. The board is private to Billy and Justin and is never read back:
// anything typed on it by hand is overwritten on the next run. It runs every
// morning (the Brief tool's cron calls /api/pto-sync) and can be run any time.
//
// Rows are matched by the person's name. Someone who leaves the balance list
// keeps their last row; it is not deleted.

import { auditEveryone, fetchLedgers, type LedgerAudit } from "./ledgers";
import { fetchPtoEntries } from "./team";

const API = "https://api.monday.com/v2";
export const PTO_BALANCES_BOARD = "18441242268";
export const PTO_BALANCES_URL = `https://nauticalnetwork.monday.com/boards/${PTO_BALANCES_BOARD}`;
const GROUP = "topics";

const C = {
  balance: "numeric_mm9cmx22",
  manager: "text_mm9cb64e",
  start: "date_mm9chwkd",
  rate: "numeric_mm9cpr1e",
  carried: "numeric_mm9cghqs",
  earned: "numeric_mm9c9bz0",
  used: "numeric_mm9cmnf3",
  booked: "numeric_mm9cskeg",
  next: "date_mm9cpya0",
  atRisk: "numeric_mm9c4kse",
  updated: "date_mm9cb243",
} as const;

async function call<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) throw new Error("MONDAY_API_TOKEN is not set");
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token, "API-Version": "2025-04" },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length || !json.data) throw new Error(json.errors?.map((e) => e.message).join("; ") ?? `HTTP ${res.status}`);
  return json.data;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
const num = (n: number) => String(Math.round(n * 100) / 100);

function valuesFor(a: LedgerAudit, manager: string, today: string): Record<string, unknown> {
  return {
    [C.balance]: num(a.checked),
    [C.manager]: manager,
    [C.start]: a.startDate ? { date: a.startDate } : null,
    [C.rate]: num(a.policyRate ?? a.boardRate),
    [C.carried]: num(a.since.carried),
    [C.earned]: num(a.since.earned),
    [C.used]: num(a.since.used),
    [C.booked]: num(a.since.booked),
    [C.next]: a.nextAnniversary ? { date: a.nextAnniversary } : null,
    [C.atRisk]: num(a.atRiskHours),
    [C.updated]: { date: today },
  };
}

export type PtoBoardSync = { ok: boolean; created: number; updated: number; people: number; error?: string };

/** Work out everyone's balance and write it to the Monday PTO Balances board. */
export async function syncPtoBoard(profiles: { email: string; name: string | null; manager_email: string | null; start_date: string | null }[]): Promise<PtoBoardSync> {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const [usage, ledgers] = await Promise.all([fetchPtoEntries(), fetchLedgers()]);
  if (!usage.ok || !ledgers.ok) return { ok: false, created: 0, updated: 0, people: 0, error: "The time-off boards could not be read." };
  const audits = auditEveryone(ledgers.ledgers, profiles, usage.entries, today);

  const existing = (
    await call<{ boards: { items_page: { items: { id: string; name: string }[] } }[] }>(`query { boards(ids: [${PTO_BALANCES_BOARD}]) { items_page(limit: 200) { items { id name } } } }`)
  ).boards[0].items_page.items;
  const byName = new Map(existing.map((it) => [norm(it.name), it.id] as const));
  const nameOf = (email: string | null) => (email ? profiles.find((p) => p.email.toLowerCase() === email.toLowerCase())?.name?.trim() ?? "" : "");

  let created = 0;
  let updated = 0;
  for (const a of audits) {
    const profile = a.email ? profiles.find((p) => p.email.toLowerCase() === a.email) : profiles.find((p) => norm(p.name ?? "") === norm(a.person));
    const values = valuesFor(a, nameOf(profile?.manager_email ?? null), today);
    const id = byName.get(norm(a.person));
    if (id) {
      await call(`mutation ($b: ID!, $i: ID!, $v: JSON!) { change_multiple_column_values(board_id: $b, item_id: $i, column_values: $v) { id } }`, { b: PTO_BALANCES_BOARD, i: id, v: JSON.stringify(values) });
      updated++;
    } else {
      await call(`mutation ($b: ID!, $g: String!, $n: String!, $v: JSON!) { create_item(board_id: $b, group_id: $g, item_name: $n, column_values: $v) { id } }`, {
        b: PTO_BALANCES_BOARD,
        g: GROUP,
        n: a.person,
        v: JSON.stringify(values),
      });
      created++;
    }
  }
  return { ok: true, created, updated, people: audits.length };
}
