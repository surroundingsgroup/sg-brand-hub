// Monday "per-client" board reader.
//
// Each client gets their own board in the Surroundings Group workspace
// that holds Meeting Cadence, Invoicing, Allocation Setup, Financial &
// Scope Watch, etc. The Hub reads these to power the Meeting /
// Invoicing / Allocation-actuals / Scope-watch tiles.
//
// Board-name → board-id lookup is cached in-process for 10 minutes;
// the group-contents fetch for a single board revalidates every 60s
// through Next's fetch cache so AMs see fresh state without each tile
// firing its own query.

const MONDAY_API_URL = "https://api.monday.com/v2";

async function mondayFetch<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) throw new Error("MONDAY_API_TOKEN is not set");
  const res = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
      "API-Version": "2024-10",
    },
    body: JSON.stringify({ query, variables }),
    next: { revalidate: 60 },
  });
  if (!res.ok) throw new Error(`Monday HTTP ${res.status}`);
  const body = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join("; "));
  if (!body.data) throw new Error("Monday returned no data");
  return body.data;
}

// ── Board ID lookup by brand name ────────────────────────────────────────

type BoardIndex = { at: number; map: Map<string, string> };
let boardIndex: BoardIndex | null = null;
const BOARD_INDEX_TTL = 10 * 60 * 1000;

async function getBoardIndex(): Promise<Map<string, string>> {
  if (boardIndex && Date.now() - boardIndex.at < BOARD_INDEX_TTL) {
    return boardIndex.map;
  }
  const data = await mondayFetch<{ boards: Array<{ id: string; name: string }> }>(
    `query { boards(limit: 500, order_by: used_at) { id name } }`
  );
  const map = new Map<string, string>();
  for (const b of data.boards ?? []) {
    const norm = b.name.trim().toLowerCase();
    map.set(norm, String(b.id));
  }
  boardIndex = { at: Date.now(), map };
  return map;
}

/** Find a per-client board by brand name. Tries a few common variants
 *  the team uses: "{Name}", "{Name} (Client Board)", "{Name}- Updated
 *  Client Board", "{Name} - Client Board". Returns null if none match. */
export async function findClientBoardId(brandName: string): Promise<string | null> {
  const index = await getBoardIndex();
  const n = brandName.trim().toLowerCase();
  const candidates = [
    n,
    `${n} (client board)`,
    `${n} - client board`,
    `${n}- updated client board`,
    `${n} client board`,
  ];
  for (const c of candidates) {
    const hit = index.get(c);
    if (hit) return hit;
  }
  // Soft match: any board whose name starts with the brand name.
  for (const [name, id] of index) {
    if (name.startsWith(n + " ") || name.startsWith(n + "-")) return id;
  }
  return null;
}

// ── Group-contents fetch ─────────────────────────────────────────────────

export type ClientBoardItem = {
  id: string;
  name: string;
  groupTitle: string;
  mondayUrl: string;
  columns: Record<string, { text: string | null; value: string | null; type: string }>;
};

export type ClientBoardData = {
  found: boolean;
  boardId: string | null;
  boardName: string | null;
  itemsByGroup: Map<string, ClientBoardItem[]>;
  columnsById: Record<string, { title: string; type: string }>;
  ok: boolean;
  error?: string;
};

const EMPTY: ClientBoardData = {
  found: false,
  boardId: null,
  boardName: null,
  itemsByGroup: new Map(),
  columnsById: {},
  ok: true,
};

// A client's board is found by its name. When the board is named differently
// from the client ("Bertram" for Bertram Yachts, "Vollmer Development" for
// Vollmer Real Estate), the board id saved on the client record is used, but
// only when that board is plainly this client's: the two names start with
// the same word. (A saved id can be wrong; some point at another client.)
async function linkedBoardIfSameClient(brandName: string, linkedBoardId: string | number | null | undefined): Promise<string | null> {
  const id = linkedBoardId ? String(linkedBoardId).trim() : "";
  if (!/^\d+$/.test(id)) return null;
  try {
    const data = await mondayFetch<{ boards: Array<{ id: string; name: string }> }>(`query ($b: [ID!]) { boards(ids: $b) { id name } }`, { b: [id] });
    const board = data.boards?.[0];
    if (!board) return null;
    const first = (t: string) => t.trim().toLowerCase().split(/[^a-z0-9]+/)[0];
    return first(board.name) && first(board.name) === first(brandName) ? String(board.id) : null;
  } catch {
    return null;
  }
}

export async function fetchClientBoardData(brandName: string, linkedBoardId?: string | number | null): Promise<ClientBoardData> {
  try {
    const boardId = (await findClientBoardId(brandName)) ?? (await linkedBoardIfSameClient(brandName, linkedBoardId));
    if (!boardId) return { ...EMPTY, found: false };

    const data = await mondayFetch<{
      boards: Array<{
        id: string;
        name: string;
        columns: Array<{ id: string; title: string; type: string }>;
        groups: Array<{ id: string; title: string }>;
        items_page: {
          items: Array<{
            id: string;
            name: string;
            group: { id: string; title: string };
            column_values: Array<{
              id: string;
              text: string | null;
              value: string | null;
              type: string;
            }>;
          }>;
        };
      }>;
    }>(
      `query ($boardId: ID!) {
        boards(ids: [$boardId]) {
          id name
          columns { id title type }
          groups { id title }
          items_page(limit: 200) {
            items {
              id
              name
              group { id title }
              column_values { id text value type }
            }
          }
        }
      }`,
      { boardId }
    );

    const board = data.boards?.[0];
    if (!board) return { ...EMPTY };

    const columnsById: Record<string, { title: string; type: string }> = {};
    for (const c of board.columns) columnsById[c.id] = { title: c.title, type: c.type };

    const itemsByGroup = new Map<string, ClientBoardItem[]>();
    for (const g of board.groups) itemsByGroup.set(g.title, []);
    for (const it of board.items_page.items) {
      const columns: ClientBoardItem["columns"] = {};
      for (const cv of it.column_values) {
        columns[cv.id] = { text: cv.text, value: cv.value, type: cv.type };
      }
      const row: ClientBoardItem = {
        id: it.id,
        name: it.name,
        groupTitle: it.group.title,
        mondayUrl: `https://nauticalnetwork.monday.com/boards/${boardId}/pulses/${it.id}`,
        columns,
      };
      if (!itemsByGroup.has(it.group.title)) itemsByGroup.set(it.group.title, []);
      itemsByGroup.get(it.group.title)!.push(row);
    }

    return {
      found: true,
      boardId: String(boardId),
      boardName: board.name,
      itemsByGroup,
      columnsById,
      ok: true,
    };
  } catch (e) {
    return { ...EMPTY, ok: false, error: (e as Error).message };
  }
}

/** Fetch a single group's subitems — used by Meeting Cadence where
 *  the meeting history lives as subitems under a parent row. */
export async function fetchItemSubitems(parentItemId: string): Promise<Array<{
  id: string;
  name: string;
  columns: Record<string, { text: string | null; value: string | null; type: string }>;
}>> {
  try {
    const data = await mondayFetch<{
      items: Array<{
        subitems: Array<{
          id: string;
          name: string;
          column_values: Array<{ id: string; text: string | null; value: string | null; type: string }>;
        }>;
      }>;
    }>(
      `query ($itemId: [ID!]!) {
        items(ids: $itemId) {
          subitems {
            id name
            column_values { id text value type }
          }
        }
      }`,
      { itemId: [parentItemId] }
    );
    const rows = data.items?.[0]?.subitems ?? [];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      columns: Object.fromEntries(
        r.column_values.map((cv) => [cv.id, { text: cv.text, value: cv.value, type: cv.type }])
      ),
    }));
  } catch {
    return [];
  }
}

// ── Group title helpers ─────────────────────────────────────────────────
// Group titles in the client-board template are long and inconsistent
// across clients (some have the ONBOARDING bang-text, some don't).
// These helpers find the first group whose title matches a known key.

export function findGroup(
  data: ClientBoardData,
  match: RegExp
): ClientBoardItem[] {
  for (const [title, items] of data.itemsByGroup) {
    if (match.test(title)) return items;
  }
  return [];
}

// ── Allocation Setup ────────────────────────────────────────────────────

export type AllocationLine = {
  task: string;       // "Professional Content Session", "Client Communication / Meetings"
  role: string;       // "AM", "Creative", "Strategy", ...
  person: string;     // "Billy Pavlock"
  hours: number;      // monthly default
};

export type AllocationSetup = {
  found: boolean;
  lines: AllocationLine[];
  totalHours: number;
  byRole: Record<string, number>;
};

const HOURS_COL = "numeric_mkz0j4te";

/** Read the Allocation Setup subitems for a client board — those are
 *  the monthly per-task hour defaults the Operations team manages. */
export async function fetchAllocationSetup(
  data: ClientBoardData
): Promise<AllocationSetup> {
  const parents = findGroup(data, /allocation\s*setup/i);
  if (parents.length === 0) {
    return { found: false, lines: [], totalHours: 0, byRole: {} };
  }

  const lines: AllocationLine[] = [];
  for (const parent of parents) {
    const subs = await fetchItemSubitems(parent.id);
    for (const s of subs) {
      const hoursText = s.columns[HOURS_COL]?.text ?? "";
      const hours = Number(hoursText);
      if (!hoursText || isNaN(hours)) continue;
      lines.push({
        task: s.name,
        role: s.columns.status?.text ?? "",
        person: s.columns.person?.text ?? "",
        hours,
      });
    }
  }

  const byRole: Record<string, number> = {};
  let total = 0;
  for (const l of lines) {
    byRole[l.role] = (byRole[l.role] ?? 0) + l.hours;
    total += l.hours;
  }
  return { found: true, lines, totalHours: total, byRole };
}
