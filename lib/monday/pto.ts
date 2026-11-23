// The Monday "Time Off Request" board (9612850479): reading requests and
// filing new ones from Surroundings.
//
// The board runs the approval flow by itself, with automations Justin built:
//   - a new request is set to "New request" and its Team picks the approver
//     (Content -> Austin, Social -> Sean, Account Management -> Arial,
//     Administrative -> Justin)
//   - when the status changes to Approved, the person in the Requestor column
//     decides which individual PTO board gets the hours as a Usage row
//
// So a request filed from here has to look exactly like one filed on the
// Monday form: the person's name as the item name, the Time off Dates
// timeline, Hours Requested, Status while away, Team and Requestor.
//
// One catch. Surroundings writes to Monday with one account's token, so that
// account is the item's creator, and an automation puts the creator in the
// Requestor column. A few seconds after filing, the Requestor column is set
// back to the person who asked.

import { workingDays } from "@/lib/pto/holidays";

const MONDAY_API_URL = "https://api.monday.com/v2";
const PTO_BOARD_ID = process.env.MONDAY_BOARD_ID_PTO ?? "9612850479";
export const PTO_BOARD_URL = `https://nauticalnetwork.monday.com/boards/${PTO_BOARD_ID}`;

const COL = {
  status: "status",
  team: "status_12",
  type: "status_1", // "Status while away"
  hours: "numbers",
  dates: "timeline",
  requestor: "multiple_person_mkw9sn2y",
  approver: "people6",
} as const;

async function mondayFetch<T>(query: string, variables?: Record<string, unknown>, opts: { fresh?: boolean } = {}): Promise<T> {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) throw new Error("MONDAY_API_TOKEN is not set");
  const res = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token, "API-Version": "2025-04" },
    body: JSON.stringify({ query, variables }),
    ...(opts.fresh ? { cache: "no-store" as const } : { next: { revalidate: 60 } }),
  });
  if (!res.ok) throw new Error(`Monday HTTP ${res.status}`);
  const body = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join("; "));
  if (!body.data) throw new Error("Monday returned no data");
  return body.data;
}

// ---------------------------------------------------------------- reading

export type PtoRequest = {
  id: string;
  name: string; // the item name: by convention the person's name
  requestor_name: string | null; // the Requestor column, when filled
  start_date: string | null;
  end_date: string | null;
  kind: string | null; // "Time off - Vacation" or "Half Day"
  hours: number | null;
  team: string | null;
  approver: string | null;
  status: string | null;
  created_at: string | null;
  monday_url: string;
};

type RawItem = { id: string; name: string; created_at?: string | null; column_values: Array<{ id: string; text: string | null }> };

export async function fetchPtoRequests(): Promise<{ ok: boolean; items: PtoRequest[]; error?: string }> {
  try {
    const items: PtoRequest[] = [];
    const fields = `cursor items { id name created_at column_values(ids: ${JSON.stringify(Object.values(COL))}) { id text } }`;
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard++) {
      const page: { cursor: string | null; items: RawItem[] } = cursor
        ? (await mondayFetch<{ next_items_page: { cursor: string | null; items: RawItem[] } }>(`query ($c: String!) { next_items_page(limit: 200, cursor: $c) { ${fields} } }`, { c: cursor })).next_items_page
        : (await mondayFetch<{ boards: { items_page: { cursor: string | null; items: RawItem[] } }[] }>(`query ($b: ID!) { boards(ids: [$b]) { items_page(limit: 200) { ${fields} } } }`, { b: PTO_BOARD_ID })).boards[0].items_page;
      for (const it of page.items) {
        if (/test/i.test(it.name)) continue;
        const v = (id: string) => (it.column_values.find((c) => c.id === id)?.text ?? "").trim();
        const range = v(COL.dates).match(/(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})/);
        items.push({
          id: String(it.id),
          name: it.name.trim(),
          requestor_name: v(COL.requestor) || null,
          start_date: range?.[1] ?? null,
          end_date: range?.[2] ?? range?.[1] ?? null,
          kind: v(COL.type) || null,
          hours: v(COL.hours) === "" ? null : Number(v(COL.hours)) || 0,
          team: v(COL.team) || null,
          approver: v(COL.approver) || null,
          status: v(COL.status) || null,
          created_at: it.created_at ?? null,
          monday_url: `${PTO_BOARD_URL}/pulses/${it.id}`,
        });
      }
      cursor = page.cursor;
      if (!cursor) break;
    }
    return { ok: true, items };
  } catch (e) {
    return { ok: false, items: [], error: (e as Error).message };
  }
}

export const isApproved = (req: PtoRequest) => /^(approved|complete)$/i.test(req.status ?? "");
export const isRejected = (req: PtoRequest) => /reject|denied|declined/i.test(req.status ?? "");
/** Waiting for the manager: a new request, or one with no status yet. */
export const isPending = (req: PtoRequest) => !req.status || /new request/i.test(req.status);

/** Out today: an approved request whose dates cover today. */
export function isOutToday(req: PtoRequest, today: string): boolean {
  if (!req.start_date || !isApproved(req)) return false;
  return req.start_date <= today && today <= (req.end_date ?? req.start_date);
}

export function fmtPtoDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00Z`);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

// ---------------------------------------------------------------- the form

export const HALF_DAY = /half/i;
const FALLBACK_TYPES = ["Time off - Vacation", "Half Day"];

/** The choices under "Status while away" on the board, so the form offers exactly what Monday accepts. */
export async function fetchPtoTypes(): Promise<string[]> {
  try {
    const data = await mondayFetch<{ boards: { columns: { id: string; settings_str: string | null }[] }[] }>(`query ($b: ID!) { boards(ids: [$b]) { columns(ids: ["${COL.type}"]) { id settings_str } } }`, { b: PTO_BOARD_ID });
    const raw = data.boards?.[0]?.columns?.[0]?.settings_str;
    const labels = raw ? (JSON.parse(raw) as { labels?: Record<string, string> }).labels : null;
    const names = labels ? Object.values(labels).filter((n) => typeof n === "string" && n.trim()) : [];
    // Full days first, half day second.
    return names.length ? names.sort((a, b) => Number(HALF_DAY.test(a)) - Number(HALF_DAY.test(b))) : FALLBACK_TYPES;
  } catch {
    return FALLBACK_TYPES;
  }
}

// Which Team a request is filed under, and so who approves it. The board
// assigns the approver from the Team; this picks the Team from the person's
// manager in Surroundings. Anyone who reports to Billy, or to nobody, goes to
// the Administrative Team, which Justin approves.
const TEAMS: { manager: string; team: string }[] = [
  { manager: "austin tompkins", team: "Content Team" },
  { manager: "sean odonnell", team: "Social Team" },
  { manager: "arial pavlock", team: "Account Management Team" },
];
const ADMIN_TEAM = { team: "Administrative Team", approver: "Justin Tarr" };
// Nobody approves their own time off. When the board would send a request to its own requester
// (Justin's go to the Administrative Team, which Justin approves), it goes to Billy instead.
const OVERRIDE_APPROVER = "Billy Pavlock";
const plain = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();

export function teamFor(managerName: string | null | undefined, requesterName?: string | null): { team: string; approver: string; overridden: boolean } {
  const hit = TEAMS.find((t) => t.manager === plain(managerName));
  const base = hit ? { team: hit.team, approver: (managerName ?? "").trim() } : ADMIN_TEAM;
  if (requesterName && plain(requesterName) === plain(base.approver)) return { team: base.team, approver: OVERRIDE_APPROVER, overridden: true };
  return { ...base, overridden: false };
}

/** Working days from start to end, both included: weekdays that are not company holidays. */
export function weekdaysBetween(start: string, end: string): number {
  return workingDays(start, end).days;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function submitPtoRequest(input: {
  requestorMondayId: string | null;
  requestorName: string; // the person's full name: it becomes the item name
  type: string;
  startDate: string;
  endDate: string;
  hours: number;
  team: string;
  notes: string;
  approverMondayId?: string | null; // only when the board's own pick has to be replaced (see teamFor)
}): Promise<{ id: string; monday_url: string }> {
  const columnValues: Record<string, unknown> = {
    [COL.status]: { label: "New request" },
    [COL.type]: { label: input.type },
    [COL.hours]: String(input.hours),
    [COL.dates]: { from: input.startDate, to: input.endDate },
  };
  if (input.team) columnValues[COL.team] = { label: input.team };
  const person = (id: string) => ({ personsAndTeams: [{ id: Number(id), kind: "person" }] });
  if (input.requestorMondayId) columnValues[COL.requestor] = person(input.requestorMondayId);

  const data = await mondayFetch<{ create_item: { id: string } | null }>(
    `mutation ($b: ID!, $name: String!, $values: JSON!) { create_item(board_id: $b, item_name: $name, column_values: $values, create_labels_if_missing: false) { id } }`,
    { b: PTO_BOARD_ID, name: input.requestorName, values: JSON.stringify(columnValues) },
    { fresh: true }
  );
  const id = data.create_item?.id;
  if (!id) throw new Error("Monday did not create the request.");

  // The note goes on as the request's first update, where the approver reads it. A failure here never loses the request.
  const note = input.notes.trim();
  if (note) {
    try {
      await mondayFetch(`mutation ($i: ID!, $body: String!) { create_update(item_id: $i, body: $body) { id } }`, { i: id, body: note.slice(0, 2000) }, { fresh: true });
    } catch {
      /* the request is in; the note is not */
    }
  }

  // The board's own automations run right after the item is made: one puts the creator (the account Surroundings
  // writes with) in Requestor, another picks the approver from the Team. Put back what they overwrite, and check
  // a few times, since they can take a few seconds. A failure here leaves the request in place.
  const want: Record<string, string> = {};
  if (input.requestorMondayId) want[COL.requestor] = input.requestorMondayId;
  if (input.approverMondayId) want[COL.approver] = input.approverMondayId;
  if (Object.keys(want).length) {
    try {
      // The board's creation automations take up to about 4 seconds, so a value that looks right at first can still
      // be overwritten. Check at 5 and 8 seconds every time, and once more at 11 if the 8-second check had to fix it.
      for (const [n, wait] of [5000, 3000, 3000].entries()) {
        await sleep(wait);
        const check = await mondayFetch<{ items: { column_values: { id: string; value: string | null }[] }[] }>(
          `query ($i: [ID!], $c: [String!]) { items(ids: $i) { column_values(ids: $c) { id value } } }`,
          { i: [id], c: Object.keys(want) },
          { fresh: true }
        );
        const wrong = Object.entries(want).filter(([col, uid]) => {
          const v = check.items?.[0]?.column_values?.find((c) => c.id === col)?.value;
          const ids = ((v ? JSON.parse(v) : {}) as { personsAndTeams?: { id: number }[] }).personsAndTeams ?? [];
          return !(ids.length === 1 && String(ids[0].id) === uid);
        });
        if (!wrong.length && n >= 1) break;
        if (!wrong.length) continue;
        const fix = Object.fromEntries(wrong.map(([col, uid]) => [col, person(uid)]));
        await mondayFetch(
          `mutation ($b: ID!, $i: ID!, $values: JSON!) { change_multiple_column_values(board_id: $b, item_id: $i, column_values: $values) { id } }`,
          { b: PTO_BOARD_ID, i: id, values: JSON.stringify(fix) },
          { fresh: true }
        );
      }
    } catch {
      /* the request is in; Requestor or approver may need fixing by hand */
    }
  }

  return { id, monday_url: `${PTO_BOARD_URL}/pulses/${id}` };
}

// ---------------------------------------------------------------- approving

export type PtoApproval = { id: string; name: string; from: string | null; to: string | null; hours: number | null; kind: string | null; filed: string | null; url: string };

/** Requests waiting on this person: status New request, and they are the Manager (Approver). For the To-dos card. */
export async function fetchMyPtoApprovals(approverMondayId: string): Promise<{ ok: boolean; items: PtoApproval[] }> {
  try {
    type Item = { id: string; name: string; created_at: string | null; column_values: { id: string; text: string | null }[] };
    const data = await mondayFetch<{ boards: { items_page: { items: Item[] } }[] }>(
      `query ($b: ID!, $p: ItemsQuery) { boards(ids: [$b]) { items_page(limit: 100, query_params: $p) { items { id name created_at column_values(ids: ["${COL.status}", "${COL.dates}", "${COL.hours}", "${COL.type}"]) { id text } } } } }`,
      { b: PTO_BOARD_ID, p: { rules: [{ column_id: COL.approver, compare_value: [`person-${approverMondayId}`], operator: "any_of" }] } },
      { fresh: true }
    );
    const items = (data.boards?.[0]?.items_page?.items ?? [])
      .map((it) => {
        const v = (id: string) => (it.column_values.find((c) => c.id === id)?.text ?? "").trim();
        const range = v(COL.dates).match(/(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})/);
        return {
          status: v(COL.status),
          id: String(it.id),
          name: it.name.trim(),
          from: range?.[1] ?? null,
          to: range?.[2] ?? range?.[1] ?? null,
          hours: v(COL.hours) === "" ? null : Number(v(COL.hours)) || 0,
          kind: v(COL.type) || null,
          filed: (it.created_at ?? "").slice(0, 10) || null,
          url: `${PTO_BOARD_URL}/pulses/${it.id}`,
        };
      })
      .filter((r) => /new request/i.test(r.status) && !/test/i.test(r.name))
      .map(({ status: _status, ...r }) => r)
      .sort((a, b) => (a.from ?? "9999").localeCompare(b.from ?? "9999"));
    return { ok: true, items };
  } catch {
    return { ok: false, items: [] };
  }
}

/**
 * Approve or decline a time-off request from Surroundings. Only the request's
 * Manager (Approver), or an admin, and only while it is still a new request.
 * Sets the status on Monday, which runs the board's own automations (the
 * requester is told; on approval the hours go to their PTO board), and logs who
 * decided as an update on the request, since the change itself is made with
 * the account Surroundings writes with.
 */
export async function decidePtoRequest(input: { itemId: string; decision: "approve" | "decline"; deciderMondayId: string; deciderName: string; isAdmin: boolean; note?: string }): Promise<{ status: string }> {
  type Item = { board: { id: string }; column_values: { id: string; text: string | null; value: string | null }[] };
  const data = await mondayFetch<{ items: Item[] }>(`query ($i: [ID!]) { items(ids: $i) { board { id } column_values(ids: ["${COL.status}", "${COL.approver}"]) { id text value } } }`, { i: [input.itemId] }, { fresh: true });
  const item = data.items?.[0];
  if (!item || String(item.board.id) !== PTO_BOARD_ID) throw new Error("That request could not be found.");
  const status = item.column_values.find((c) => c.id === COL.status)?.text ?? "";
  if (!/new request/i.test(status)) throw new Error(`That request is already ${status || "decided"}.`);
  const approvers = ((JSON.parse(item.column_values.find((c) => c.id === COL.approver)?.value ?? "{}") as { personsAndTeams?: { id: number }[] }).personsAndTeams ?? []).map((p) => String(p.id));
  if (!input.isAdmin && !approvers.includes(input.deciderMondayId)) throw new Error("Only the approver on this request can decide it.");
  const label = input.decision === "approve" ? "Approved" : "Rejected";
  await mondayFetch(
    `mutation ($b: ID!, $i: ID!, $v: JSON!) { change_column_value(board_id: $b, item_id: $i, column_id: "${COL.status}", value: $v) { id } }`,
    { b: PTO_BOARD_ID, i: input.itemId, v: JSON.stringify({ label }) },
    { fresh: true }
  );
  const note = (input.note ?? "").trim().slice(0, 500);
  try {
    await mondayFetch(`mutation ($i: ID!, $body: String!) { create_update(item_id: $i, body: $body) { id } }`, { i: input.itemId, body: `${label} by ${input.deciderName} in Surroundings.${note ? ` Note: ${note}` : ""}` }, { fresh: true });
  } catch {
    /* the decision stands; the note did not post */
  }
  return { status: label };
}
