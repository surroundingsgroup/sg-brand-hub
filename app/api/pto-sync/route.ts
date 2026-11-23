// GET /api/pto-sync
//
// Writes everyone's PTO balance to the Monday "PTO Balances" board
// (lib/pto/monday-board.ts). Called every morning by the Brief tool's cron.
//
// Not behind the team sign-in (the caller is a server), so it is guarded by
// the bearer secret the two apps already share (HUB_BRIEF_API_TOKEN). Fails
// closed when that is not configured.

import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { syncPtoBoard } from "@/lib/pto/monday-board";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function authorized(request: Request): boolean {
  const expected = process.env.HUB_BRIEF_API_TOKEN;
  if (!expected) return false;
  const supplied = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const { data, error } = await createSupabaseAdminClient().from("team_profiles").select("email, name, manager_email, start_date");
    if (error) throw new Error(error.message);
    const result = await syncPtoBoard((data ?? []) as { email: string; name: string | null; manager_email: string | null; start_date: string | null }[]);
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
