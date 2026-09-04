// Minimal Monday.com GraphQL client. Wraps the few operations the approve
// flow needs: create/update an item on the Intake board, create a parent
// item on the All Projects board, create subitems, and post an update.

const MONDAY_API_URL = "https://api.monday.com/v2";

function token() {
  const t = process.env.MONDAY_API_TOKEN;
  if (!t) throw new Error("MONDAY_API_TOKEN is not set");
  return t;
}

async function mondayFetch<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token(),
      "API-Version": "2024-10",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Monday API HTTP ${res.status}: ${text.slice(0, 400)}`);
  }

  const body = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (body.errors && body.errors.length > 0) {
    throw new Error(`Monday API: ${body.errors.map((e) => e.message).join("; ")}`);
  }
  if (!body.data) throw new Error("Monday API returned no data");
  return body.data;
}

export type IntakeColumnValues = {
  // Map to Monday column IDs on the Client Onboarding Asset Intake board.
  // Filled by `buildIntakeColumnValues` below.
  [key: string]: unknown;
};

// ---------- Intake board (Client Onboarding Asset Intake, 8012504126) ----------

export async function createIntakeItem(opts: {
  boardId: string;
  itemName: string;
  columnValues: IntakeColumnValues;
}): Promise<{ id: string }> {
  const data = await mondayFetch<{ create_item: { id: string } }>(
    `mutation Create($boardId: ID!, $itemName: String!, $columnValues: JSON) {
      create_item(board_id: $boardId, item_name: $itemName, column_values: $columnValues) {
        id
      }
    }`,
    {
      boardId: opts.boardId,
      itemName: opts.itemName,
      columnValues: JSON.stringify(opts.columnValues),
    }
  );
  return { id: data.create_item.id };
}

export async function updateIntakeColumns(opts: {
  boardId: string;
  itemId: string;
  columnValues: IntakeColumnValues;
}): Promise<void> {
  await mondayFetch(
    `mutation Update($boardId: ID!, $itemId: ID!, $columnValues: JSON!) {
      change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $columnValues) {
        id
      }
    }`,
    {
      boardId: opts.boardId,
      itemId: opts.itemId,
      columnValues: JSON.stringify(opts.columnValues),
    }
  );
}

// ---------- All Projects board ----------

export async function createAllProjectsParent(opts: {
  boardId: string;
  itemName: string;
  groupId?: string;
  columnValues?: Record<string, unknown>;
}): Promise<{ id: string }> {
  // create_labels_if_missing: true lets us pass a brand-new client name to the
  // Client dropdown without first defining it on the board.
  const data = await mondayFetch<{ create_item: { id: string } }>(
    `mutation Create($boardId: ID!, $itemName: String!, $groupId: String, $columnValues: JSON) {
      create_item(
        board_id: $boardId,
        item_name: $itemName,
        group_id: $groupId,
        column_values: $columnValues,
        create_labels_if_missing: true
      ) {
        id
      }
    }`,
    {
      boardId: opts.boardId,
      itemName: opts.itemName,
      groupId: opts.groupId,
      columnValues: opts.columnValues ? JSON.stringify(opts.columnValues) : undefined,
    }
  );
  return { id: data.create_item.id };
}

// Look up a Monday user by name (fuzzy match). Returns the closest match's
// profile so we can populate the AM/BD person column + contact text fields
// on the All Projects parent item.
export async function findUserByName(name: string): Promise<
  { id: string; name: string; email: string | null; phone: string | null } | null
> {
  const cleaned = name.trim();
  if (!cleaned) return null;
  const data = await mondayFetch<{
    users: Array<{ id: string; name: string; email: string | null; phone: string | null }>;
  }>(
    `query Users($name: String, $limit: Int) {
      users(name: $name, limit: $limit) {
        id
        name
        email
        phone
      }
    }`,
    { name: cleaned, limit: 5 }
  );
  if (!data.users || data.users.length === 0) return null;
  const exact = data.users.find((u) => u.name.toLowerCase() === cleaned.toLowerCase());
  return exact ?? data.users[0];
}

// Project Intake group on the All Projects board (where new approved brands land).
export const ALL_PROJECTS_INTAKE_GROUP_ID = "new_group_mkkykw5r";

// Project Type column + "Video Assets" label index.
export const ALL_PROJECTS_PROJECT_TYPE_COLUMN = "status__1";
export const PROJECT_TYPE_VIDEO_ASSETS_INDEX = 104;

// All Projects board: additional column IDs we populate on a new parent.
export const ALL_PROJECTS_COLUMNS = {
  client: "dropdown",        // Client dropdown (label = brand name)
  amBd: "people",            // AM/BD person column
  primaryName: "text0",      // Primary Name
  primaryEmail: "text4",     // Primary Email
  primaryPhone: "text49",    // Primary Phone
  dbParentFolder: "link8",   // DB Parent Folder (link to Dropbox client folder)
} as const;

// Update arbitrary column values on an existing All Projects item. Used to
// back-fill the Dropbox folder link on a re-approve when the parent item
// already exists.
export async function updateAllProjectsColumns(opts: {
  boardId: string;
  itemId: string;
  columnValues: Record<string, unknown>;
}): Promise<void> {
  await mondayFetch(
    `mutation Update($boardId: ID!, $itemId: ID!, $columnValues: JSON!) {
      change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $columnValues) {
        id
      }
    }`,
    {
      boardId: opts.boardId,
      itemId: opts.itemId,
      columnValues: JSON.stringify(opts.columnValues),
    }
  );
}

/**
 * Build an HTML mention that Monday will render as a clickable tag and fire
 * a notification on. The `data-mention-type="User"` + `data-mention-id` attrs
 * are what Monday's update parser looks for.
 */
export function mention(userId: string, displayName: string): string {
  return `<a data-mention-type="User" data-mention-id="${userId}" data-mention-name="${displayName}" href="https://nauticalnetwork.monday.com/users/${userId}">@${displayName}</a>`;
}

export async function createSubitem(opts: {
  parentItemId: string;
  itemName: string;
  columnValues?: Record<string, unknown>;
}): Promise<{ id: string }> {
  const data = await mondayFetch<{ create_subitem: { id: string } }>(
    `mutation CreateSub($parentItemId: ID!, $itemName: String!, $columnValues: JSON) {
      create_subitem(parent_item_id: $parentItemId, item_name: $itemName, column_values: $columnValues) {
        id
      }
    }`,
    {
      parentItemId: opts.parentItemId,
      itemName: opts.itemName,
      columnValues: opts.columnValues ? JSON.stringify(opts.columnValues) : undefined,
    }
  );
  return { id: data.create_subitem.id };
}

export async function postUpdate(opts: {
  itemId: string;
  body: string;
}): Promise<void> {
  await mondayFetch(
    `mutation Post($itemId: ID!, $body: String!) {
      create_update(item_id: $itemId, body: $body) { id }
    }`,
    opts
  );
}

// ---------- Helpers to format Monday column values ----------

/**
 * Build the column_values payload for the Client Onboarding Asset Intake board
 * based on a brand record. Pulls only what we want to push back to Monday.
 *
 * Column IDs come from the board metadata we fetched earlier:
 *   link_mkv84m88        Brand Guideline (link)
 *   link_mkqgc924        DB Parent Folder (link)
 *   short_textl2prmqt6   Website
 *   text_Mjj2kdtv        Brand Color 1 (comma hex list)
 *   text_1_Mjj2woeO      Brand Color 2 (comma hex list)
 *   text_2_Mjj2PJRM      Font Family
 *   long_text_Mjj24ZDl   Additional Info / overview
 *   long_text9qcmxe7t    Target Audience
 *   text_2_Mjj2yQkE      Music
 */
export function buildIntakeColumnValues(brand: {
  business_name: string;
  brand_guideline_pdf_url: string | null;
  share_token: string;
  website: string | null;
  dropbox_folder_url: string | null;
  overview_polished: string | null;
  audience_type: string | null;
  music_notes: string | null;
  colors: Array<{ name: string; hex: string; role: string }>;
  fonts: Array<{ name: string; role: string }>;
}, appUrl: string): IntakeColumnValues {
  const primaryHexes = brand.colors
    .filter((c) => c.role === "primary")
    .map((c) => c.hex)
    .join(", ");
  const secondaryHexes = brand.colors
    .filter((c) => c.role === "secondary")
    .map((c) => c.hex)
    .join(", ");
  const primaryFont = brand.fonts.find((f) => f.role === "primary")?.name ?? "";
  const secondaryFont = brand.fonts.find((f) => f.role === "secondary")?.name ?? "";
  const fontLine = [primaryFont, secondaryFont].filter(Boolean).join(" / ");

  // The Brand Guideline column should now point at the SG Brand Hub share page
  // — that's the new canonical brand guideline.
  const shareUrl = `${appUrl}/share/${brand.share_token}`;
  const guidelineText = `${brand.business_name} brand guidelines`;

  const cv: IntakeColumnValues = {
    link_mkv84m88: { url: shareUrl, text: guidelineText },
  };

  if (brand.dropbox_folder_url) {
    cv.link_mkqgc924 = { url: brand.dropbox_folder_url, text: "Dropbox folder" };
  }
  if (brand.website) {
    cv.short_textl2prmqt6 = brand.website;
  }
  if (primaryHexes) cv.text_Mjj2kdtv = primaryHexes;
  if (secondaryHexes) cv.text_1_Mjj2woeO = secondaryHexes;
  if (fontLine) cv.text_2_Mjj2PJRM = fontLine;
  if (brand.overview_polished) cv.long_text_Mjj24ZDl = brand.overview_polished;
  if (brand.audience_type) cv.long_text9qcmxe7t = brand.audience_type;
  if (brand.music_notes) cv.text_2_Mjj2yQkE = brand.music_notes;

  return cv;
}

// ---------- Subitem template ----------

/**
 * The 7 standard sub-items every Video Assets project gets. These match
 * the pattern observed on working items on the All Projects board (Wylden,
 * Moore Yacht Sales, Nautical Studios, etc.).
 *
 * Historically, a Monday automation ("when Trigger Subitems changes to
 * Done → copy sub-items from a per-client Creative Assets Kit template")
 * spawned these. That automation is unreliable for new clients — it
 * requires a pre-existing per-client kit item, so brands like Vollmer end
 * up with a bare parent item and zero sub-items.
 *
 * We now create these ourselves after the parent lands. Deterministic,
 * no per-client Monday setup required.
 */
export const VIDEO_ASSETS_SUBITEMS = [
  "Project Setup",
  "Social Media Reel End Card #1",
  "Social Media Reel End Card #2",
  "Client Lower Third Title 16x9 Format",
  "Client Lower Third Title 9x16 Format",
  "Main Video End Card #1",
  "Main Video End Card #2",
] as const;

/**
 * Create the 7 standard Video Assets sub-items under a parent item.
 * Fires them in parallel — Monday accepts concurrent create_subitem calls
 * against the same parent. Returns the created IDs in name order.
 *
 * Best-effort: individual failures are logged but don't block the others.
 */
export async function createVideoAssetsSubitems(
  parentItemId: string
): Promise<{ created: number; failed: number; ids: string[] }> {
  const results = await Promise.allSettled(
    VIDEO_ASSETS_SUBITEMS.map((name) =>
      createSubitem({ parentItemId, itemName: name })
    )
  );
  const ids: string[] = [];
  let failed = 0;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") {
      ids.push(r.value.id);
    } else {
      failed++;
      console.error(
        `[createVideoAssetsSubitems] "${VIDEO_ASSETS_SUBITEMS[i]}" failed on parent ${parentItemId}: ${r.reason?.message ?? r.reason}`
      );
    }
  }
  return { created: ids.length, failed, ids };
}

export function buildSubitemDescription(opts: {
  brandName: string;
  shareUrl: string;
  pdfUrl: string | null;
  dropboxUrl: string | null;
}) {
  const lines = [`Brand: ${opts.brandName}`, `Share page: ${opts.shareUrl}`];
  if (opts.pdfUrl) lines.push(`Brand guidelines PDF: ${opts.pdfUrl}`);
  if (opts.dropboxUrl) lines.push(`Dropbox folder: ${opts.dropboxUrl}`);
  return lines.join("\n");
}
