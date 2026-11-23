// Surroundings -> Monday "All Accounts" board.
//
// The contract dates live in ONE place, the Scope on the client page. This
// copies them onto the client's row on the All Accounts board so nobody types
// them twice:
//
//   Contract Start  = the start date on the scope
//   Contract Due    = the last day of the term in force (auto-renewals rolled
//                     forward, so the board never shows a term that has
//                     already renewed)
//   Retention Due   = 60 days before Contract Due, the same day as the
//                     renewal check-in on the calendar
//   Auto Renew      = Yes / No, from the scope
//
// It runs when a scope is saved (that one client) and once every weekday
// morning for everyone (called by the Brief Tool's 9:30 run), which is what
// moves the board forward when a contract auto-renews.
//
// Rules it never breaks:
//   • It only writes those four columns, and only when they differ.
//   • It never clears a date: a scope with no dates leaves the board alone.
//   • If it cannot tell which row is the client's, it writes nothing and says so.
//
// Dates typed straight onto the board for a client that has a scope WILL be
// replaced at the next run. Edit them in Surroundings.

import type { SupabaseClient } from "@supabase/supabase-js";
import { contractNow, effectiveScope } from "./summary";
import { scopeHasContent, type BrandScope } from "./types";

export const ALL_ACCOUNTS_BOARD = 7006568275;
export const RETENTION_DAYS_BEFORE = 60;

const COL = {
  start: "date8__1", // 📅 CONTRACT START
  retention: "date_1__1", // 🔔 RETENTION DUE
  due: "date__1", // 📅 CONTRACT DUE
  clientBoardId: "text_mkzvjab3", // Client Board ID
  company: "status9__1", // INTERNAL CO.
  autoRenew: "color_mm9c6s8s", // AUTO RENEW (Yes / No)
} as const;

// Which group a row sits in decides ties when two rows share a name
// (e.g. a client that is both a retainer and a Hive hosting account).
const GROUP_RANK = [
  "Active Retainer Clients",
  "Transitioned Active Retainer Clients",
  "Active Existing Clients (Touch Monthly)",
  "New Client Intake",
  "Inactive Clients",
];

export type BoardRow = {
  id: string;
  name: string;
  group: string;
  start: string;
  retention: string;
  due: string;
  clientBoardId: string;
  company: string;
  autoRenew: string; // "Yes" | "No" | ""
};

export type BoardBrand = {
  id: string;
  business_name: string;
  monday_board_id: string | number | null;
  scope: BrandScope | null;
};

export async function mondayApi<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) throw new Error("Monday is not configured");
  const res = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token, "API-Version": "2024-10" },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  if (!json.data) throw new Error(`Monday returned HTTP ${res.status}`);
  return json.data;
}

type ItemsPage = {
  cursor: string | null;
  items: { id: string; name: string; group: { title: string }; column_values: { id: string; text: string | null }[] }[];
};

export async function readAccountsBoard(): Promise<BoardRow[]> {
  const cols = JSON.stringify(Object.values(COL));
  const fields = `cursor items { id name group { title } column_values(ids: ${cols}) { id text } }`;
  const out: BoardRow[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 20; guard++) {
    const page: ItemsPage = cursor
      ? (await mondayApi<{ next_items_page: ItemsPage }>(`query ($c: String!) { next_items_page(limit: 200, cursor: $c) { ${fields} } }`, { c: cursor }))
          .next_items_page
      : (await mondayApi<{ boards: { items_page: ItemsPage }[] }>(`query ($b: [ID!]) { boards(ids: $b) { items_page(limit: 200) { ${fields} } } }`, {
          b: [String(ALL_ACCOUNTS_BOARD)],
        })).boards[0].items_page;
    for (const it of page.items) {
      const v = (id: string) => it.column_values.find((c) => c.id === id)?.text?.trim() ?? "";
      out.push({
        id: String(it.id),
        name: it.name,
        group: it.group?.title ?? "",
        start: v(COL.start).slice(0, 10),
        retention: v(COL.retention).slice(0, 10),
        due: v(COL.due).slice(0, 10),
        clientBoardId: v(COL.clientBoardId),
        company: v(COL.company),
        autoRenew: v(COL.autoRenew),
      });
    }
    cursor = page.cursor;
    if (!cursor) break;
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");

// One row out of several candidates, or null when it is a genuine toss-up.
function pick(cands: BoardRow[]): BoardRow | null {
  if (cands.length <= 1) return cands[0] ?? null;
  const rank = (r: BoardRow) => {
    const g = GROUP_RANK.indexOf(r.group);
    // A Hive website/hosting row is never the retainer contract.
    return (g < 0 ? GROUP_RANK.length : g) + (/hive/i.test(r.company) ? 100 : 0);
  };
  const sorted = [...cands].sort((a, b) => rank(a) - rank(b));
  return rank(sorted[0]) < rank(sorted[1]) ? sorted[0] : null;
}

export type RowMatch = { row: BoardRow; how: "linked" | "client board" | "name" | "close name" } | { row: null; why: string };

export function findAccountRow(brand: BoardBrand, rows: BoardRow[]): RowMatch {
  const linked = brand.scope?.monday_account_item_id;
  if (linked) {
    const row = rows.find((r) => r.id === String(linked));
    if (row) return { row, how: "linked" };
  }
  const name = norm(brand.business_name);
  if (!name) return { row: null, why: "no name" };
  // Two names belong together when one starts with the other
  // ("Bertram" / "Bertram Yachts", "Bayliner" / "Bayliner Boats").
  const related = (r: BoardRow) => {
    const n = norm(r.name.replace(/\(.*?\)/g, ""));
    return n.length >= 5 && name.length >= 5 && (name.startsWith(n) || n.startsWith(name));
  };
  // The Client Board ID is a strong link, but only when the names agree too:
  // some rows carry another client's board id (Global Jet Sales pointed at
  // Modern Grounds, Solana at Ryan Hughes Design), and a blind match would
  // write one client's dates onto another client's row.
  const boardId = brand.monday_board_id ? String(brand.monday_board_id).trim() : "";
  if (boardId) {
    const row = pick(rows.filter((r) => r.clientBoardId === boardId && (norm(r.name) === name || related(r))));
    if (row) return { row, how: "client board" };
  }
  const exact = rows.filter((r) => norm(r.name) === name);
  if (exact.length) {
    const row = pick(exact);
    return row ? { row, how: "name" } : { row: null, why: `${exact.length} rows share this name` };
  }
  // "Bertram" on the board is "Bertram Yachts" here, and so on. Only when one
  // name starts with the other, and only when that points at a single row.
  const close = rows.filter(related);
  if (close.length) {
    const row = pick(close);
    return row ? { row, how: "close name" } : { row: null, why: `${close.length} rows have a similar name` };
  }
  return { row: null, why: "no row with this name on the All Accounts board" };
}

function minusDays(iso: string, n: number): string {
  const d = new Date(iso.slice(0, 10) + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** What the board should show for this scope, or null when the scope has no dates. */
export function boardDatesFor(scope: BrandScope | null, now: Date = contractNow()): { start?: string; due?: string; retention?: string } | null {
  if (!scope?.start_date && !scope?.end_date) return null;
  const due = effectiveScope(scope, now).end_date?.slice(0, 10);
  return {
    start: scope.start_date?.slice(0, 10),
    due,
    retention: due ? minusDays(due, RETENTION_DAYS_BEFORE) : undefined,
  };
}

export type AccountSyncLine = {
  brandId: string;
  name: string;
  status: "updated" | "unchanged" | "unmatched" | "no dates" | "error";
  row?: string; // the board row it matched
  how?: string;
  changes?: string[]; // "Contract Due 2026-09-15 -> 2027-10-05"
  detail?: string;
};

export type AccountSyncReport = {
  dry: boolean;
  checked: number;
  updated: number;
  unchanged: number;
  unmatched: number;
  errors: number;
  lines: AccountSyncLine[];
};

const hasScope = scopeHasContent;

export async function syncAccountsBoard(
  supabase: SupabaseClient,
  opts: { dry?: boolean; brandId?: string; now?: Date } = {}
): Promise<AccountSyncReport> {
  const dry = !!opts.dry;
  const now = opts.now ?? contractNow();
  let q = supabase.from("brands").select("id, business_name, monday_board_id, scope").order("business_name");
  if (opts.brandId) q = q.eq("id", opts.brandId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const brands = ((data ?? []) as BoardBrand[]).filter((b) => hasScope(b.scope));

  const report: AccountSyncReport = { dry, checked: 0, updated: 0, unchanged: 0, unmatched: 0, errors: 0, lines: [] };
  if (!brands.length) return report;
  const rows = await readAccountsBoard();

  for (const b of brands) {
    const want = boardDatesFor(b.scope, now) ?? {};
    if (!want.start && !want.due && b.scope?.auto_renew == null) {
      report.lines.push({ brandId: b.id, name: b.business_name, status: "no dates" });
      continue;
    }
    report.checked++;
    const m = findAccountRow(b, rows);
    if (!m.row) {
      report.unmatched++;
      report.lines.push({ brandId: b.id, name: b.business_name, status: "unmatched", detail: m.why });
      continue;
    }
    const row = m.row;
    const diffs: { col: string; label: string; from: string; to: string; value: unknown }[] = [];
    const date = (col: string, label: string, from: string, to: string | undefined) => {
      if (to && to !== from) diffs.push({ col, label, from, to, value: { date: to } });
    };
    date(COL.start, "Contract Start", row.start, want.start);
    date(COL.due, "Contract Due", row.due, want.due);
    date(COL.retention, "Retention Due", row.retention, want.retention);
    // Auto Renew: Yes / No, only when the scope says one way or the other.
    const auto = b.scope?.auto_renew === true ? "Yes" : b.scope?.auto_renew === false ? "No" : "";
    if (auto && auto !== row.autoRenew) diffs.push({ col: COL.autoRenew, label: "Auto Renew", from: row.autoRenew, to: auto, value: { label: auto } });
    const changes = diffs.map((d) => `${d.label} ${d.from || "(blank)"} -> ${d.to}`);
    try {
      if (!dry) {
        // Remember which row is this client's, so a renamed row still matches.
        if (m.how !== "linked") {
          const { data: fresh } = await supabase.from("brands").select("scope").eq("id", b.id).maybeSingle();
          const current = ((fresh?.scope as BrandScope | null) ?? b.scope) as BrandScope;
          await supabase.from("brands").update({ scope: { ...current, monday_account_item_id: row.id } }).eq("id", b.id);
        }
        if (diffs.length) {
          const values = Object.fromEntries(diffs.map((d) => [d.col, d.value]));
          await mondayApi(
            `mutation ($b: ID!, $i: ID!, $v: JSON!) { change_multiple_column_values(board_id: $b, item_id: $i, column_values: $v) { id } }`,
            { b: String(ALL_ACCOUNTS_BOARD), i: row.id, v: JSON.stringify(values) }
          );
        }
      }
      if (diffs.length) {
        report.updated++;
        report.lines.push({ brandId: b.id, name: b.business_name, status: "updated", row: row.name, how: m.how, changes });
      } else {
        report.unchanged++;
        report.lines.push({ brandId: b.id, name: b.business_name, status: "unchanged", row: row.name, how: m.how });
      }
    } catch (e) {
      report.errors++;
      report.lines.push({ brandId: b.id, name: b.business_name, status: "error", row: row.name, detail: (e as Error).message });
    }
  }
  return report;
}
