// POST /api/briefs/update-invite  { brief_id }
//
// The "Update invite" button on the client page. Asks the Brief tool to
// re-send the shoot's calendar invite (current creators from Monday, AM,
// client contact, fresh description; everyone gets the update). Signed-in
// team members only; the Brief tool checks the shared HUB_BRIEF_API_TOKEN.

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/auth/domain";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isEmailAllowed(user.email)) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { brief_id?: string };
  const briefId = String(body.brief_id ?? "").trim();
  if (!briefId) return NextResponse.json({ error: "Missing brief." }, { status: 400 });

  const token = process.env.HUB_BRIEF_API_TOKEN;
  if (!token) return NextResponse.json({ error: "The Brief tool link is not set up." }, { status: 500 });
  const base = (process.env.BRIEF_TOOL_URL ?? "https://briefs.surroundingsgroup.com").replace(/\/$/, "");

  try {
    const res = await fetch(`${base}/api/hub/update-invite`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ brief_id: briefId }),
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; attendees?: string[] };
    if (!res.ok || !data.ok) return NextResponse.json({ error: data.error || `Brief tool answered ${res.status}` }, { status: 502 });
    return NextResponse.json({ ok: true, guests: data.attendees?.length ?? 0 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
