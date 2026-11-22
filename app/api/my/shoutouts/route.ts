// Shoutouts & Showcases — writes to the Monday board (18203645701)
// via the same dynamic-schema approach as PTO. Reads come from the
// server component directly via lib/monday/shoutouts.
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchAllTeamMembers } from "@/lib/monday/teams";
import { submitShoutout } from "@/lib/monday/shoutouts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  to_name?: string | null;
  kind?: string;
  message?: string;
};

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user?.email) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const email = user.user.email.toLowerCase();

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const message = body.message?.toString().trim();
  if (!message) {
    return NextResponse.json({ error: "Write a shoutout first." }, { status: 400 });
  }
  const kind = body.kind?.toString().trim() || "Shoutout";
  const toName = body.to_name?.toString().trim() || null;

  // Resolve Monday IDs for from + to.
  let fromMondayId: string | null = null;
  let fromName = email.split("@")[0];
  let toMondayId: string | null = null;
  try {
    const members = await fetchAllTeamMembers();
    const me = members.find((m) => m.email?.toLowerCase() === email);
    if (me) {
      fromMondayId = me.id;
      fromName = me.name;
    }
    if (toName) {
      const match = members.find(
        (m) => m.name.trim().toLowerCase() === toName.toLowerCase()
      );
      if (match) toMondayId = match.id;
    }
  } catch {
    // Non-fatal.
  }

  try {
    const created = await submitShoutout({
      fromMondayId,
      fromName,
      toName,
      toMondayId,
      kind,
      message,
    });
    return NextResponse.json({ ok: true, ...created });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Submit failed.";
    console.error("[shoutouts.submit] monday error:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
