"use server";
// Save the scope blob for a brand. Called from the Scope form on the
// client profile page. Writes brands.scope (JSONB) via the signed-in
// user's Supabase session so RLS + the activity log pick it up like
// every other brand edit.
//
// Deliberately narrow — no sanitization beyond strict typing; AMs
// control the form and the data is internal-only.

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { BrandScope } from "@/lib/scope/types";
import { syncAccountsBoard } from "@/lib/scope/board-sync";
import { pushQuotas } from "@/lib/socialdesk/quotas";

// What the Scope tile shows after a save, about the Monday All Accounts board.
export type BoardSyncNote = { ok: boolean; text: string };

export async function saveBrandScope(brandId: string, incoming: BrandScope) {
  const supabase = createSupabaseServerClient();

  // Prior pool link, so we can keep the link reciprocal on the partner.
  const { data: priorRow } = await supabase.from("brands").select("scope").eq("id", brandId).maybeSingle();
  const prior = (priorRow?.scope as BrandScope | null) ?? null;
  const priorPool = (prior?.pool_with ?? null) as string | null;
  // The form does not carry the link to this client's row on the All Accounts
  // board (the app sets it); keep it across saves.
  // Same for the client's SocialDesk name, when it differs from the name here.
  //
  // A draft read from a new agreement waits on the client until the account
  // manager saves it. The form marks a save made from the draft by carrying
  // that agreement's id; only then is the draft cleared. Any other save
  // leaves it waiting.
  const { pending_draft: _formCopy, ...typed } = incoming;
  void _formCopy;
  const waiting = prior?.pending_draft;
  const confirmed = !!waiting && typed.agreement_asset_id === waiting.asset_id;
  const scope: BrandScope = {
    ...typed,
    ...(prior?.monday_account_item_id && !typed.monday_account_item_id ? { monday_account_item_id: prior.monday_account_item_id } : {}),
    ...(prior?.socialdesk_client && !typed.socialdesk_client ? { socialdesk_client: prior.socialdesk_client } : {}),
    ...(prior?.agreement_asset_id && !typed.agreement_asset_id ? { agreement_asset_id: prior.agreement_asset_id } : {}),
    ...(waiting && !confirmed ? { pending_draft: waiting } : {}),
  };

  const { error } = await supabase
    .from("brands")
    .update({ scope })
    .eq("id", brandId);
  if (error) return { ok: false as const, error: error.message };

  // Shared shoot pool is a two-way link: point the partner back at this brand,
  // and unlink a previous partner if the link changed. Best-effort.
  const nextPool = scope.pool_with ?? null;
  try {
    if (nextPool && nextPool !== brandId) {
      const { data: p } = await supabase.from("brands").select("scope").eq("id", nextPool).maybeSingle();
      const ps = ((p?.scope as BrandScope | null) ?? {}) as BrandScope;
      if (ps.pool_with !== brandId) {
        await supabase.from("brands").update({ scope: { ...ps, pool_with: brandId } }).eq("id", nextPool);
        revalidatePath(`/client/${nextPool}`);
      }
    }
    if (priorPool && priorPool !== nextPool) {
      const { data: p } = await supabase.from("brands").select("scope").eq("id", priorPool).maybeSingle();
      const ps = (p?.scope as BrandScope | null) ?? null;
      if (ps?.pool_with === brandId) {
        const { pool_with: _drop, ...rest } = ps;
        void _drop;
        await supabase.from("brands").update({ scope: rest }).eq("id", priorPool);
        revalidatePath(`/client/${priorPool}`);
      }
    }
  } catch {
    /* the scope itself saved; the reciprocal link can be set from the partner */
  }

  await supabase.from("brand_activity_log").insert({
    brand_id: brandId,
    event_type: "edited",
    metadata: { fields: ["scope"] },
  });

  // Copy the contract dates onto the Monday All Accounts board. The scope is
  // already saved; if Monday is unreachable the morning run catches it up.
  let board: BoardSyncNote | null = null;
  try {
    const report = await syncAccountsBoard(supabase, { brandId });
    const line = report.lines[0];
    if (line?.status === "updated") board = { ok: true, text: "All Accounts board updated." };
    else if (line?.status === "unchanged") board = { ok: true, text: "All Accounts board already matches." };
    else if (line?.status === "unmatched")
      board = { ok: false, text: "Could not find this client on the All Accounts board, so its dates were not updated there." };
    else if (line?.status === "error") board = { ok: false, text: "Saved here, but Monday did not take the dates. They will be sent again tomorrow morning." };
  } catch {
    board = { ok: false, text: "Saved here, but Monday could not be reached. The dates will be sent tomorrow morning." };
  }

  // Send the contract's monthly post minimums to SocialDesk (only when the
  // scope has numbers; never wipes what is there).
  try {
    const { data: named } = await supabase.from("brands").select("business_name").eq("id", brandId).maybeSingle();
    if (named?.business_name) {
      const q = await pushQuotas(scope.socialdesk_client || (named.business_name as string), scope);
      if (q.status === "sent") board = { ok: board?.ok ?? true, text: `${board?.text ?? ""} SocialDesk minimums updated.`.trim() };
      else if (q.status === "error") board = { ok: false, text: `${board?.text ?? ""} SocialDesk did not take the post minimums.`.trim() };
    }
  } catch {
    /* the scope is saved; SocialDesk can be re-sent from /api/socialdesk-sync */
  }

  revalidatePath(`/client/${brandId}`);
  revalidatePath(`/brand/${brandId}`);
  revalidatePath("/accounts");
  return { ok: true as const, board, draftCleared: confirmed };
}

// Set a drafted scope aside without using it (the agreement was not the one
// to work from, or the scope was already entered by hand). The file is then
// treated as seen, so it is not drafted again.
export async function dismissScopeDraft(brandId: string) {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase.from("brands").select("scope").eq("id", brandId).maybeSingle();
  const current = ((data?.scope as BrandScope | null) ?? {}) as BrandScope;
  const waiting = current.pending_draft;
  if (!waiting) return { ok: true as const };
  const { pending_draft: _drop, ...rest } = current;
  void _drop;
  const { error } = await supabase
    .from("brands")
    .update({ scope: { ...rest, agreement_asset_id: waiting.asset_id } })
    .eq("id", brandId);
  if (error) return { ok: false as const, error: error.message };
  revalidatePath(`/client/${brandId}`);
  return { ok: true as const };
}
