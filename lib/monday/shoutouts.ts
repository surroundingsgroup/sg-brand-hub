// Shoutouts & Showcases Monday board reader + writer.
//
// Board ID 18203645701 (overridable via MONDAY_BOARD_ID_SHOUTOUTS).
// Same shape pattern as PTO: dynamic column discovery so the Hub form
// stays correct if Operations tweaks column titles or label sets.

const MONDAY_API_URL = "https://api.monday.com/v2";
const SHOUTOUTS_BOARD_ID =
  process.env.MONDAY_BOARD_ID_SHOUTOUTS ?? "18203645701";

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

type ColumnFull = {
  id: string;
  title: string;
  type: string;
  settings_str: string | null;
};

function pickColumn(cols: ColumnFull[], type: string, titleIncludes?: RegExp): string | null {
  const byType = cols.filter((c) => c.type === type);
  if (titleIncludes) {
    const match = byType.find((c) => titleIncludes.test(c.title));
    if (match) return match.id;
  }
  return byType[0]?.id ?? null;
}

function parseSettingsLabels(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as {
      labels?: Record<string, string> | Array<{ id: string | number; name: string }>;
      labels_v2?: Array<{ id: number; name: string }>;
    };
    if (parsed && Array.isArray(parsed.labels)) {
      return parsed.labels
        .map((l) => l.name ?? "")
        .filter((n) => typeof n === "string" && n.trim().length > 0);
    }
    if (parsed && parsed.labels && typeof parsed.labels === "object") {
      return Object.values(parsed.labels as Record<string, string>).filter(
        (n): n is string => typeof n === "string" && n.trim().length > 0
      );
    }
    if (parsed && Array.isArray(parsed.labels_v2)) {
      return parsed.labels_v2
        .map((l) => l.name)
        .filter((n) => typeof n === "string" && n.trim().length > 0);
    }
  } catch {
    // fall through
  }
  return [];
}

export type ShoutoutRecord = {
  id: string;
  name: string;
  from_name: string | null;
  from_email: string | null;
  to_name: string | null;
  kind: string | null;
  message: string | null;
  created_at: string | null;
  monday_url: string;
};

export type ShoutoutSchema = {
  found: boolean;
  columns: {
    fromColId: string | null;
    toColId: string | null;
    kindColId: string | null;
    kindColKind: "status" | "dropdown" | null;
    messageColId: string | null;
  };
  kindLabels: string[];
};

function parsePersonText(value: string | null): string | null {
  // Monday's person column text already arrives as "Billy Pavlock" or
  // "Billy Pavlock, Austin Tompkins". Return as-is.
  return value && value.trim() ? value.trim() : null;
}

function parsePersonEmailFromValue(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { email?: string };
    return parsed.email ?? null;
  } catch {
    return null;
  }
}

function parseStatusLabel(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { label?: string };
    return parsed.label ?? null;
  } catch {
    return null;
  }
}

function parseDropdownLabels(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as { labels?: string[]; chosenValues?: string[] };
    if (Array.isArray(parsed.labels)) return parsed.labels;
    if (Array.isArray(parsed.chosenValues)) return parsed.chosenValues;
  } catch {
    // fall through
  }
  return [];
}

export async function fetchShoutoutsSchema(): Promise<ShoutoutSchema> {
  try {
    const data = await mondayFetch<{
      boards: Array<{ id: string; columns: ColumnFull[] }>;
    }>(
      `query ($boardId: ID!) {
        boards(ids: [$boardId]) {
          id
          columns { id title type settings_str }
        }
      }`,
      { boardId: SHOUTOUTS_BOARD_ID }
    );
    const board = data.boards?.[0];
    if (!board) {
      return {
        found: false,
        columns: {
          fromColId: null,
          toColId: null,
          kindColId: null,
          kindColKind: null,
          messageColId: null,
        },
        kindLabels: ["Shoutout", "Showcase"],
      };
    }
    const cols = board.columns;

    const fromColId =
      cols.find((c) => c.type === "people" && /from|sender|author|submitted by/i.test(c.title))?.id ??
      pickColumn(cols, "people");
    const toColId =
      cols.find(
        (c) => c.type === "people" && c.id !== fromColId && /to|recipient|for|about/i.test(c.title)
      )?.id ??
      cols.find((c) => c.type === "people" && c.id !== fromColId)?.id ??
      null;

    let kindColId: string | null = null;
    let kindColKind: "status" | "dropdown" | null = null;
    const kindDropdown =
      cols.find((c) => c.type === "dropdown" && /type|kind|category|shout/i.test(c.title)) ??
      cols.find((c) => c.type === "dropdown");
    if (kindDropdown) {
      kindColId = kindDropdown.id;
      kindColKind = "dropdown";
    } else {
      const kindStatus =
        cols.find((c) => c.type === "status" && /type|kind|category|shout/i.test(c.title)) ??
        cols.find((c) => c.type === "status");
      if (kindStatus) {
        kindColId = kindStatus.id;
        kindColKind = "status";
      }
    }

    const messageColId =
      pickColumn(cols, "long-text", /message|note|detail|shout|showcase|body/i) ??
      pickColumn(cols, "long_text", /message|note|detail|shout|showcase|body/i);

    const kindLabels =
      kindColId
        ? parseSettingsLabels(cols.find((c) => c.id === kindColId)?.settings_str ?? null)
        : [];

    return {
      found: true,
      columns: {
        fromColId,
        toColId,
        kindColId,
        kindColKind,
        messageColId,
      },
      kindLabels: kindLabels.length > 0 ? kindLabels : ["Shoutout", "Showcase"],
    };
  } catch {
    return {
      found: false,
      columns: {
        fromColId: null,
        toColId: null,
        kindColId: null,
        kindColKind: null,
        messageColId: null,
      },
      kindLabels: ["Shoutout", "Showcase"],
    };
  }
}

export async function fetchShoutouts(): Promise<{
  found: boolean;
  items: ShoutoutRecord[];
  ok: boolean;
  error?: string;
}> {
  try {
    const schema = await fetchShoutoutsSchema();
    if (!schema.found) return { found: false, items: [], ok: true };

    const data = await mondayFetch<{
      boards: Array<{
        items_page: {
          items: Array<{
            id: string;
            name: string;
            created_at?: string | null;
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
          items_page(limit: 100) {
            items {
              id
              name
              created_at
              column_values { id text value type }
            }
          }
        }
      }`,
      { boardId: SHOUTOUTS_BOARD_ID }
    );

    const items = (data.boards?.[0]?.items_page?.items ?? []).map((it) => {
      const cv: Record<string, { text: string | null; value: string | null }> = {};
      for (const c of it.column_values) cv[c.id] = { text: c.text, value: c.value };

      const kind = schema.columns.kindColId
        ? schema.columns.kindColKind === "status"
          ? parseStatusLabel(cv[schema.columns.kindColId]?.value ?? null) ??
            cv[schema.columns.kindColId]?.text ??
            null
          : (parseDropdownLabels(cv[schema.columns.kindColId]?.value ?? null)[0] ??
            cv[schema.columns.kindColId]?.text ??
            null)
        : null;

      return {
        id: it.id,
        name: it.name,
        from_name: schema.columns.fromColId
          ? parsePersonText(cv[schema.columns.fromColId]?.text ?? null)
          : null,
        from_email: schema.columns.fromColId
          ? parsePersonEmailFromValue(cv[schema.columns.fromColId]?.value ?? null)
          : null,
        to_name: schema.columns.toColId
          ? parsePersonText(cv[schema.columns.toColId]?.text ?? null)
          : null,
        kind,
        message: schema.columns.messageColId
          ? cv[schema.columns.messageColId]?.text ?? null
          : null,
        created_at: it.created_at ?? null,
        monday_url: `https://nauticalnetwork.monday.com/boards/${SHOUTOUTS_BOARD_ID}/pulses/${it.id}`,
      };
    });

    // Newest first (fallback to Monday's own order if created_at is absent).
    items.sort((a, b) => {
      const at = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bt = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bt - at;
    });

    return { found: true, items, ok: true };
  } catch (e) {
    return { found: false, items: [], ok: false, error: (e as Error).message };
  }
}

export async function submitShoutout(input: {
  fromMondayId: string | null;
  fromName: string;
  toName: string | null;
  toMondayId: string | null;
  kind: string;
  message: string;
}): Promise<{ id: string; monday_url: string }> {
  const schema = await fetchShoutoutsSchema();
  if (!schema.found) throw new Error("Shoutouts board schema not available.");

  const cols = schema.columns;
  const columnValues: Record<string, unknown> = {};

  if (cols.fromColId && input.fromMondayId) {
    columnValues[cols.fromColId] = {
      personsAndTeams: [{ id: Number(input.fromMondayId), kind: "person" }],
    };
  }
  if (cols.toColId && input.toMondayId) {
    columnValues[cols.toColId] = {
      personsAndTeams: [{ id: Number(input.toMondayId), kind: "person" }],
    };
  }
  if (cols.kindColId) {
    if (cols.kindColKind === "dropdown") {
      columnValues[cols.kindColId] = { labels: [input.kind] };
    } else {
      columnValues[cols.kindColId] = { label: input.kind };
    }
  }
  if (cols.messageColId && input.message.trim()) {
    columnValues[cols.messageColId] = input.message.slice(0, 2000);
  }

  // Item name: "<Kind> for <toName> — from <fromName>"
  const nameParts: string[] = [input.kind];
  if (input.toName) nameParts.push(`for ${input.toName}`);
  nameParts.push(`· from ${input.fromName}`);
  const name = nameParts.join(" ");

  const data = await mondayFetch<{ create_item: { id: string } | null }>(
    `mutation ($boardId: ID!, $itemName: String!, $columnValues: JSON!) {
      create_item(board_id: $boardId, item_name: $itemName, column_values: $columnValues) {
        id
      }
    }`,
    {
      boardId: SHOUTOUTS_BOARD_ID,
      itemName: name,
      columnValues: JSON.stringify(columnValues),
    }
  );
  const item = data.create_item;
  if (!item) throw new Error("Monday create_item returned no id.");
  return {
    id: item.id,
    monday_url: `https://nauticalnetwork.monday.com/boards/${SHOUTOUTS_BOARD_ID}/pulses/${item.id}`,
  };
}
