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
  brandName: string
): Promise<ProjectsForClient> {
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
      };
    });

    return { projects, ok: true };
  } catch (e) {
    return { projects: [], ok: false, error: (e as Error).message };
  }
}

/** Split projects into the buckets the tile renders. */
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
