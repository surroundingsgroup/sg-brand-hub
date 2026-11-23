// The open tasks assigned to one person on Monday (sub-items of the All
// Projects board), for the To-dos card on My Surroundings. Only tasks with a
// due date that is recent or coming up: undated and long-stale ones stay on
// Monday, where they are counted but not listed.

const API = "https://api.monday.com/v2";
const SUBITEMS_BOARD = 7006063086;
const PROJECTS_BOARD = 7006062832;
const COL_OWNER = "person";
const COL_STATUS = "status2"; // Task Status
const COL_DUE = "date__1";
const COL_TYPE = "dup__of_auto_schedule"; // Task Type
const CLOSED = ["Completed", "Cache"];

export type MyTask = {
  id: string;
  name: string;
  project: string | null;
  type: string | null;
  status: string | null;
  due: string; // YYYY-MM-DD
  url: string; // the project on Monday
};

export type MyTasks = { ok: boolean; tasks: MyTask[]; other: number; error?: string };

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) throw new Error("monday_not_configured");
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token, "API-Version": "2025-04" },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  if (!json.data) throw new Error(`Monday returned HTTP ${res.status}`);
  return json.data;
}

// Which Task Status labels mean "finished", as the indexes Monday filters by.
let closedIdx: { at: number; idx: number[] } | null = null;
async function closedIndexes(): Promise<number[]> {
  if (closedIdx && Date.now() - closedIdx.at < 30 * 60 * 1000) return closedIdx.idx;
  const data = await gql<{ boards: { columns: { settings_str: string }[] }[] }>(
    `query { boards(ids:[${SUBITEMS_BOARD}]){ columns(ids:["${COL_STATUS}"]){ settings_str } } }`
  );
  const labels = (JSON.parse(data.boards?.[0]?.columns?.[0]?.settings_str ?? "{}") as { labels?: Record<string, string> }).labels ?? {};
  const idx = Object.entries(labels).filter(([, v]) => CLOSED.includes(v)).map(([k]) => Number(k));
  closedIdx = { at: Date.now(), idx };
  return idx;
}

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** `today` is YYYY-MM-DD in Tampa time. Lists tasks due from 30 days back to 14 days ahead. */
export async function fetchMyTasks(mondayPersonId: string, today: string): Promise<MyTasks> {
  try {
    const closed = await closedIndexes();
    const rules: Record<string, unknown>[] = [{ column_id: COL_OWNER, compare_value: [`person-${mondayPersonId}`], operator: "any_of" }];
    if (closed.length) rules.push({ column_id: COL_STATUS, compare_value: closed, operator: "not_any_of" });
    const data = await gql<{
      boards: { items_page: { items: { id: string; name: string; parent_item: { id: string; name: string } | null; column_values: { id: string; text: string | null }[] }[] } }[];
    }>(
      `query($p:ItemsQuery){ boards(ids:[${SUBITEMS_BOARD}]){ items_page(limit:200, query_params:$p){ items{ id name parent_item{ id name } column_values(ids:["${COL_STATUS}","${COL_DUE}","${COL_TYPE}"]){ id text } } } } }`,
      { p: { rules } }
    );
    const from = addDays(today, -30);
    const to = addDays(today, 14);
    const all = data.boards?.[0]?.items_page?.items ?? [];
    const tasks: MyTask[] = [];
    for (const it of all) {
      const val = (id: string) => (it.column_values.find((c) => c.id === id)?.text ?? "").trim();
      const due = val(COL_DUE).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || due < from || due > to) continue;
      tasks.push({
        id: String(it.id),
        name: it.name,
        project: it.parent_item?.name ?? null,
        type: val(COL_TYPE) || null,
        status: val(COL_STATUS) || null,
        due,
        url: it.parent_item
          ? `https://nauticalnetwork.monday.com/boards/${PROJECTS_BOARD}/pulses/${it.parent_item.id}`
          : `https://nauticalnetwork.monday.com/boards/${SUBITEMS_BOARD}/pulses/${it.id}`,
      });
    }
    tasks.sort((a, b) => a.due.localeCompare(b.due) || a.name.localeCompare(b.name));
    return { ok: true, tasks, other: all.length - tasks.length };
  } catch (e) {
    return { ok: false, tasks: [], other: 0, error: (e as Error).message.slice(0, 160) };
  }
}
