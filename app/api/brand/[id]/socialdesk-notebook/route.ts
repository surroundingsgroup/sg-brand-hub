// POST /api/brand/{id}/socialdesk-notebook  { text }
//
// "Add to SocialDesk notebook" on a meeting-note action item: puts a social
// media task on the client's SocialDesk notebook (To Produce, this month) for
// the SMM. Signed-in team only; SocialDesk checks the shared PROVISION_TOKEN.

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/auth/domain";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isEmailAllowed(user.email)) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { text?: string };
  const text = String(body.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "Nothing to add." }, { status: 400 });

  const { data: brand } = await supabase.from("brands").select("business_name").eq("id", params.id).single();
  if (!brand) return NextResponse.json({ error: "Client not found." }, { status: 404 });

  const token = process.env.SOCIALDESK_PROVISION_TOKEN;
  if (!token) return NextResponse.json({ error: "SocialDesk link is not set up." }, { status: 500 });
  const base = (process.env.SOCIALDESK_URL ?? "https://socialdesk-lac.vercel.app").replace(/\/$/, "");
  const author = (user.user_metadata?.full_name as string | undefined) || (user.email ?? "").split("@")[0];
  try {
    const res = await fetch(`${base}/api/hub-notebook`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ client_name: brand.business_name, text, author }),
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; url?: string; already?: boolean; error?: string };
    if (!res.ok || !data.ok) return NextResponse.json({ error: data.error || `SocialDesk answered ${res.status}` }, { status: 502 });
    return NextResponse.json({ ok: true, url: data.url, already: !!data.already });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
