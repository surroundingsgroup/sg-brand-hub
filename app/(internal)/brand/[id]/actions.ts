"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Brand, BrandColor, BrandFont } from "@/types/brand";
import {
  createIntakeItem,
  updateIntakeColumns,
  createAllProjectsParent,
  updateAllProjectsColumns,
  createVideoAssetsSubitems,
  postUpdate,
  buildIntakeColumnValues,
  buildSubitemDescription,
  mention,
  findUserByName,
  ALL_PROJECTS_INTAKE_GROUP_ID,
  ALL_PROJECTS_PROJECT_TYPE_COLUMN,
  PROJECT_TYPE_VIDEO_ASSETS_INDEX,
  ALL_PROJECTS_COLUMNS,
} from "@/lib/monday/client";
import { ensureBrandFolderTree } from "@/lib/dropbox/client";
import { generateAndSaveBrandPdf } from "@/lib/pdf/generate";
import { alertError } from "@/lib/notifications/alert";
import { notifyAmAssigned } from "@/lib/notifications/handoff";
import { fetchDealSnapshot } from "@/lib/monday/deals";
import type { BrandLite } from "@/lib/brands/create-from-deal";

// Monday board base URL — used to derive client board URL from item IDs.
const MONDAY_BOARD_BASE_URL = "https://nauticalnetwork.monday.com";

// Display name for the default editor used in @ mentions on Monday updates.
// Kept in code rather than env to make the HTML mention copy obvious.
const DEFAULT_EDITOR_NAME = "Rendi Andrianto";

type BrandPatch = Partial<{
  business_name: string;
  website: string | null;
  tagline: string | null;
  vertical: string | null;
  vertical_other: string | null;
  submitter_name: string | null;
  submitter_email: string | null;
  submitter_phone: string | null;
  account_manager: string | null;
  client_asset_folder_url: string | null;
  client_monday_board_url: string | null;
  dropbox_folder_url: string | null;
  video_assets_folder_url: string | null;
  canva_brand_kit_url: string | null;
  instagram: string | null;
  facebook: string | null;
  youtube: string | null;
  tiktok: string | null;
  linkedin: string | null;
  overview_client_raw: string | null;
  overview_polished: string | null;
  look_and_feel: string | null;
  brand_voice: string | null;
  what_to_avoid: string | null;
  inspiration_references: string | null;
  audience_gender: string | null;
  audience_age: string | null;
  audience_type: string | null;
  coloring_tone: string | null;
  music_mood: string[] | null;
  music_genre: string[] | null;
  music_notes: string | null;
  colors: BrandColor[];
  fonts: BrandFont[];
  internal_notes: string | null;
  status: "draft" | "submitted" | "in_review" | "approved" | "archived";
  engagement_type: "retainer" | "project" | "inactive";
}>;

export async function updateBrand(id: string, patch: BrandPatch) {
  const supabase = createSupabaseServerClient();

  // Snapshot prior state so we can:
  //   (a) auto-flip status to in_review on first edit, AND
  //   (b) detect the account_manager null→set transition on deal-sourced
  //       brands, which triggers an AM-assigned DM to the newly assigned AM.
  const { data: priorRow } = await supabase
    .from("brands")
    .select("status, account_manager, source_deal_id, business_name, submitter_name, submitter_email, submitter_phone, dropbox_folder_url, source_deal_url")
    .eq("id", id)
    .single();

  // Auto-flip: if this edit didn't include a status change, and the brand is
  // still sitting in `submitted` or `draft`, the AM is actively working on
  // it now — bump to `in_review`. One-shot transition, happens silently on
  // the first edit after a public form submission.
  let effectivePatch: BrandPatch = patch;
  if (!patch.status && (priorRow?.status === "submitted" || priorRow?.status === "draft")) {
    effectivePatch = { ...patch, status: "in_review" };
  }

  const { error } = await supabase.from("brands").update(effectivePatch).eq("id", id);
  if (error) return { ok: false as const, error: error.message };

  await supabase.from("brand_activity_log").insert({
    brand_id: id,
    event_type: "edited",
    metadata: { fields: Object.keys(patch) },
  });

  // AM-assigned DM:
  //   • Brand has a source_deal_id (i.e. came from Closed Won)
  //   • Patch is setting account_manager from empty → non-empty
  //   • Fetch the live deal snapshot so the DM carries full context
  // We await this so the serverless function doesn't get killed mid-fetch.
  const priorAm = priorRow?.account_manager?.trim() ?? "";
  const newAm = patch.account_manager?.trim() ?? "";
  const isFirstAssignment = !priorAm && !!newAm;
  if (isFirstAssignment && priorRow?.source_deal_id) {
    try {
      const deal = await fetchDealSnapshot(priorRow.source_deal_id);
      const brandLite: BrandLite = {
        id,
        business_name: priorRow.business_name as string,
        submitter_name: (priorRow.submitter_name as string | null) ?? null,
        submitter_email: (priorRow.submitter_email as string | null) ?? null,
        submitter_phone: (priorRow.submitter_phone as string | null) ?? null,
        account_manager: newAm,
        dropbox_folder_url: (priorRow.dropbox_folder_url as string | null) ?? null,
        source_deal_url: (priorRow.source_deal_url as string | null) ?? null,
      };
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
      const briefToolUrl =
        process.env.NEXT_PUBLIC_BRIEF_TOOL_URL ?? "https://sg-brief-tool-nu.vercel.app";
      await notifyAmAssigned({ brand: brandLite, deal, appUrl, briefToolUrl });
    } catch (e) {
      // Don't fail the brand save — the AM was assigned successfully, the
      // DM is just a nice-to-have. Log loudly so we can debug.
      alertError({
        flow: "brand.am_assigned_dm",
        brandName: priorRow.business_name as string,
        error: e,
        extras: { brand_id: id, source_deal_id: priorRow.source_deal_id, assigned_am: newAm },
      });
    }
  }

  revalidatePath(`/brand/${id}`);
  // Dashboard's status pill + last-edited timestamp need to update on every
  // save — cheap because the page is dynamic anyway.
  revalidatePath("/dashboard");

  // Keep the public share page in sync so external editors see latest content
  // without needing a hard refresh.
  const { data: brandRow } = await supabase
    .from("brands")
    .select("share_token")
    .eq("id", id)
    .single();
  if (brandRow?.share_token) {
    revalidatePath(`/share/${brandRow.share_token}`);
  }

  return { ok: true as const };
}

/**
 * Insert a brand_logos row after the file has been uploaded to Storage
 * client-side. Kept as a server action (not a browser-client insert) so:
 *   • The row is written under the authenticated user's session cookie — no
 *     RLS-vs-anon-key ambiguity from the browser client.
 *   • Errors surface as return values instead of getting eaten by a toast.
 *   • The caller can revalidate paths to update the approval checklist +
 *     the dashboard's "last edited" timestamp.
 *
 * The Storage upload still runs client-side (files can't easily flow through
 * server actions), but the row write moves here.
 */
export async function insertLogoRow(input: {
  brandId: string;
  filePath: string;
  publicUrl: string;
  fileName: string;
}) {
  const supabase = createSupabaseServerClient();
  const { data: existing } = await supabase
    .from("brand_logos")
    .select("id")
    .eq("brand_id", input.brandId);
  const nextOrder = existing?.length ?? 0;

  const { data, error } = await supabase
    .from("brand_logos")
    .insert({
      brand_id: input.brandId,
      file_name: input.fileName,
      file_path: input.filePath,
      public_url: input.publicUrl,
      display_order: nextOrder,
    })
    .select("*")
    .single();

  if (error || !data) {
    return { ok: false as const, error: error?.message ?? "Insert returned no row" };
  }

  revalidatePath(`/brand/${input.brandId}`);
  revalidatePath("/dashboard");

  return { ok: true as const, logo: data };
}

export async function deleteLogo(brandId: string, logoId: string, filePath: string) {
  const supabase = createSupabaseServerClient();
  await supabase.storage.from("brand-logos").remove([filePath]);
  await supabase.from("brand_logos").delete().eq("id", logoId);
  await supabase.from("brand_activity_log").insert({
    brand_id: brandId,
    event_type: "logo_deleted",
    metadata: { logo_id: logoId, file_path: filePath },
  });
  revalidatePath(`/brand/${brandId}`);
}

export async function reorderLogos(brandId: string, orderedIds: string[]) {
  const supabase = createSupabaseServerClient();
  // Previously N parallel updates — if half succeeded and half failed,
  // the brand would be stuck in a half-reordered state. Use a single
  // upsert call so PostgreSQL handles all the writes as one transaction.
  const rows = orderedIds.map((id, i) => ({ id, brand_id: brandId, display_order: i }));
  // upsert needs all NOT NULL columns the existing row already has — but
  // since we're only changing display_order, we use a minimal payload and
  // rely on Supabase's onConflict update to leave the other columns alone.
  // file_name + file_path + public_url are NOT NULL on the table, so the
  // simplest atomic move is a single statement issued via rpc OR a CASE
  // expression. Both add complexity; for a small N (<= ~20 logos per
  // brand) the parallel writes are fast enough — instead we wrap them
  // in a try/catch so a partial failure is at least reported.
  const results = await Promise.allSettled(
    rows.map((r) =>
      supabase.from("brand_logos").update({ display_order: r.display_order }).eq("id", r.id)
    )
  );
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) {
    // Don't throw — the UI already optimistically reordered. Just log.
    await supabase.from("brand_activity_log").insert({
      brand_id: brandId,
      event_type: "logo_reorder_partial",
      metadata: { failed, total: rows.length },
    });
  }
  revalidatePath(`/brand/${brandId}`);
}

export async function approveBrand(id: string) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const intakeBoardId = process.env.MONDAY_BOARD_ID_INTAKE;
  const allProjectsBoardId = process.env.MONDAY_BOARD_ID_ALL_PROJECTS;
  const defaultEditorId = process.env.MONDAY_DEFAULT_EDITOR_USER_ID;

  // 1) Generate + save the brand guideline PDF — runs in-process so no
  //    same-origin HTTP fetch / cookie loss / RLS surprises. Idempotent.
  try {
    await generateAndSaveBrandPdf(id);
  } catch (e) {
    alertError({ flow: "approve.pdf", brandId: id, error: e });
    return { ok: false as const, error: `PDF generation failed: ${(e as Error).message}` };
  }

  // 2) Fetch the fresh brand record (with the new PDF URL).
  const { data: brandRow, error: fetchErr } = await supabase
    .from("brands")
    .select("*")
    .eq("id", id)
    .single();
  if (fetchErr || !brandRow) {
    return { ok: false as const, error: fetchErr?.message ?? "Brand not found" };
  }
  const b = brandRow as Brand;
  const shareUrl = `${appUrl}/share/${b.share_token}`;
  const syncWarnings: string[] = [];

  // 3) Dropbox — create the parent folder tree if we don't already have one
  //    on the brand. Idempotent (Dropbox returns existing folders / share
  //    link if they already exist). Run before Monday so the Intake sync
  //    can include the fresh Dropbox URL.
  let effectiveDropboxUrl = b.dropbox_folder_url;
  if (
    !effectiveDropboxUrl &&
    process.env.DROPBOX_REFRESH_TOKEN &&
    process.env.DROPBOX_APP_KEY &&
    process.env.DROPBOX_APP_SECRET
  ) {
    try {
      const tree = await ensureBrandFolderTree(b.business_name);
      effectiveDropboxUrl = tree.shareUrl;
      await supabase
        .from("brands")
        .update({ dropbox_folder_url: tree.shareUrl })
        .eq("id", id);
    } catch (e) {
      syncWarnings.push(`Dropbox folder creation failed: ${(e as Error).message}`);
    }
  }

  // 4) Monday — Client Onboarding Asset Intake board.
  //    If we already know the Monday item ID, UPDATE it. Otherwise CREATE.
  if (intakeBoardId && process.env.MONDAY_API_TOKEN) {
    try {
      const columnValues = buildIntakeColumnValues(
        {
          business_name: b.business_name,
          brand_guideline_pdf_url: b.brand_guideline_pdf_url,
          share_token: b.share_token,
          website: b.website,
          dropbox_folder_url: effectiveDropboxUrl,
          overview_polished: b.overview_polished,
          audience_type: b.audience_type,
          music_notes: b.music_notes,
          colors: b.colors,
          fonts: b.fonts,
        },
        appUrl
      );

      if (b.monday_intake_item_id) {
        await updateIntakeColumns({
          boardId: intakeBoardId,
          itemId: b.monday_intake_item_id,
          columnValues,
        });
      } else {
        const created = await createIntakeItem({
          boardId: intakeBoardId,
          itemName: b.business_name,
          columnValues,
        });
        await supabase
          .from("brands")
          .update({ monday_intake_item_id: created.id })
          .eq("id", id);
      }
    } catch (e) {
      syncWarnings.push(`Intake board sync failed: ${(e as Error).message}`);
    }
  }

  // 4) Monday — All Projects: create parent item in the Project Intake group
  //    with Project Type set to "Video Assets". Subitems are intentionally NOT
  //    created here — the user has their own Monday automation that fires when
  //    Project Type = Video Assets to spawn the subitems.
  //
  //    Idempotent behaviour:
  //    - monday_all_projects_item_id null → create + populate columns
  //    - monday_all_projects_item_id "external" → skip (imported brands have
  //      their own pre-existing items not tracked by ID)
  //    - monday_all_projects_item_id is a real ID → back-fill the DB Parent
  //      Folder column if we now have a Dropbox URL but didn't when the item
  //      was created. Leaves all other columns untouched to avoid overwriting
  //      manual edits.
  if (
    b.monday_all_projects_item_id &&
    b.monday_all_projects_item_id !== "external" &&
    effectiveDropboxUrl &&
    allProjectsBoardId &&
    process.env.MONDAY_API_TOKEN
  ) {
    try {
      await updateAllProjectsColumns({
        boardId: allProjectsBoardId,
        itemId: b.monday_all_projects_item_id,
        columnValues: {
          [ALL_PROJECTS_COLUMNS.dbParentFolder]: {
            url: effectiveDropboxUrl,
            text: "Dropbox folder",
          },
        },
      });
    } catch (e) {
      syncWarnings.push(
        `Couldn't back-fill DB Parent Folder on All Projects: ${(e as Error).message}`
      );
    }
  }

  if (
    !b.monday_all_projects_item_id &&
    allProjectsBoardId &&
    process.env.MONDAY_API_TOKEN
  ) {
    try {
      // Look up the AM by name so we can assign the AM/BD person column
      // and pre-fill primary contact info from their Monday profile.
      let amUser: { id: string; name: string; email: string | null; phone: string | null } | null = null;
      if (b.account_manager?.trim()) {
        try {
          amUser = await findUserByName(b.account_manager);
        } catch (amErr) {
          syncWarnings.push(
            `Couldn't look up AM "${b.account_manager}": ${(amErr as Error).message}`
          );
        }
      }

      // IMPORTANT: Project Type deliberately NOT set at item creation.
      // Monday's "when Project Type changes → create sub-items" automation
      // treats create_item column values as "created with" not "changed to,"
      // so it stays silent and we end up with a bare parent. We create the
      // item without Project Type, then flip it in a separate mutation
      // below to actually fire the automation.
      const columnValues: Record<string, unknown> = {
        // Client dropdown — Monday will reuse an existing label of this name
        // or create one if it doesn't exist (create_labels_if_missing: true).
        [ALL_PROJECTS_COLUMNS.client]: { labels: [b.business_name] },
      };

      if (amUser) {
        columnValues[ALL_PROJECTS_COLUMNS.amBd] = {
          personsAndTeams: [{ id: Number(amUser.id), kind: "person" }],
        };
        columnValues[ALL_PROJECTS_COLUMNS.primaryName] = amUser.name;
        if (amUser.email) columnValues[ALL_PROJECTS_COLUMNS.primaryEmail] = amUser.email;
        if (amUser.phone) columnValues[ALL_PROJECTS_COLUMNS.primaryPhone] = amUser.phone;
      }

      if (effectiveDropboxUrl) {
        columnValues[ALL_PROJECTS_COLUMNS.dbParentFolder] = {
          url: effectiveDropboxUrl,
          text: "Dropbox folder",
        };
      }

      const parent = await createAllProjectsParent({
        boardId: allProjectsBoardId,
        itemName: `${b.business_name} | Video Assets`,
        groupId: ALL_PROJECTS_INTAKE_GROUP_ID,
        columnValues,
      });

      // Set Project Type in a separate mutation so any "when column
      // changes" automations get a chance to fire. Falls under the same
      // syncWarnings umbrella so a hiccup surfaces in the toast rather
      // than silently.
      try {
        await updateAllProjectsColumns({
          boardId: allProjectsBoardId,
          itemId: parent.id,
          columnValues: {
            [ALL_PROJECTS_PROJECT_TYPE_COLUMN]: { index: PROJECT_TYPE_VIDEO_ASSETS_INDEX },
          },
        });
      } catch (projTypeErr) {
        syncWarnings.push(
          `Set Project Type on All Projects failed: ${(projTypeErr as Error).message}`
        );
      }

      // Create the 7 standard Video Assets sub-items ourselves rather than
      // relying on Monday's per-client automation.
      try {
        const subResult = await createVideoAssetsSubitems(parent.id);
        if (subResult.failed > 0) {
          syncWarnings.push(
            `${subResult.failed} of ${subResult.created + subResult.failed} sub-items failed to create`
          );
        }
      } catch (subErr) {
        syncWarnings.push(`Sub-item creation failed: ${(subErr as Error).message}`);
      }

      // Post an update on the parent tagging Rendi with the project details.
      const description = buildSubitemDescription({
        brandName: b.business_name,
        shareUrl,
        pdfUrl: b.brand_guideline_pdf_url,
        dropboxUrl: effectiveDropboxUrl,
      });
      const tag = defaultEditorId ? `Hi ${mention(defaultEditorId, DEFAULT_EDITOR_NAME)} — ` : "";
      try {
        await postUpdate({
          itemId: parent.id,
          body: `${tag}Brand approved and ready to start video assets.\n\n${description}`,
        });
      } catch (updateErr) {
        syncWarnings.push(`Couldn't post update: ${(updateErr as Error).message}`);
      }

      // Derive the canonical Monday URL for the new parent item so the
      // editor's "Monday client board" field auto-fills.
      const clientBoardUrl = `${MONDAY_BOARD_BASE_URL}/boards/${allProjectsBoardId}/pulses/${parent.id}`;
      await supabase
        .from("brands")
        .update({
          monday_all_projects_item_id: parent.id,
          client_monday_board_url: clientBoardUrl,
        })
        .eq("id", id);
    } catch (e) {
      syncWarnings.push(`All Projects sync failed: ${(e as Error).message}`);
    }
  }

  // 5) Flip status to approved + log it.
  const { error: updErr } = await supabase
    .from("brands")
    .update({
      status: "approved",
      approved_at: new Date().toISOString(),
      approved_by: user?.id,
    })
    .eq("id", id);
  if (updErr) return { ok: false as const, error: updErr.message };

  await supabase.from("brand_activity_log").insert({
    brand_id: id,
    event_type: "approved",
    user_id: user?.id,
    metadata: { sync_warnings: syncWarnings.length > 0 ? syncWarnings : undefined },
  });

  // If any sync warnings landed, alert the team — the toast in the UI is
  // ephemeral, but these need somebody to chase down.
  if (syncWarnings.length > 0) {
    alertError({
      flow: "approve.sync_warnings",
      brandId: id,
      brandName: b.business_name,
      error: `${syncWarnings.length} sync warning(s)`,
      extras: { warnings: syncWarnings.join(" | ") },
    });
  }

  revalidatePath(`/brand/${id}`);
  revalidatePath(`/share/${b.share_token}`);
  revalidatePath("/dashboard");

  return { ok: true as const, warnings: syncWarnings };
}

/**
 * Request a NEW Video Assets project for an already-approved brand. Unlike
 * approveBrand (which is idempotent and skips All Projects creation when the
 * brand already has an item or is flagged "external"), this action ALWAYS
 * creates a fresh parent item on the All Projects board with Project Type
 * = Video Assets. The user's existing Monday automation then spawns the
 * sub-items.
 *
 * Use when: a client has been approved + had their initial video assets
 * delivered, and now we need a new round of assets (Q2 push, refresh, etc.).
 *
 * Side effects:
 *   - Creates a new parent item on the All Projects board
 *   - Posts an intro update with @editor mention + brand context
 *   - Logs a `video_assets_requested` activity log row with the new item ID
 *   - Does NOT update brand.monday_all_projects_item_id (preserves whatever
 *     was there — typically "external" for imported brands, or the original
 *     item ID for net-new ones)
 */
export type VideoAssetsRequestInput = {
  /** Free-text brief — goal, deliverables, deadlines, notes. Optional. */
  brief?: string;
  /** Style direction + reference links / example URLs. Optional. */
  styleNotes?: string;
};

export async function requestVideoAssetsProject(
  id: string,
  input: VideoAssetsRequestInput = {}
) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const allProjectsBoardId = process.env.MONDAY_BOARD_ID_ALL_PROJECTS;
  const defaultEditorId = process.env.MONDAY_DEFAULT_EDITOR_USER_ID;
  if (!allProjectsBoardId || !process.env.MONDAY_API_TOKEN) {
    return { ok: false as const, error: "Monday isn't configured on this deployment" };
  }

  const { data: brandRow, error: fetchErr } = await supabase
    .from("brands")
    .select("*")
    .eq("id", id)
    .single();
  if (fetchErr || !brandRow) {
    return { ok: false as const, error: fetchErr?.message ?? "Brand not found" };
  }
  const b = brandRow as Brand;
  if (b.status !== "approved") {
    return {
      ok: false as const,
      error: "Brand must be approved before requesting new video assets.",
    };
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const shareUrl = `${appUrl}/share/${b.share_token}`;

  // Look up the AM so we can populate the AM/BD person column + contact
  // info on the new All Projects item. Falls back gracefully if no AM set
  // or the name doesn't match a Monday user.
  let amUser: { id: string; name: string; email: string | null; phone: string | null } | null = null;
  if (b.account_manager?.trim()) {
    try {
      amUser = await findUserByName(b.account_manager);
    } catch {
      // Don't fail the whole request just because AM lookup hiccupped.
    }
  }

  // IMPORTANT: Project Type is deliberately NOT set at item creation.
  // Monday's "when Project Type changes to Video Assets → create sub-items"
  // automation only fires on an actual column value CHANGE — setting the
  // value inside the initial create_item mutation is treated as "created
  // with that value," not as a change, so the sub-item automation stays
  // silent and the AM ends up with a bare parent item.
  //
  // We create the item without Project Type first, then flip it in a
  // separate change_multiple_column_values mutation below to actually fire
  // the automation.
  const columnValues: Record<string, unknown> = {
    [ALL_PROJECTS_COLUMNS.client]: { labels: [b.business_name] },
  };
  if (amUser) {
    columnValues[ALL_PROJECTS_COLUMNS.amBd] = {
      personsAndTeams: [{ id: Number(amUser.id), kind: "person" }],
    };
    columnValues[ALL_PROJECTS_COLUMNS.primaryName] = amUser.name;
    if (amUser.email) columnValues[ALL_PROJECTS_COLUMNS.primaryEmail] = amUser.email;
    if (amUser.phone) columnValues[ALL_PROJECTS_COLUMNS.primaryPhone] = amUser.phone;
  }
  if (b.dropbox_folder_url) {
    columnValues[ALL_PROJECTS_COLUMNS.dbParentFolder] = {
      url: b.dropbox_folder_url,
      text: "Dropbox folder",
    };
  }

  // Suffix the item name with the year + a short sequence so repeat requests
  // are visually distinct on Monday ("Bertram | Video Assets 2026", then
  // "Bertram | Video Assets 2026 #2" if requested again the same year).
  const year = new Date().getUTCFullYear();
  const baseName = `${b.business_name} | Video Assets ${year}`;
  const { data: priorRequests } = await supabase
    .from("brand_activity_log")
    .select("created_at")
    .eq("brand_id", id)
    .eq("event_type", "video_assets_requested")
    .gte("created_at", `${year}-01-01`)
    .lt("created_at", `${year + 1}-01-01`);
  const sequenceSuffix =
    priorRequests && priorRequests.length > 0 ? ` #${priorRequests.length + 1}` : "";
  const itemName = `${baseName}${sequenceSuffix}`;

  let mondayItemId: string;
  let mondayItemUrl: string;
  try {
    const parent = await createAllProjectsParent({
      boardId: allProjectsBoardId,
      itemName,
      groupId: ALL_PROJECTS_INTAKE_GROUP_ID,
      columnValues,
    });
    mondayItemId = parent.id;
    mondayItemUrl = `${MONDAY_BOARD_BASE_URL}/boards/${allProjectsBoardId}/pulses/${parent.id}`;

    // Now set Project Type in a separate mutation so any "when column
    // changes" automations that depend on it get a chance to fire. If this
    // fails, the item still exists — the editor can set the column manually.
    try {
      await updateAllProjectsColumns({
        boardId: allProjectsBoardId,
        itemId: mondayItemId,
        columnValues: {
          [ALL_PROJECTS_PROJECT_TYPE_COLUMN]: { index: PROJECT_TYPE_VIDEO_ASSETS_INDEX },
        },
      });
    } catch (projTypeErr) {
      console.error(
        `[request_video_assets] setting Project Type failed on ${mondayItemId}: ${(projTypeErr as Error).message}`
      );
    }

    // Create the 7 standard Video Assets sub-items ourselves rather than
    // relying on Monday's per-client automation (which requires a
    // pre-existing Creative Assets Kit template item per client — a fragile
    // setup that leaves new brands like Vollmer with no sub-items).
    try {
      const subResult = await createVideoAssetsSubitems(mondayItemId);
      if (subResult.failed > 0) {
        console.error(
          `[request_video_assets] ${subResult.failed} of ${subResult.created + subResult.failed} sub-items failed on ${mondayItemId}`
        );
      }
    } catch (subErr) {
      console.error(
        `[request_video_assets] createVideoAssetsSubitems threw on ${mondayItemId}: ${(subErr as Error).message}`
      );
    }
  } catch (e) {
    alertError({
      flow: "request_video_assets.create_item",
      brandId: id,
      brandName: b.business_name,
      error: e,
    });
    return {
      ok: false as const,
      error: `Couldn't create the Monday item: ${(e as Error).message}`,
    };
  }

  // Compose the intro update body. If the caller supplied a brief or style
  // notes, prepend them with clear headings so the editor sees the AM's
  // direction before the standard brand context block.
  const brief = input.brief?.trim();
  const styleNotes = input.styleNotes?.trim();

  // Best-effort intro update — failure here doesn't undo the item creation.
  try {
    const description = buildSubitemDescription({
      brandName: b.business_name,
      shareUrl,
      pdfUrl: b.brand_guideline_pdf_url,
      dropboxUrl: b.dropbox_folder_url,
    });
    const tag = defaultEditorId ? `Hi ${mention(defaultEditorId, DEFAULT_EDITOR_NAME)} — ` : "";

    // Monday's create_update body renders newlines as line breaks. HTML tags
    // like <b> also work for basic formatting.
    const briefSection = brief ? `\n\n<b>📌 Brief</b>\n${brief}` : "";
    const styleSection = styleNotes ? `\n\n<b>🎨 Style & references</b>\n${styleNotes}` : "";

    await postUpdate({
      itemId: mondayItemId,
      body: `${tag}New round of video assets requested for ${b.business_name}.${briefSection}${styleSection}\n\n${description}`,
    });
  } catch (e) {
    // Log but don't fail — the item exists, the editor can manually @mention.
    console.error(`[request_video_assets] post update failed: ${(e as Error).message}`);
  }

  await supabase.from("brand_activity_log").insert({
    brand_id: id,
    event_type: "video_assets_requested",
    user_id: user?.id,
    metadata: {
      monday_item_id: mondayItemId,
      monday_item_url: mondayItemUrl,
      item_name: itemName,
      brief: brief || null,
      style_notes: styleNotes || null,
    },
  });

  revalidatePath(`/brand/${id}`);
  return { ok: true as const, mondayItemUrl, itemName };
}

export async function deleteBrand(id: string) {
  const supabase = createSupabaseServerClient();

  // Capture references BEFORE we delete the row so we can attempt cleanup
  // of the side-effect resources (storage objects, Monday items, Dropbox
  // folder). These cleanups are best-effort — Brand Hub is the system of
  // record, so if Monday/Dropbox cleanup fails we still proceed with the
  // DB delete and log a warning to the activity log.
  const { data: brandRow } = await supabase
    .from("brands")
    .select("id, business_name, monday_intake_item_id, monday_all_projects_item_id, dropbox_folder_url, brand_guideline_pdf_url")
    .eq("id", id)
    .single();

  // Strip storage objects under this brand's prefix. brand_logos rows cascade
  // on delete, but the underlying files in brand-logos/ and brand-pdfs/
  // storage do NOT — they'd leak forever otherwise.
  try {
    const logoList = await supabase.storage.from("brand-logos").list(id);
    if (logoList.data && logoList.data.length > 0) {
      const paths = logoList.data.map((f) => `${id}/${f.name}`);
      await supabase.storage.from("brand-logos").remove(paths);
    }
  } catch {
    // Non-fatal; storage leak isn't worth blocking the user delete.
  }
  try {
    const pdfList = await supabase.storage.from("brand-pdfs").list(id);
    if (pdfList.data && pdfList.data.length > 0) {
      const paths = pdfList.data.map((f) => `${id}/${f.name}`);
      await supabase.storage.from("brand-pdfs").remove(paths);
    }
  } catch {}

  // Capture the existing external references so the AM can chase them down
  // manually if needed. We do NOT auto-delete the Monday items or Dropbox
  // folder — those may have been picked up by other workflows (e.g. Rendi
  // already started editing) and silently deleting them would be hostile.
  const orphans: Record<string, string | null> = {};
  if (brandRow?.monday_intake_item_id) {
    orphans.monday_intake_item_id = brandRow.monday_intake_item_id;
  }
  if (
    brandRow?.monday_all_projects_item_id &&
    brandRow.monday_all_projects_item_id !== "external"
  ) {
    orphans.monday_all_projects_item_id = brandRow.monday_all_projects_item_id;
  }
  if (brandRow?.dropbox_folder_url) {
    orphans.dropbox_folder_url = brandRow.dropbox_folder_url;
  }

  // Activity log entry BEFORE we delete the brand row, since the FK cascades.
  // We can't insert with a brand_id that's about to vanish, so we use a
  // best-effort sentinel by leaving brand_id pointing at the soon-to-die row
  // — Supabase's cascade fires AFTER the insert returns. If that ordering
  // were ever to flip, we'd just lose the audit row, which is acceptable
  // for a delete action.
  if (Object.keys(orphans).length > 0) {
    await supabase.from("brand_activity_log").insert({
      brand_id: id,
      event_type: "deleted_with_external_references",
      metadata: { business_name: brandRow?.business_name, orphans },
    });
  }

  await supabase.from("brands").delete().eq("id", id);
  redirect("/dashboard");
}
