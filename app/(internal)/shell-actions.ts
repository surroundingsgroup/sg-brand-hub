"use server";
// Data for the mobile shell (bottom tab bar). Loaded on demand — the client
// index is only fetched the first time someone opens Search on their phone.

import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ClientIndexRow = {
  id: string;
  name: string;
  am: string | null;
  engagement: string | null;
};

export async function listClientIndex(): Promise<ClientIndexRow[]> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from("brands")
    .select("id, business_name, account_manager, engagement_type, status")
    .neq("status", "archived")
    .order("business_name");
  return (data ?? []).map((b) => ({
    id: b.id as string,
    name: (b.business_name as string) ?? "Untitled",
    am: (b.account_manager as string | null) ?? null,
    engagement: (b.engagement_type as string | null) ?? null,
  }));
}
