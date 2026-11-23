// GET /api/agreement-drafts          drafts waiting for an account manager, and new agreements not read yet
// GET /api/agreement-drafts?run=1    first read any newly uploaded agreements (up to three a run)
//
// Called by the Brief Tool's weekday-morning run, which tells each account
// manager which scopes are waiting for them. Not behind the team sign-in
// (the caller is a server), so it is guarded by the bearer secret the two
// apps already share (HUB_BRIEF_API_TOKEN). Fails closed without it.

import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { checkAgreements } from "@/lib/scope/agreement";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
    const run = new URL(request.url).searchParams.get("run") === "1";
    const report = await checkAgreements(createSupabaseAdminClient(), { mode: run ? "draft" : "look", max: 3 });
    const base = (process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, "");
    return NextResponse.json({
      ...report,
      lines: report.lines.map((l) => ({ ...l, url: `${base}/client/${l.brandId}` })),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
