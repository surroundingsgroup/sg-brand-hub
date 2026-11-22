// Team updates feed — team-wide announcements, policy changes, new
// hire notes, new email-signature drops. One row per update.
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PostBody = {
  title?: string;
  body?: string;
  kind?: string;
};

const KINDS = ["announcement", "policy", "signature", "new_hire", "process", "other"] as const;

async function creator(): Promise<{
  email: string | null;
  name: string | null;
}> {
  const supabase = createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  const email = user.user?.email ?? null;
  if (!email) return { email: null, name: null };
  const { data: profile } = await supabase
    .from("team_profiles")
    .select("name")
    .eq("email", email.toLowerCase())
    .maybeSingle();
  return { email, name: profile?.name ?? email.split("@")[0] };
}

export async function GET() {
  const supabase = createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const { data, error } = await supabase
    .from("team_updates")
    .select("*")
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ updates: data ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as PostBody;
  const title = body.title?.toString().trim();
  if (!title) {
    return NextResponse.json({ error: "Title is required." }, { status: 400 });
  }
  const kind = (KINDS as readonly string[]).includes(body.kind ?? "")
    ? body.kind
    : "announcement";
  const { email, name } = await creator();
  const { data, error } = await supabase
    .from("team_updates")
    .insert({
      title: title.slice(0, 200),
      body: body.body?.toString().slice(0, 4000) || null,
      kind,
      created_by_email: email,
      created_by_name: name,
    })
    .select("id")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ id: data.id });
}
