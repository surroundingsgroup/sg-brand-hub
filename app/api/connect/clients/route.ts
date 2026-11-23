// GET /api/connect/clients[?q=name]   the clients an outside assistant may work on

import { NextResponse } from "next/server";
import { connectorAuthorized } from "@/lib/connect/auth";
import { readSaved } from "@/lib/connect/saved";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!connectorAuthorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().toLowerCase();
  const { data, error } = await createSupabaseAdminClient()
    .from("brands")
    .select("id, business_name, vertical, account_manager, engagement_type, industry_update")
    .neq("engagement_type", "inactive")
    .order("business_name");
  if (error) return NextResponse.json({ error: "could not read clients" }, { status: 500 });
  const clients = (data ?? [])
    .filter((b) => !q || String(b.business_name ?? "").toLowerCase().includes(q))
    .map((b) => ({
      id: b.id,
      name: b.business_name,
      vertical: b.vertical ? String(b.vertical).replace(/_/g, " ") : null,
      account_manager: b.account_manager ?? null,
      lifecycle: b.engagement_type ?? null,
      saved_count: readSaved(b.industry_update).length,
    }));
  return NextResponse.json({ clients });
}
