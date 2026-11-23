// GET /api/socialdesk-sync          what each client's SocialDesk minimums would become (writes nothing)
// GET /api/socialdesk-sync?run=1    send the contract minimums to SocialDesk now
//
// Signed-in team members only. The same push happens by itself whenever a
// scope is saved; this is for the first load and for checking.

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { pushQuotas } from "@/lib/socialdesk/quotas";
import type { BrandScope } from "@/lib/scope/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const show = (q: Record<string, { inFeed?: number; stories?: number }>) =>
  Object.entries(q)
    .map(([n, v]) => `${n} ${v.inFeed ?? "-"}/${v.stories ?? "-"}`)
    .join(", ") || "(none)";

export async function GET(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const run = params.get("run") === "1";

  // ?list=1: every SocialDesk client and its minimums. ?clear=<exact name>:
  // wipe one client's minimums (to undo a wrong write).
  const sdBase = (process.env.SOCIALDESK_URL ?? "https://socialdesk-lac.vercel.app").replace(/\/$/, "");
  const sdAuth = { Authorization: `Bearer ${process.env.SOCIALDESK_HUB_API_TOKEN ?? ""}`, "Content-Type": "application/json" };
  // ?pulse=<client name>: the raw feed the client page's SocialDesk widget reads.
  const pulse = params.get("pulse");
  if (pulse) {
    const r = await fetch(`${sdBase}/api/hub-pulse?client_name=${encodeURIComponent(pulse)}`, { headers: sdAuth, cache: "no-store" });
    return NextResponse.json(await r.json().catch(() => ({ error: `HTTP ${r.status}` })), { status: r.status });
  }
  if (params.get("list") === "1") {
    const r = await fetch(`${sdBase}/api/hub-quotas`, { headers: sdAuth, cache: "no-store" });
    const j = (await r.json()) as { clients?: { name: string; quotas: Record<string, { inFeed?: number; stories?: number }> }[] };
    return NextResponse.json({ clients: (j.clients ?? []).map((c) => `${c.name}: ${show(c.quotas)}`) });
  }
  // ?rename=<exact SocialDesk name>&to=<new name>: give a SocialDesk client the shared name.
  const renameFrom = params.get("rename");
  const renameTo = params.get("to");
  if (renameFrom && renameTo) {
    const r = await fetch(`${sdBase}/api/hub-quotas`, { method: "POST", headers: sdAuth, body: JSON.stringify({ rename: { from: renameFrom, to: renameTo }, dry: !run }), cache: "no-store" });
    return NextResponse.json(await r.json());
  }
  const clear = params.get("clear");
  if (clear) {
    const r = await fetch(`${sdBase}/api/hub-quotas`, { method: "POST", headers: sdAuth, body: JSON.stringify({ client_name: clear, clear: true, dry: !run }), cache: "no-store" });
    return NextResponse.json(await r.json());
  }
  const { data, error } = await supabase.from("brands").select("business_name, scope").not("scope", "is", null).order("business_name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const lines: string[] = [];
  const tally: Record<string, number> = {};
  for (const b of data ?? []) {
    const sdName = (b.scope as BrandScope | null)?.socialdesk_client || (b.business_name as string);
    const r = await pushQuotas(sdName, b.scope as BrandScope, { dry: !run });
    tally[r.status] = (tally[r.status] ?? 0) + 1;
    if (r.status === "sent") lines.push(`${b.business_name} [SocialDesk client "${r.client}"]: ${show(r.previous)}  ->  ${show(r.quotas)}`);
    else if (r.status === "error" || r.status === "not in SocialDesk") lines.push(`${b.business_name}: ${r.status}${r.detail ? ` (${r.detail})` : ""}`);
  }
  return NextResponse.json({
    mode: run ? "ran" : "preview (nothing written; add ?run=1 to apply)",
    note: "in-feed/stories per month. 'sent' = would change (or changed); 'same' = already matches; 'no numbers' = the scope has no post minimums, SocialDesk left alone.",
    tally,
    lines,
  });
}
