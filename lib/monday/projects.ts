// Fetch Monday "All Projects" board items for a single client. The Hub's
// client profile page uses this to render the Projects tile — upcoming
// shoots, work in flight, recently completed — with deep links out to
// the Monday item, the Dropbox folder, and the creative brief.
//
// Filtered by the board's Client dropdown column (label = brand
// business name). Monday's items_page_by_column_values endpoint is the
// fastest way to do a dropdown filter in a single hop.
//
// Fails soft: network error / Monday down / missing env all return an
// empty list so the rest of the profile page still renders.

const MONDAY_API_URL = "https://api.monday.com/v2";
const CACHE_TTL_SECONDS = 60; // Next's fetch revalidation, mirrors the Brief Tool tile.

export type HubProject = {
  id: string;
  name: string;
  group: string;
  status: string | null;
  projectType: string | null;
  shootDate: string | null;      // YYYY-MM-DD HH:MM when present
  shootDateIso: string | null;   // ISO sortable (shootDate normalized)
  am: string | null;
  briefUrl: string | null;
  dropboxUrl: string | null;
  mondayUrl: string;
  updatedAt: string;
  // The project's sub-items on Monday (its deliverables and tasks). Only
  // loaded when asked for (the client page), to keep the bulk reads light.
  subitems?: HubSubitem[];
};

export type HubSubitem = {
  id: string;
  name: string;
  taskType: string | null; // "Content Shoot", "Video Edit", ...
  status: string | null; // Task Status
  owner: string | null;
  due: string | null; // YYYY-MM-DD
  dueTime?: string | null; // HH:MM, Tampa time, when the due date has one
  // The "Deliverable Link" on the sub-item: the actual file (Canva, Dropbox,
  // Frame...). Null until somebody has put the link on Monday.
  deliverableUrl: string | null;
};

export type ProjectsForClient = {
  projects: HubProject[];
  ok: boolean;
  error?: string;
};

const INCLUDE_COLUMNS = ["status", "status__1", "date4", "people", "link_1", "link8"];

// A ranking of Monday "Project Status" labels so the tile can sort
// "in flight" above "waiting" above "finished" without guessing.
// Values we haven't seen fall into the middle of the pack.
const STATUS_RANK: Record<string, number> = {
  "Working on it": 0,
  "Project Assigned": 1,
  "Project Intake": 2,
  "Revision Request": 2,
  "On Hold": 3,
  "Waiting": 3,
  "Completed": 9,
  "Done": 9,
  "Archived": 10,
};

function parseLinkColumn(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { url?: string };
    return parsed.url?.trim() || null;
  } catch {
    return null;
  }
}

export async function fetchProjectsForClient(
  brandName: string,
  opts: { withSubitems?: boolean } = {}
): Promise<ProjectsForClient> {
  // Sub-item columns (board 7006063086): Task Type, Task Status, owner, due.
  const subitemFields = opts.withSubitems
    ? `subitems { id name column_values(ids: ["dup__of_auto_schedule", "status2", "person", "date__1", "link"]) { id text value } }`
    : "";
  const token = process.env.MONDAY_API_TOKEN;
  const boardId = process.env.MONDAY_BOARD_ID_ALL_PROJECTS;
  if (!token || !boardId) {
    return { projects: [], ok: false, error: "monday_not_configured" };
  }

  try {
    const res = await fetch(MONDAY_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: token,
        "API-Version": "2024-10",
      },
      body: JSON.stringify({
        query: `query ProjectsForClient($boardId: ID!, $value: [String]!, $cols: [String!]) {
          items_page_by_column_values(
            board_id: $boardId
            columns: [{ column_id: "dropdown", column_values: $value }]
            limit: 100
          ) {
            items {
              id
              name
              updated_at
              group { title }
              column_values(ids: $cols) {
                id
                text
                value
              }
              ${subitemFields}
            }
          }
        }`,
        variables: {
          boardId: String(boardId),
          value: [brandName],
          cols: INCLUDE_COLUMNS,
        },
      }),
      next: { revalidate: CACHE_TTL_SECONDS },
    });

    if (!res.ok) {
      return { projects: [], ok: false, error: `HTTP ${res.status}` };
    }
    const body = (await res.json()) as {
      data?: {
        items_page_by_column_values: {
          items: Array<{
            id: string;
            name: string;
            updated_at: string;
            group: { title: string };
            column_values: Array<{ id: string; text: string | null; value: string | null }>;
            subitems?: Array<{ id: string; name: string; column_values: Array<{ id: string; text: string | null; value?: string | null }> }>;
          }>;
        };
      };
      errors?: Array<{ message: string }>;
    };
    if (body.errors?.length) {
      return {
        projects: [],
        ok: false,
        error: body.errors.map((e) => e.message).join("; "),
      };
    }
    const items = body.data?.items_page_by_column_values.items ?? [];

    const projects: HubProject[] = items.map((it) => {
      const col = (id: string) => it.column_values.find((c) => c.id === id) ?? null;
      const shootText = col("date4")?.text ?? null;
      const shootIso = shootText ? shootText.replace(" ", "T") : null;
      return {
        id: it.id,
        name: it.name,
        group: it.group.title,
        status: col("status")?.text ?? null,
        projectType: col("status__1")?.text ?? null,
        shootDate: shootText,
        shootDateIso: shootIso,
        am: col("people")?.text ?? null,
        briefUrl: parseLinkColumn(col("link_1")?.value ?? null),
        dropboxUrl: parseLinkColumn(col("link8")?.value ?? null),
        mondayUrl: `https://nauticalnetwork.monday.com/boards/${boardId}/pulses/${it.id}`,
        updatedAt: it.updated_at,
        subitems: it.subitems?.map((sub) => {
          const sv = (id: string) => sub.column_values.find((c) => c.id === id)?.text?.trim() || null;
          return {
            id: String(sub.id),
            name: sub.name,
            taskType: sv("dup__of_auto_schedule"),
            status: sv("status2"),
            owner: sv("person"),
            due: sv("date__1")?.slice(0, 10) ?? null,
            dueTime: sv("date__1")?.slice(11, 16) || null,
            deliverableUrl: (() => {
              // Only a real web address is ever used as a link.
              const url = parseLinkColumn(sub.column_values.find((c) => c.id === "link")?.value ?? null);
              return url && /^https?:\/\//i.test(url) ? url : null;
            })(),
          };
        }),
      };
    });

    return { projects, ok: true };
  } catch (e) {
    return { projects: [], ok: false, error: (e as Error).message };
  }
}

/** Split projects into the buckets the tile renders. */
// The day the All Projects board's records begin, as YYYY-MM-DD (null when
// Monday cannot be reached).
//
// Shoots are counted from this board, and it only goes back so far: older
// projects are archived off it, and an archived project cannot be listed. A
// contract that started before then has periods the board cannot speak to;
// the contract maths (lib/scope/pace.ts) leaves those out instead of calling
// them missed. Worked out from the board itself, so it stays right when old
// projects are archived again.
export async function fetchBoardRecordsFrom(): Promise<string | null> {
  const token = process.env.MONDAY_API_TOKEN;
  const boardId = process.env.MONDAY_BOARD_ID_ALL_PROJECTS;
  if (!token || !boardId) return null;
  try {
    const res = await fetch(MONDAY_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token, "API-Version": "2024-10" },
      body: JSON.stringify({
        query: `query BoardRecordsFrom($b: [ID!]) { boards(ids: $b) { items_page(limit: 25, query_params: { rules: [{ column_id: "date4", compare_value: [], operator: is_not_empty }], order_by: [{ column_id: "date4", direction: asc }] }) { items { column_values(ids: ["date4"]) { text } } } } }`,
        variables: { b: [boardId] },
      }),
      next: { revalidate: 21600 }, // six hours: this moves a few times a year
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      data?: { boards: { items_page: { items: { column_values: { text: string | null }[] }[] } }[] };
    };
    const dates = (body.data?.boards?.[0]?.items_page?.items ?? [])
      .map((i) => (i.column_values?.[0]?.text ?? "").slice(0, 10))
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort();
    // The first date that starts a steady run of projects (two more within a
    // month), so one stray item with an old date does not set the mark.
    const dayOf = (d: string) => new Date(d + "T12:00:00Z").getTime();
    for (let i = 0; i + 2 < dates.length; i++) {
      if (dayOf(dates[i + 2]) - dayOf(dates[i]) <= 31 * 86400000) return dates[i];
    }
    return null;
  } catch {
    return null;
  }
}

export function bucketProjects(all: HubProject[]): {
  upcoming: HubProject[];
  inFlight: HubProject[];
  recent: HubProject[];
} {
  const now = new Date();
  const upcoming: HubProject[] = [];
  const inFlight: HubProject[] = [];
  const recent: HubProject[] = [];

  for (const p of all) {
    const isFinished =
      p.status === "Completed" ||
      p.status === "Done" ||
      p.status === "Archived" ||
      p.group === "Completed" ||
      p.group.toLowerCase().includes("holding") === false && p.status === null && p.group === "Completed";

    const shoot = p.shootDateIso ? new Date(p.shootDateIso) : null;

    if (shoot && shoot >= now && !isFinished) {
      upcoming.push(p);
    } else if (isFinished) {
      recent.push(p);
    } else {
      inFlight.push(p);
    }
  }

  upcoming.sort((a, b) => (a.shootDateIso ?? "").localeCompare(b.shootDateIso ?? ""));
  inFlight.sort((a, b) => {
    const ra = STATUS_RANK[a.status ?? ""] ?? 5;
    const rb = STATUS_RANK[b.status ?? ""] ?? 5;
    if (ra !== rb) return ra - rb;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
  recent.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return { upcoming, inFlight, recent: recent.slice(0, 5) };
}
