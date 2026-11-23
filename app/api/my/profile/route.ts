// Your own team profile — read + upsert.
//
// GET  → the signed-in user's team_profiles row, creating it with
//        email + a name seeded from Monday on first call so the AM
//        doesn't have to type their own name twice.
// POST → upsert your own row. RLS enforces that you can only edit
//        the row where email = your JWT email.
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { findAmByEmail, fetchAllTeamMembers } from "@/lib/monday/teams";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PatchBody = {
  name?: string | null;
  title?: string | null;
  department?: string | null;
  employment_type?: string | null;
  phone?: string | null;
  slack_handle?: string | null;
  time_zone?: string | null;
  location?: string | null;
  birthday?: string | null;
  start_date?: string | null;
  bio?: string | null;
  fun_fact?: string | null;
  skills?: string[] | null;
  avatar_url?: string | null;
  manager_email?: string | null;
};

async function seedNameFromMonday(email: string): Promise<string | null> {
  try {
    const am = await findAmByEmail(email);
    if (am?.name) return am.name;
    const all = await fetchAllTeamMembers();
    return all.find((m) => m.email?.toLowerCase() === email.toLowerCase())?.name ?? null;
  } catch {
    return null;
  }
}

export async function GET() {
  const supabase = createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user?.email) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const email = user.user.email.toLowerCase();

  const { data: existing } = await supabase
    .from("team_profiles")
    .select("*")
    .eq("email", email)
    .maybeSingle();

  if (existing) return NextResponse.json({ profile: existing });

  // First time — create a shell row seeded with name from Monday.
  const seedName = await seedNameFromMonday(email);
  const { data: inserted, error } = await supabase
    .from("team_profiles")
    .insert({ email, name: seedName })
    .select("*")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ profile: inserted });
}

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user?.email) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const email = user.user.email.toLowerCase();

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const empType =
    body.employment_type === "full_time" ||
    body.employment_type === "contractor" ||
    body.employment_type === "part_time" ||
    body.employment_type === "other"
      ? body.employment_type
      : null;

  const skills = Array.isArray(body.skills)
    ? body.skills
        .map((s) => (typeof s === "string" ? s.trim() : ""))
        .filter((s) => s.length > 0)
        .slice(0, 20)
    : null;

  const patch = {
    email,
    name: body.name?.toString().trim() || null,
    title: body.title?.toString().trim() || null,
    department: body.department?.toString().trim() || null,
    employment_type: empType,
    phone: body.phone?.toString().trim() || null,
    slack_handle: body.slack_handle?.toString().trim() || null,
    time_zone: body.time_zone?.toString().trim() || null,
    location: body.location?.toString().trim() || null,
    birthday: body.birthday?.toString().trim() || null,
    start_date: body.start_date?.toString().trim() || null,
    bio: body.bio?.toString().trim() || null,
    fun_fact: body.fun_fact?.toString().trim() || null,
    skills,
    avatar_url: body.avatar_url?.toString().trim() || null,
    manager_email: body.manager_email?.toString().toLowerCase().trim() || null,
  };

  const { data: existing } = await supabase
    .from("team_profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("team_profiles")
      .update(patch)
      .eq("id", existing.id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, id: existing.id });
  }

  const { data: inserted, error } = await supabase
    .from("team_profiles")
    .insert(patch)
    .select("id")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id: inserted.id });
}
