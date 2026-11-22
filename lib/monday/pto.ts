// PTO board reader — Monday board 9612850479 is where the PTO form
// lands. We pull items + columns once per 60s and the Hub uses the
// result to show (a) your own requests, (b) requests your reports
// filed that need your approval, and (c) a "who's out today" strip
// across the whole team.

const MONDAY_API_URL = "https://api.monday.com/v2";
const PTO_BOARD_ID = process.env.MONDAY_BOARD_ID_PTO ?? "9612850479";

async function mondayFetch<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
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

export type PtoRequest = {
  id: string;
  name: string;
  requestor_name: string | null;
  requestor_email: string | null;
  start_date: string | null;
  end_date: string | null;
  kind: string | null;
  status: string | null;
  status_color: string | null;
  notes: string | null;
  created_at: string | null;
  monday_url: string;
};

type RawItem = {
  id: string;
  name: string;
  created_at?: string | null;
  column_values: Array<{
    id: string;
    text: string | null;
    value: string | null;
    type: string;
  }>;
};

type ColumnMeta = { id: string; title: string; type: string };

// Pick a column id by type + optional title hint. Monday boards are
// configured by hand, so we fall back to "any column of this type" if
// a title match isn't found.
function pickColumn(
  cols: ColumnMeta[],
  type: string,
  titleIncludes?: RegExp
): string | null {
  const byType = cols.filter((c) => c.type === type);
  if (titleIncludes) {
    const match = byType.find((c) => titleIncludes.test(c.title));
    if (match) return match.id;
  }
  return byType[0]?.id ?? null;
}

function parseDateRange(value: string | null): {
  start_date: string | null;
  end_date: string | null;
} {
  if (!value) return { start_date: null, end_date: null };
  try {
    const parsed = JSON.parse(value) as {
      from?: string;
      to?: string;
      date?: string;
    };
    return {
      start_date: parsed.from ?? parsed.date ?? null,
      end_date: parsed.to ?? parsed.date ?? null,
    };
  } catch {
    return { start_date: null, end_date: null };
  }
}

function parsePersonEmail(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as {
      personsAndTeams?: Array<{ id: number; kind: string }>;
      email?: string;
    };
    if (parsed.email) return parsed.email;
    return null;
  } catch {
    return null;
  }
}

function parseStatus(value: string | null): { label: string | null; color: string | null } {
  if (!value) return { label: null, color: null };
  try {
    const parsed = JSON.parse(value) as { label?: string; color?: string };
    return { label: parsed.label ?? null, color: parsed.color ?? null };
  } catch {
    return { label: null, color: null };
  }
}

export async function fetchPtoRequests(): Promise<{
  found: boolean;
  items: PtoRequest[];
  ok: boolean;
  error?: string;
}> {
  try {
    const data = await mondayFetch<{
      boards: Array<{
        id: string;
        columns: ColumnMeta[];
        items_page: { items: RawItem[] };
      }>;
    }>(
      `query ($boardId: ID!) {
        boards(ids: [$boardId]) {
          id
          columns { id title type }
          items_page(limit: 200) {
            items {
              id
              name
              created_at
              column_values { id text value type }
            }
          }
        }
      }`,
      { boardId: PTO_BOARD_ID }
    );

    const board = data.boards?.[0];
    if (!board) return { found: false, items: [], ok: true };

    const cols = board.columns;
    const dateCol = pickColumn(cols, "date", /dates?|range|time off|pto/i);
    const personCol = pickColumn(cols, "people", /person|requestor|team member|employee/i);
    const statusCol = pickColumn(
      cols,
      "status",
      /status|approval|state/i
    );
    const notesCol = pickColumn(cols, "long-text", /notes|reason|details|message/i);
    const kindCol = pickColumn(cols, "dropdown", /type|kind|category|reason/i) ??
      pickColumn(cols, "status", /type|kind|category|reason/i);

    const items: PtoRequest[] = board.items_page.items.map((it) => {
      const cvById: Record<string, { text: string | null; value: string | null }> = {};
      for (const cv of it.column_values) {
        cvById[cv.id] = { text: cv.text, value: cv.value };
      }
      const dateRange = parseDateRange(dateCol ? cvById[dateCol]?.value ?? null : null);
      const status = parseStatus(statusCol ? cvById[statusCol]?.value ?? null : null);
      const personEmail = personCol
        ? parsePersonEmail(cvById[personCol]?.value ?? null)
        : null;
      const personText = personCol ? cvById[personCol]?.text ?? null : null;
      return {
        id: it.id,
        name: it.name,
        requestor_name: personText,
        requestor_email: personEmail,
        start_date: dateRange.start_date,
        end_date: dateRange.end_date,
        kind: kindCol ? cvById[kindCol]?.text ?? null : null,
        status: status.label ?? (statusCol ? cvById[statusCol]?.text ?? null : null),
        status_color: status.color,
        notes: notesCol ? cvById[notesCol]?.text ?? null : null,
        created_at: it.created_at ?? null,
        monday_url: `https://nauticalnetwork.monday.com/boards/${PTO_BOARD_ID}/pulses/${it.id}`,
      };
    });

    return { found: true, items, ok: true };
  } catch (e) {
    return {
      found: false,
      items: [],
      ok: false,
      error: (e as Error).message,
    };
  }
}

/** Is the signed-in user currently out? Any PTO item whose range covers
 *  today AND whose status is approved (or at least not denied/declined). */
export function isOutToday(req: PtoRequest, now = new Date()): boolean {
  if (!req.start_date) return false;
  const start = new Date(req.start_date + "T00:00:00").getTime();
  const end = new Date((req.end_date ?? req.start_date) + "T23:59:59").getTime();
  const today = now.getTime();
  if (today < start || today > end) return false;
  const status = (req.status ?? "").toLowerCase();
  if (status.includes("denied") || status.includes("declined") || status.includes("rejected")) {
    return false;
  }
  return true;
}

/** Items awaiting approval — status is clearly "pending" / "submitted" and
 *  the start date hasn't passed. */
export function isPending(req: PtoRequest): boolean {
  const status = (req.status ?? "").toLowerCase();
  return (
    status === "" ||
    status.includes("pending") ||
    status.includes("submitted") ||
    status.includes("review") ||
    status.includes("awaiting")
  );
}

/** YYYY-MM-DD pretty. */
export function fmtPtoDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso + "T12:00:00");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ── Submission schema — read the board's columns so the Hub form's
// PTO-type dropdown and default status match what Operations configured
// in Monday. Cached in the fetch cache for 5 minutes.

export type PtoSchema = {
  found: boolean;
  columns: {
    personColId: string | null;
    dateColId: string | null;
    statusColId: string | null;
    typeColId: string | null;
    typeColKind: "status" | "dropdown" | null;
    notesColId: string | null;
  };
  typeLabels: string[];
  statusLabels: string[];
  defaultStatusLabel: string | null;
};

const DEFAULT_TYPES = ["Vacation", "Sick", "Personal", "Bereavement", "Other"];

type ColumnFull = {
  id: string;
  title: string;
  type: string;
  settings_str: string | null;
};

type SettingsLabels =
  | { labels?: Record<string, string>; labels_v2?: Array<{ id: number; name: string }> }
  | { labels?: Array<{ id: string | number; name: string }> };

function parseSettingsLabels(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as SettingsLabels;
    if (parsed && Array.isArray((parsed as { labels?: unknown[] }).labels)) {
      return ((parsed as { labels: Array<{ name?: string; id?: unknown }> }).labels)
        .map((l) => l.name ?? "")
        .filter((n) => typeof n === "string" && n.trim().length > 0);
    }
    if (parsed && (parsed as { labels?: Record<string, string> }).labels &&
        typeof (parsed as { labels: Record<string, string> }).labels === "object") {
      return Object.values(
        (parsed as { labels: Record<string, string> }).labels
      ).filter((n): n is string => typeof n === "string" && n.trim().length > 0);
    }
    if (parsed && Array.isArray((parsed as { labels_v2?: Array<{ name: string }> }).labels_v2)) {
      return ((parsed as { labels_v2: Array<{ name: string }> }).labels_v2)
        .map((l) => l.name)
        .filter((n) => typeof n === "string" && n.trim().length > 0);
    }
  } catch {
    // fall through
  }
  return [];
}

export async function fetchPtoSchema(): Promise<PtoSchema> {
  try {
    const data = await mondayFetch<{
      boards: Array<{
        id: string;
        columns: ColumnFull[];
      }>;
    }>(
      `query ($boardId: ID!) {
        boards(ids: [$boardId]) {
          id
          columns { id title type settings_str }
        }
      }`,
      { boardId: PTO_BOARD_ID }
    );
    const board = data.boards?.[0];
    if (!board) {
      return {
        found: false,
        columns: {
          personColId: null,
          dateColId: null,
          statusColId: null,
          typeColId: null,
          typeColKind: null,
          notesColId: null,
        },
        typeLabels: DEFAULT_TYPES,
        statusLabels: [],
        defaultStatusLabel: null,
      };
    }
    const cols = board.columns;
    const personColId = pickColumn(cols, "people", /person|requestor|team member|employee/i);
    const dateColId = pickColumn(cols, "date", /dates?|range|time off|pto/i);

    // Status column — the "where in the approval pipeline" one.
    const statusColId =
      cols.find((c) => c.type === "status" && /status|approval|state/i.test(c.title))?.id ??
      pickColumn(cols, "status");

    // Type column — separate from status. Prefer dropdown with a
    // "type/kind/category/reason" title; fall back to any dropdown; fall
    // back to a second status column.
    let typeColId: string | null = null;
    let typeColKind: "status" | "dropdown" | null = null;
    const typeDropdown =
      cols.find((c) => c.type === "dropdown" && /type|kind|category|reason/i.test(c.title)) ??
      cols.find((c) => c.type === "dropdown");
    if (typeDropdown) {
      typeColId = typeDropdown.id;
      typeColKind = "dropdown";
    } else {
      const typeStatus = cols.find(
        (c) => c.type === "status" && c.id !== statusColId && /type|kind|category|reason/i.test(c.title)
      );
      if (typeStatus) {
        typeColId = typeStatus.id;
        typeColKind = "status";
      }
    }

    const notesColId = pickColumn(cols, "long-text", /notes|reason|details|message/i);

    const typeLabels =
      typeColId
        ? parseSettingsLabels(cols.find((c) => c.id === typeColId)?.settings_str ?? null)
        : [];
    const statusLabels =
      statusColId
        ? parseSettingsLabels(cols.find((c) => c.id === statusColId)?.settings_str ?? null)
        : [];

    // Default status = anything that reads as "pending" / "submitted"
    // / "awaiting"; fallback to the first label.
    const defaultStatusLabel =
      statusLabels.find((l) =>
        /pending|submitted|awaiting|review|new|requested/i.test(l)
      ) ?? statusLabels[0] ?? null;

    return {
      found: true,
      columns: {
        personColId,
        dateColId,
        statusColId,
        typeColId,
        typeColKind,
        notesColId,
      },
      typeLabels: typeLabels.length > 0 ? typeLabels : DEFAULT_TYPES,
      statusLabels,
      defaultStatusLabel,
    };
  } catch {
    return {
      found: false,
      columns: {
        personColId: null,
        dateColId: null,
        statusColId: null,
        typeColId: null,
        typeColKind: null,
        notesColId: null,
      },
      typeLabels: DEFAULT_TYPES,
      statusLabels: [],
      defaultStatusLabel: null,
    };
  }
}

export async function submitPtoRequest(input: {
  requestorMondayId: string | null;
  requestorName: string;
  requestorEmail: string | null;
  type: string;
  startDate: string;
  endDate: string;
  notes: string;
}): Promise<{ id: string; monday_url: string }> {
  const schema = await fetchPtoSchema();
  if (!schema.found) {
    throw new Error("PTO board schema not available.");
  }
  const cols = schema.columns;

  // Build the column_values JSON.
  const columnValues: Record<string, unknown> = {};

  if (cols.personColId) {
    if (input.requestorMondayId) {
      columnValues[cols.personColId] = {
        personsAndTeams: [
          { id: Number(input.requestorMondayId), kind: "person" },
        ],
      };
    }
  }
  if (cols.dateColId) {
    columnValues[cols.dateColId] =
      input.startDate === input.endDate
        ? { date: input.startDate }
        : { from: input.startDate, to: input.endDate };
  }
  if (cols.typeColId) {
    if (cols.typeColKind === "dropdown") {
      columnValues[cols.typeColId] = { labels: [input.type] };
    } else {
      columnValues[cols.typeColId] = { label: input.type };
    }
  }
  if (cols.statusColId && schema.defaultStatusLabel) {
    columnValues[cols.statusColId] = { label: schema.defaultStatusLabel };
  }
  if (cols.notesColId && input.notes.trim()) {
    columnValues[cols.notesColId] = String(input.notes).slice(0, 2000);
  }

  // Item name: "<Requestor> — <Type> (start date)"
  const name = `${input.requestorName} · ${input.type} · ${input.startDate}`;

  const data = await mondayFetch<{
    create_item: { id: string } | null;
  }>(
    `mutation ($boardId: ID!, $itemName: String!, $columnValues: JSON!) {
      create_item(board_id: $boardId, item_name: $itemName, column_values: $columnValues) {
        id
      }
    }`,
    {
      boardId: PTO_BOARD_ID,
      itemName: name,
      columnValues: JSON.stringify(columnValues),
    }
  );
  const item = data.create_item;
  if (!item) throw new Error("Monday create_item returned no id.");
  return {
    id: item.id,
    monday_url: `https://nauticalnetwork.monday.com/boards/${PTO_BOARD_ID}/pulses/${item.id}`,
  };
}
