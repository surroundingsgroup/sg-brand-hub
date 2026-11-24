// Same-client detection for brand records: an intake submitted for a client
// that already has a record (e.g. the team fills the brand intake after the
// deal closed and the Won build already made the client). Matching is the
// intake form's rule: the same name ignoring case and punctuation, or every
// word of the shorter name appearing in the longer one ("FIM" / "FIM Yachts").

import type { createSupabaseServerClient } from "@/lib/supabase/server";

export type BrandCandidate = {
  id: string;
  business_name: string;
  status: string;
  account_manager: string | null;
  engagement_type: string | null;
};

const tokens = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const norm = (s: string) => tokens(s).join("");

export function sameClient(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (norm(a) === norm(b)) return true;
  const ta = tokens(a), tb = tokens(b);
  if (!ta.length || !tb.length) return false;
  const [small, big] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return small.every((t) => big.includes(t));
}

/** Other brand records that look like the same client, exact-name matches first. */
export async function findDuplicateBrands(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  brand: { id: string; business_name: string }
): Promise<BrandCandidate[]> {
  const { data } = await supabase
    .from("brands")
    .select("id, business_name, status, account_manager, engagement_type")
    .neq("id", brand.id);
  const rows = ((data ?? []) as BrandCandidate[]).filter((r) => sameClient(r.business_name, brand.business_name));
  return rows.sort((x, y) => Number(norm(y.business_name) === norm(brand.business_name)) - Number(norm(x.business_name) === norm(brand.business_name)));
}
