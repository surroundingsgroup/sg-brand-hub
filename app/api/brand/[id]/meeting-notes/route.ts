// Meeting notes — list + create endpoints.
//
// GET  /api/brand/[id]/meeting-notes     → recent meetings for this brand
// POST /api/brand/[id]/meeting-notes     → create a new meeting notes row
//
// The analyzer at /analyze is read-only; this route is where the AM
// explicitly saves the structured output (with any hand-edits) back.
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateBody = {
  meeting_type?: string;
  meeting_title?: string;
  meeting_date?: string;
  raw_notes?: string;
  summary?: string;
  action_items_us?: unknown;
  action_items_them?: unknown;
  followup_email_subject?: string;
  followup_email_body?: string;
  next_meeting_focus?: string;
  analyzed_at?: string | null;
};

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("meeting_notes")
    .select(
      "id, meeting_type, meeting_title, meeting_date, summary, analyzed_at, created_at, created_by"
    )
    .eq("brand_id", params.id)
    .order("meeting_date", { ascending: false })
    .limit(20);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ meetings: data ?? [] });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const row = {
    brand_id: params.id,
    meeting_type: (body.meeting_type ?? "other").slice(0, 60),
    meeting_title: body.meeting_title?.slice(0, 200) ?? null,
    meeting_date: body.meeting_date || new Date().toISOString().slice(0, 10),
    raw_notes: body.raw_notes ?? null,
    summary: body.summary ?? null,
    action_items_us: Array.isArray(body.action_items_us) ? body.action_items_us : [],
    action_items_them: Array.isArray(body.action_items_them) ? body.action_items_them : [],
    followup_email_subject: body.followup_email_subject ?? null,
    followup_email_body: body.followup_email_body ?? null,
    next_meeting_focus: body.next_meeting_focus ?? null,
    analyzed_at: body.analyzed_at ?? null,
    created_by: user.user.id,
  };

  const { data, error } = await supabase
    .from("meeting_notes")
    .insert(row)
    .select("id")
    .single();

  if (error) {
    console.error("[meeting-notes.POST] insert error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Our action items go onto each owner's To-dos (My Surroundings). Owners are
  // matched to the team by name; an item with no owner (or someone not on the
  // team) goes to whoever saved the meeting. Client items stay on the meeting
  // and in the follow-up email. Best-effort: the meeting is already saved.
  let todosAdded = 0;
  try {
    todosAdded = await addActionItemsToTodos(params.id, row.action_items_us, user.user.email ?? null);
  } catch (e) {
    console.error("[meeting-notes.POST] todos failed:", (e as Error).message);
  }

  return NextResponse.json({ id: data.id, todos_added: todosAdded });
}

async function addActionItemsToTodos(brandId: string, items: unknown[], saverEmail: string | null): Promise<number> {
  const list = (items as { task?: unknown; owner?: unknown; due?: unknown }[]).filter((i) => typeof i?.task === "string" && i.task.trim());
  if (!list.length) return 0;
  const admin = createSupabaseAdminClient();
  const [{ data: brand }, { data: team }] = await Promise.all([
    admin.from("brands").select("business_name").eq("id", brandId).single(),
    admin.from("team_profiles").select("email, name"),
  ]);
  const client = (brand?.business_name as string | undefined) ?? "Client";
  const people = ((team ?? []) as { email: string; name: string | null }[]).filter((p) => p.email && p.name);
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, "").trim();
  const emailFor = (owner: unknown): string | null => {
    const o = typeof owner === "string" ? norm(owner) : "";
    if (!o) return saverEmail;
    const exact = people.find((p) => norm(p.name!) === o);
    const first = people.filter((p) => norm(p.name!).split(" ")[0] === o.split(" ")[0]);
    return (exact ?? (first.length === 1 ? first[0] : null))?.email ?? saverEmail;
  };

  const rows = list
    .map((i) => {
      const owner_email = emailFor(i.owner);
      const due = typeof i.due === "string" && i.due.trim() ? ` (${i.due.trim()})` : "";
      const text = `${client}: ${String(i.task).trim()}${due}`.slice(0, 300);
      return owner_email ? { owner_email: owner_email.toLowerCase(), text } : null;
    })
    .filter((r): r is { owner_email: string; text: string } => r !== null);
  if (!rows.length) return 0;

  // Saving the same meeting twice must not double anyone's list.
  const { data: open } = await admin
    .from("my_todos")
    .select("owner_email, text")
    .in("owner_email", [...new Set(rows.map((r) => r.owner_email))])
    .eq("done", false);
  const have = new Set(((open ?? []) as { owner_email: string; text: string }[]).map((t) => `${t.owner_email.toLowerCase()}|${t.text}`));
  const fresh = rows.filter((r) => !have.has(`${r.owner_email}|${r.text}`));
  if (!fresh.length) return 0;
  const { error } = await admin.from("my_todos").insert(fresh);
  if (error) throw new Error(error.message);
  return fresh.length;
}
