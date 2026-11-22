// Team events + meetings. One feed covers both recurring and one-off.
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS = ["meeting", "all_hands", "event", "offsite", "holiday", "other"] as const;

export async function GET() {
  const supabase = createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  // Upcoming + anything in the last 14 days (for reference).
  const horizon = new Date(Date.now() - 14 * 86400 * 1000).toISOString();
  const { data, error } = await supabase
    .from("team_events")
    .select("*")
    .gte("starts_at", horizon)
    .order("starts_at", { ascending: true })
    .limit(100);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ events: data ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user?.email) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    kind?: string;
    starts_at?: string;
    ends_at?: string;
    location?: string;
    notes?: string;
  };
  const title = body.title?.toString().trim();
  const starts = body.starts_at?.toString().trim();
  if (!title || !starts) {
    return NextResponse.json(
      { error: "Title and start time are required." },
      { status: 400 }
    );
  }
  const startsDate = new Date(starts);
  if (isNaN(startsDate.getTime())) {
    return NextResponse.json({ error: "Invalid start time." }, { status: 400 });
  }
  const kind = (KINDS as readonly string[]).includes(body.kind ?? "")
    ? body.kind
    : "meeting";
  const endsDate = body.ends_at ? new Date(body.ends_at) : null;
  const email = user.user.email.toLowerCase();
  const { data: profile } = await supabase
    .from("team_profiles")
    .select("name")
    .eq("email", email)
    .maybeSingle();

  const { data, error } = await supabase
    .from("team_events")
    .insert({
      title: title.slice(0, 200),
      kind,
      starts_at: startsDate.toISOString(),
      ends_at: endsDate && !isNaN(endsDate.getTime()) ? endsDate.toISOString() : null,
      location: body.location?.toString().slice(0, 200) || null,
      notes: body.notes?.toString().slice(0, 2000) || null,
      created_by_email: email,
      created_by_name: profile?.name ?? email.split("@")[0],
    })
    .select("id")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ id: data.id });
}
