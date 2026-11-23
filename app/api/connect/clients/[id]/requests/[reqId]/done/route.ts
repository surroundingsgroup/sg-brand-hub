// POST /api/connect/clients/{id}/requests/{reqId}/done
// Muse marks a request fulfilled after it has saved the items. The request id is
// in the URL. Body (optional): { note?: string, result_count?: number }.
// To leave a request unfulfilled, simply don't call this — it stays open.
// On success it nudges the requester (Google Chat + email, best-effort).

import { NextResponse } from "next/server";
import { connectorAuthorized } from "@/lib/connect/auth";
import { completeRequest } from "@/lib/connect/requests";
import { notifyRequestFulfilled } from "@/lib/notifications/request-fulfilled";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: { id: string; reqId: string } }) {
  if (!connectorAuthorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { note?: string; result_count?: number };
  const admin = createSupabaseAdminClient();
  const updated = await completeRequest(admin, params.id, params.reqId, {
    note: body?.note,
    result_count: body?.result_count,
  });
  if (!updated) return NextResponse.json({ error: "request not found" }, { status: 404 });

  // Nudge the requester — best-effort, never blocks the done call.
  try {
    const { data: brand } = await admin.from("brands").select("business_name").eq("id", params.id).maybeSingle();
    await notifyRequestFulfilled({
      brandId: params.id,
      clientName: (brand?.business_name as string) || "a client",
      ask: updated.ask,
      requestedBy: updated.requested_by,
      resultCount: updated.result_count,
      note: updated.note,
    });
  } catch {
    /* notification is best-effort */
  }

  return NextResponse.json({ request: updated });
}
