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

export async function saveBrandScope(brandId: string, scope: BrandScope) {
  const supabase = createSupabaseServerClient();

  // Prior pool link, so we can keep the link reciprocal on the partner.
  const { data: priorRow } = await supabase.from("brands").select("scope").eq("id", brandId).maybeSingle();
  const priorPool = ((priorRow?.scope as BrandScope | null)?.pool_with ?? null) as string | null;

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

  revalidatePath(`/client/${brandId}`);
  revalidatePath(`/brand/${brandId}`);
  return { ok: true as const };
}
