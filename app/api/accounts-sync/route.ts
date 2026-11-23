// GET /api/accounts-sync          what would change on the All Accounts board (writes nothing)
// GET /api/accounts-sync?run=1    do it now
//
// Signed-in team members only (this path sits behind the team sign-in; the
// check below is a second lock). The same sync runs by itself on every scope
// save and every weekday morning, so this is for checking, not routine use.

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { syncAccountsBoard } from "@/lib/scope/board-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const run = new URL(request.url).searchParams.get("run") === "1";
  try {
    const report = await syncAccountsBoard(supabase, { dry: !run });
    return NextResponse.json({
      mode: run ? "ran" : "preview (nothing written; add ?run=1 to apply)",
      checked: report.checked,
      updated: report.updated,
      unchanged: report.unchanged,
      unmatched: report.unmatched,
      errors: report.errors,
      lines: report.lines.filter((l) => l.status !== "unchanged"),
      by: user.email,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
