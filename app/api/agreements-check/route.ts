// GET /api/agreements-check                 which clients have an agreement the scope has not been checked against (writes nothing)
// GET /api/agreements-check?seed=1&run=1    record today's files as "already on file", so only new uploads count from here on
// GET /api/agreements-check?draft=1&run=1   read the new ones now and leave drafts for the account managers
//
// Signed-in team members only. The draft pass also runs by itself each
// weekday morning (the Brief Tool calls /api/agreement-drafts), so this is
// for checking, not routine use.

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/auth/domain";
import { checkAgreements } from "@/lib/scope/agreement";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isEmailAllowed(user.email)) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const q = new URL(request.url).searchParams;
  const run = q.get("run") === "1";
  const mode = run && q.get("seed") === "1" ? "seed" : run && q.get("draft") === "1" ? "draft" : "look";
  try {
    const report = await checkAgreements(supabase, { mode, max: 3 });
    return NextResponse.json({ ...report, by: user.email });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
