// The hours allocated to each client for the months the team is working on,
// read from the Monday "Allocation" board (group "Current Month": items named
// "<Month Year> - <Client>", one sub-item per line with its hours). This is the
// allocation the team actually triggers each month, so the rate math uses it
// whenever Surroundings has no allocation of its own saved for that month.

const API = "https://api.monday.com/v2";
const ALLOCATION_BOARD = 18183906375;
const COL_HOURS = "numeric_mky0fkmy";
const COL_CLIENT_BOARD = "text_mm4gxax7";

export type BoardAllocation = {
  year: number;
  month: number; // 1-12
  client: string; // as named on the board
  clientBoardId: string | null;
  hours: number;
};

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

type Item = { name: string; column_values: { text: string | null }[]; subitems: { column_values: { text: string | null }[] }[] };
type Page = { boards: { groups: { items_page: { cursor: string | null; items: Item[] } }[] }[] };

async function call<T>(token: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token, "API-Version": "2025-04" },
    body: JSON.stringify({ query, variables }),
    next: { revalidate: 120 },
  });
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length || !json.data) throw new Error(json.errors?.map((e) => e.message).join("; ") ?? `HTTP ${res.status}`);
  return json.data;
}

export async function fetchBoardAllocations(): Promise<{ ok: boolean; rows: BoardAllocation[] }> {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) return { ok: false, rows: [] };
  try {
    const groups = (await call<{ boards: { groups: { id: string; title: string }[] }[] }>(token, `query { boards(ids:[${ALLOCATION_BOARD}]){ groups{ id title } } }`)).boards[0].groups;
    const current = groups.find((g) => /current/i.test(g.title));
    if (!current) return { ok: false, rows: [] };
    const rows: BoardAllocation[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard++) {
      const data: Page = await call<Page>(
        token,
        `query($g:[String],$c:String){ boards(ids:[${ALLOCATION_BOARD}]){ groups(ids:$g){ items_page(limit:50, cursor:$c){ cursor items{ name column_values(ids:["${COL_CLIENT_BOARD}"]){ text } subitems{ column_values(ids:["${COL_HOURS}"]){ text } } } } } } }`,
        { g: [current.id], c: cursor }
      );
      const page = data.boards[0].groups[0].items_page;
      for (const it of page.items) {
        const m = /^([A-Za-z]+) (\d{4}) - (.+)$/.exec(it.name.trim());
        const month = m ? MONTHS.indexOf(m[1].toLowerCase()) + 1 : 0;
        if (!m || !month) continue;
        rows.push({
          year: Number(m[2]),
          month,
          client: m[3].trim(),
          clientBoardId: it.column_values[0]?.text?.trim() || null,
          hours: it.subitems.reduce((n, s) => n + (Number(s.column_values[0]?.text) || 0), 0),
        });
      }
      cursor = page.cursor;
      if (!cursor) break;
    }
    return { ok: true, rows };
  } catch {
    return { ok: false, rows: [] };
  }
}

const squash = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");

/** The board's hours for one client and month: matched by the client board first, the name second. */
export function boardHoursFor(rows: BoardAllocation[], brand: { business_name: string; monday_board_id?: string | number | null }, year: number, month: number): number | null {
  const inMonth = rows.filter((r) => r.year === year && r.month === month);
  const boardId = brand.monday_board_id ? String(brand.monday_board_id) : null;
  const byBoard = boardId ? inMonth.filter((r) => r.clientBoardId === boardId) : [];
  const name = squash(brand.business_name);
  const byName = inMonth.filter((r) => {
    const c = squash(r.client);
    return c === name || (c.length >= 5 && (name.startsWith(c) || c.startsWith(name)));
  });
  const hit = byBoard.length ? byBoard : byName;
  // Two items for the same client and month: the later one on the board is the redo.
  return hit.length ? hit[hit.length - 1].hours : null;
}
