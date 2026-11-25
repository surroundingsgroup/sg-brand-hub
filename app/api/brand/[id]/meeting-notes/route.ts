// Meeting notes — list + create endpoints.
//
// GET  /api/brand/[id]/meeting-notes     → recent meetings for this brand
// POST /api/brand/[id]/meeting-notes     → create a new meeting notes row
//
// The analyzer at /analyze is read-only; this route is where the AM
// explicitly saves the structured output (with any hand-edits) back.
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { addActionItemsToTodos } from "@/lib/meetings/todos";

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
    todosAdded = await addActionItemsToTodos(params.id, row.action_items_us, user.user.email ?? null, data.id);
  } catch (e) {
    console.error("[meeting-notes.POST] todos failed:", (e as Error).message);
  }

  return NextResponse.json({ id: data.id, todos_added: todosAdded });
}
