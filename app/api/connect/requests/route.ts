// GET /api/connect/requests?status=open
// The open-request inbox across all clients. Muse polls this on a schedule,
// fulfills each request, and marks it done. status=open (default) | done | all.

import { NextResponse } from "next/server";
import { connectorAuthorized } from "@/lib/connect/auth";
import { readRequests } from "@/lib/connect/requests";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!connectorAuthorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const status = (new URL(request.url).searchParams.get("status") ?? "open").toLowerCase();
  const { data, error } = await createSupabaseAdminClient()
    .from("brands")
    .select("id, business_name, vertical, industry_update")
    .neq("engagement_type", "inactive");
  if (error) return NextResponse.json({ error: "could not read requests" }, { status: 500 });

  const requests = (data ?? []).flatMap((b) =>
    readRequests(b.industry_update)
      .filter((r) => status === "all" || r.status === status)
      .map((r) => ({
        clientId: b.id,
        clientName: b.business_name,
        vertical: b.vertical ? String(b.vertical).replace(/_/g, " ") : null,
        requestId: r.id,
        ask: r.ask,
        kinds: r.kinds,
        requested_by: r.requested_by,
        status: r.status,
        created_at: r.created_at,
        // Where to mark it done when fulfilled.
        done_path: `/api/connect/clients/${b.id}/requests/${r.id}/done`,
      })),
  );
  // Oldest first, so Muse works them in the order asked.
  requests.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  return NextResponse.json({ requests });
}
