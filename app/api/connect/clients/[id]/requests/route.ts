// POST /api/connect/clients/{id}/requests
// Leave a request for Muse on this client ("find X"). SocialDesk calls this.
// Body: { ask (required), kinds?: ("inspiration"|"competitor"|"news"|"strategy")[],
//         vertical?, requested_by? }

import { NextResponse } from "next/server";
import { connectorAuthorized } from "@/lib/connect/auth";
import { makeRequest, addRequest } from "@/lib/connect/requests";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  if (!connectorAuthorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const made = makeRequest(body);
  if ("error" in made) return NextResponse.json({ error: made.error }, { status: 400 });
  const list = await addRequest(createSupabaseAdminClient(), params.id, made);
  if (!list) return NextResponse.json({ error: "client not found" }, { status: 404 });
  return NextResponse.json({ request: made, open: list.filter((r) => r.status === "open").length });
}
