// Set someone's manager from the org chart's inline edit.
//
// Writes bypass team_profiles RLS (which restricts each user to their
// own row) because reparenting is a team-wide action. We gate at the
// route: any signed-in user on an @surroundingsgroup.com email can
// reparent. Later we may tighten to leadership-only.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/auth/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  email?: string;
  manager_email?: string | null;
};

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user?.email || !isEmailAllowed(user.user.email)) {
    return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const email = body.email?.toString().toLowerCase().trim();
  if (!email) {
    return NextResponse.json({ error: "email required" }, { status: 400 });
  }
  const managerEmail =
    body.manager_email === null
      ? null
      : body.manager_email?.toString().toLowerCase().trim() || null;

  // Self-manager not allowed.
  if (managerEmail && managerEmail === email) {
    return NextResponse.json(
      { error: "Someone can't be their own manager." },
      { status: 400 }
    );
  }

  // Use the service role to bypass team_profiles RLS. The route-level
  // domain check above is the actual gate.
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) {
    return NextResponse.json({ error: "Not configured." }, { status: 503 });
  }
  const admin = createClient(supaUrl, supaKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Make sure the target row exists.
  const { data: target } = await admin
    .from("team_profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (!target) {
    return NextResponse.json({ error: "Profile not found." }, { status: 404 });
  }

  // Cycle check — walk up from the proposed manager; if we meet `email`
  // on the way to a root, the reparent would create a loop.
  if (managerEmail) {
    const visited = new Set<string>([email]);
    let cursor: string | null = managerEmail;
    while (cursor) {
      if (visited.has(cursor)) {
        return NextResponse.json(
          { error: "Would create a reporting loop." },
          { status: 400 }
        );
      }
      visited.add(cursor);
      const { data: up } = (await admin
        .from("team_profiles")
        .select("manager_email")
        .eq("email", cursor)
        .maybeSingle()) as { data: { manager_email: string | null } | null };
      cursor = up?.manager_email ?? null;
    }
  }

  const { error } = await admin
    .from("team_profiles")
    .update({ manager_email: managerEmail })
    .eq("id", target.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
