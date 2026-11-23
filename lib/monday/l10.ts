// A person's to-dos from the L10 meeting boards on Monday, for the To-dos card
// on My Surroundings, and ticking one off from there.
//
// Ticking a to-do in Surroundings does NOT close it: it sets the board's review
// status ("Review" on Leadership, "Ready For Review" on AM, "In Review" on the
// boards that had none). The team works through to-dos during the week and
// closes them in the L10 meeting from the Monday board (Billy, 2026-11-23).
//
// Only the boards the team is running today. Hive L10 and L10 Pipeline Review
// exist too but have not been touched since early 2026; add them here if they
// come back. Each board's layout (which group is the to-dos, which column is
// the owner, what "done" is called) is read from the board itself.

const API = "https://api.monday.com/v2";

export const L10_BOARDS = [
  { id: "4884938453", label: "Leadership L10" },
  { id: "18389982473", label: "AM L10" },
  { id: "18403335134", label: "Marketing L10" },
  { id: "18412669635", label: "NN L10" },
] as const;

const CLOSED = ["solved", "to do completed", "done"];

export type L10Todo = {
  id: string;
  boardId: string;
  board: string; // "AM L10"
  name: string;
  due: string | null; // YYYY-MM-DD
  status: string | null;
  inReview: boolean; // ticked here, waiting for the L10 meeting
  url: string;
};

export type L10Todos = { ok: boolean; todos: L10Todo[]; error?: string };

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

type Layout = { groupId: string; peopleCol: string; dateCol: string | null; reviewLabel: string; reviewIsNew: boolean };
const REVIEW = /review/i;
const layouts = new Map<string, { at: number; layout: Layout | null }>();

async function layoutOf(boardId: string): Promise<Layout | null> {
  const hit = layouts.get(boardId);
  if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit.layout;
  const data = await gql<{ boards: { groups: { id: string; title: string }[]; columns: { id: string; type: string; settings_str: string }[] }[] }>(
    `query($b:[ID!]){ boards(ids:$b){ groups{ id title } columns{ id type settings_str } } }`,
    { b: [boardId] }
  );
  const b = data.boards?.[0];
  const group = b?.groups.find((g) => /to.?do/i.test(g.title));
  const people = b?.columns.find((c) => c.type === "people");
  const status = b?.columns.find((c) => c.id === "status");
  let layout: Layout | null = null;
  if (b && group && people && status) {
    const labels = Object.values((JSON.parse(status.settings_str || "{}") as { labels?: Record<string, string> }).labels ?? {});
    const existing = labels.find((l) => REVIEW.test(l)) ?? null;
    layout = { groupId: group.id, peopleCol: people.id, dateCol: b.columns.find((c) => c.type === "date")?.id ?? null, reviewLabel: existing ?? "In Review", reviewIsNew: !existing };
  }
  layouts.set(boardId, { at: Date.now(), layout });
  return layout;
}

/** Open to-dos with this person on them, across the L10 boards in use. */
export async function fetchMyL10Todos(mondayPersonId: string): Promise<L10Todos> {
  try {
    const perBoard = await Promise.all(
      L10_BOARDS.map(async (board) => {
        const layout = await layoutOf(board.id);
        if (!layout) return [] as L10Todo[];
        const cols = ["status", layout.dateCol].filter(Boolean) as string[];
        const data = await gql<{ boards: { groups: { items_page: { items: { id: string; name: string; column_values: { id: string; text: string | null }[] }[] } }[] }[] }>(
          `query($b:[ID!],$g:[String],$p:ItemsQuery,$c:[String!]){ boards(ids:$b){ groups(ids:$g){ items_page(limit:200, query_params:$p){ items{ id name column_values(ids:$c){ id text } } } } } }`,
          { b: [board.id], g: [layout.groupId], c: cols, p: { rules: [{ column_id: layout.peopleCol, compare_value: [`person-${mondayPersonId}`], operator: "any_of" }] } }
        );
        const items = data.boards?.[0]?.groups?.[0]?.items_page?.items ?? [];
        return items
          .map((it) => {
            const val = (id: string | null) => (id ? (it.column_values.find((c) => c.id === id)?.text ?? "").trim() : "");
            const due = val(layout.dateCol).slice(0, 10);
            const status = val("status") || null;
            return {
              id: String(it.id),
              boardId: board.id,
              board: board.label,
              name: it.name.trim(),
              due: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
              status,
              inReview: !!status && REVIEW.test(status),
              url: `https://nauticalnetwork.monday.com/boards/${board.id}/pulses/${it.id}`,
            } satisfies L10Todo;
          })
          .filter((t) => !CLOSED.includes((t.status ?? "").toLowerCase()));
      })
    );
    // Dated first, soonest (and most overdue) at the top; undated after.
    const todos = perBoard.flat().sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.name.localeCompare(b.name));
    return { ok: true, todos };
  } catch (e) {
    return { ok: false, todos: [], error: (e as Error).message.slice(0, 160) };
  }
}

/**
 * Tick an L10 to-do (it goes to the board's review status) or put it back. Only
 * when the item really is in that board's to-do group and this person is on it.
 * `restore` is the status it had before ticking; un-ticking an item that was
 * already in review when the page loaded clears the status.
 */
export async function setL10TodoDone(input: { mondayPersonId: string; boardId: string; itemId: string; done: boolean; restore?: string | null }): Promise<void> {
  if (!L10_BOARDS.some((b) => b.id === input.boardId)) throw new Error("Not an L10 board.");
  const layout = await layoutOf(input.boardId);
  if (!layout) throw new Error("That board could not be read.");
  const data = await gql<{ items: { board: { id: string }; group: { id: string }; column_values: { id: string; persons_and_teams?: { id: string }[] }[] }[] }>(
    `query($i:[ID!],$c:[String!]){ items(ids:$i){ board{ id } group{ id } column_values(ids:$c){ id ... on PeopleValue { persons_and_teams { id } } } } }`,
    { i: [input.itemId], c: [layout.peopleCol] }
  );
  const item = data.items?.[0];
  const onIt = (item?.column_values?.[0]?.persons_and_teams ?? []).some((p) => String(p.id) === input.mondayPersonId);
  if (!item || String(item.board.id) !== input.boardId || item.group.id !== layout.groupId || !onIt) throw new Error("That to-do is not yours to change.");

  const before = (input.restore ?? "").trim();
  const value = input.done ? layout.reviewLabel : REVIEW.test(before) ? "" : before;
  if (!input.done && CLOSED.includes(value.toLowerCase())) throw new Error("Bad status.");
  await gql(`mutation($b:ID!,$i:ID!,$v:String,$n:Boolean){ change_simple_column_value(board_id:$b, item_id:$i, column_id:"status", value:$v, create_labels_if_missing:$n){ id } }`, {
    b: input.boardId,
    i: input.itemId,
    v: value,
    n: input.done && layout.reviewIsNew,
  });
  // The board now has the label; read the layout fresh next time.
  if (input.done && layout.reviewIsNew) layouts.delete(input.boardId);
}
