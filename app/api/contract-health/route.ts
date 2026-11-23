// GET /api/contract-health
//
// JSON feed of every scoped client's contract health, for the
// Brief Tool's morning email, Monday notifications and renewal calendar
// invites. Same rows as the /accounts page.
//
// Not behind the team sign-in (the caller is a server, not a person), so it
// is guarded by the bearer secret the two apps already share
// (HUB_BRIEF_API_TOKEN). Fails closed when that is not configured.

import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadAccountHealth } from "@/lib/scope/accounts";
import { syncAccountsBoard } from "@/lib/scope/board-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const expected = process.env.HUB_BRIEF_API_TOKEN;
  if (!expected) return false;
  const supplied = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const supabase = createSupabaseAdminClient();
    // ?syncBoard=1 (sent once each weekday morning): first copy the contract
    // dates onto the Monday All Accounts board, so a contract that renewed
    // overnight moves forward there too. Never blocks the feed.
    let boardSync: { updated: number; unchanged: number; unmatched: number; errors: number; changed: string[] } | null = null;
    if (new URL(request.url).searchParams.get("syncBoard") === "1") {
      try {
        const r = await syncAccountsBoard(supabase);
        boardSync = {
          updated: r.updated,
          unchanged: r.unchanged,
          unmatched: r.unmatched,
          errors: r.errors,
          changed: r.lines.filter((l) => l.status === "updated").map((l) => `${l.name}: ${(l.changes ?? []).join("; ")}`),
        };
      } catch (e) {
        boardSync = { updated: 0, unchanged: 0, unmatched: 0, errors: 1, changed: [(e as Error).message] };
      }
    }
    const health = await loadAccountHealth(supabase);
    const base = (process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, "");
    return NextResponse.json({
      generatedAt: health.generatedAt,
      accountsUrl: `${base}/accounts`,
      rows: health.rows.map((r) => ({ ...r, url: `${base}/client/${r.id}` })),
      missingScope: health.missingScope.length,
      boardSync,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
