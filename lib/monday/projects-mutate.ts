// Monday All Projects board mutations the Hub makes on behalf of an AM
// clicking around in the Projects tile. Kept separate from the
// read-only lib/monday/projects.ts so a renderer accidentally importing
// a mutation module stays obvious.

const MONDAY_API_URL = "https://api.monday.com/v2";

async function mondayFetch(query: string, variables?: Record<string, unknown>) {
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
  });
  if (!res.ok) {
    throw new Error(`Monday HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const body = (await res.json()) as {
    data?: unknown;
    errors?: Array<{ message: string }>;
  };
  if (body.errors?.length) {
    throw new Error(`Monday: ${body.errors.map((e) => e.message).join("; ")}`);
  }
  return body.data;
}

/** Change the Shoot Date (column id "date4") on an All Projects item.
 *  Accepts a YYYY-MM-DD date and an optional HH:mm:ss time; passing a
 *  blank date clears the column. */
export async function changeProjectShootDate(
  itemId: string,
  dateYmd: string | null,
  timeHms?: string
): Promise<void> {
  const boardId = process.env.MONDAY_BOARD_ID_ALL_PROJECTS;
  if (!boardId) throw new Error("MONDAY_BOARD_ID_ALL_PROJECTS is not set");

  const value =
    dateYmd === null || dateYmd === ""
      ? JSON.stringify({})                                    // clears the column
      : JSON.stringify({ date: dateYmd, ...(timeHms ? { time: timeHms } : {}) });

  await mondayFetch(
    `mutation ChangeDate($boardId: ID!, $itemId: ID!, $value: JSON!) {
      change_column_value(
        board_id: $boardId
        item_id: $itemId
        column_id: "date4"
        value: $value
      ) { id }
    }`,
    { boardId: String(boardId), itemId: String(itemId), value }
  );
}

/** Change the Project Status (column id "status") on an All Projects
 *  item to the given label. Monday resolves the label → index internally,
 *  so the caller just needs the human-readable string. */
export async function changeProjectStatus(itemId: string, label: string): Promise<void> {
  const boardId = process.env.MONDAY_BOARD_ID_ALL_PROJECTS;
  if (!boardId) throw new Error("MONDAY_BOARD_ID_ALL_PROJECTS is not set");
  const value = JSON.stringify({ label });
  await mondayFetch(
    `mutation ChangeStatus($boardId: ID!, $itemId: ID!, $value: JSON!) {
      change_column_value(
        board_id: $boardId
        item_id: $itemId
        column_id: "status"
        value: $value
      ) { id }
    }`,
    { boardId: String(boardId), itemId: String(itemId), value }
  );
}

/** Fetch the configured Project Status labels for the All Projects
 *  board. Cached in-process for 5 min — the labels almost never change
 *  and every profile load otherwise fires the same query. */
let statusCache: { at: number; labels: string[] } | null = null;
const STATUS_CACHE_MS = 5 * 60 * 1000;

export async function fetchProjectStatusLabels(): Promise<string[]> {
  if (statusCache && Date.now() - statusCache.at < STATUS_CACHE_MS) {
    return statusCache.labels;
  }
  const boardId = process.env.MONDAY_BOARD_ID_ALL_PROJECTS;
  if (!boardId) return [];
  try {
    const data = (await mondayFetch(
      `query StatusLabels($boardId: ID!) {
        boards(ids: [$boardId]) {
          columns(ids: ["status"]) { settings_str }
        }
      }`,
      { boardId: String(boardId) }
    )) as { boards?: Array<{ columns: Array<{ settings_str: string }> }> };
    const raw = data.boards?.[0]?.columns?.[0]?.settings_str;
    if (!raw) return [];
    // Shape: {"labels":{"0":"Working on it","1":"Done",...},"labels_positions_v2":{...},"labels_colors":{...}}
    const parsed = JSON.parse(raw) as { labels?: Record<string, string> };
    const labels = Object.values(parsed.labels ?? {}).filter((s): s is string => !!s);
    statusCache = { at: Date.now(), labels };
    return labels;
  } catch {
    return [];
  }
}
