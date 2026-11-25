// PATCH /api/brand/[id]/meeting-notes/[meetingId] — save edits to a meeting
// (notes, recap, action items, follow-up email). Action items that are new or
// reworded since the last save go onto their owners' To-dos; unchanged ones
// are already there, so nothing doubles.
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { addActionItemsToTodos } from "@/lib/meetings/todos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PatchBody = {
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

export async function PATCH(req: NextRequest, { params }: { params: { id: string; meetingId: string } }) {
  const supabase = createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data: before } = await admin
    .from("meeting_notes")
    .select("id, action_items_us")
    .eq("id", params.meetingId)
    .eq("brand_id", params.id)
    .maybeSingle();
  if (!before) return NextResponse.json({ error: "Meeting not found." }, { status: 404 });

  const patch: Record<string, unknown> = {};
  if (typeof body.meeting_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.meeting_date)) patch.meeting_date = body.meeting_date;
  if (typeof body.raw_notes === "string") patch.raw_notes = body.raw_notes;
  if (typeof body.summary === "string") patch.summary = body.summary;
  if (Array.isArray(body.action_items_us)) patch.action_items_us = body.action_items_us;
  if (Array.isArray(body.action_items_them)) patch.action_items_them = body.action_items_them;
  if (typeof body.followup_email_subject === "string") patch.followup_email_subject = body.followup_email_subject;
  if (typeof body.followup_email_body === "string") patch.followup_email_body = body.followup_email_body;
  if (typeof body.next_meeting_focus === "string") patch.next_meeting_focus = body.next_meeting_focus;
  if (body.analyzed_at !== undefined) patch.analyzed_at = body.analyzed_at;

  const { error } = await admin.from("meeting_notes").update(patch).eq("id", params.meetingId).eq("brand_id", params.id);
  if (error) {
    console.error("[meeting-notes.PATCH] update error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let todosAdded = 0;
  if (Array.isArray(body.action_items_us)) {
    const task = (i: unknown) => (i && typeof i === "object" ? String((i as { task?: unknown }).task ?? "").trim() : "");
    const had = new Set(((before.action_items_us as unknown[]) ?? []).map(task));
    const added = (body.action_items_us as unknown[]).filter((i) => task(i) && !had.has(task(i)));
    try {
      todosAdded = await addActionItemsToTodos(params.id, added, auth.user.email ?? null, params.meetingId);
    } catch (e) {
      console.error("[meeting-notes.PATCH] todos failed:", (e as Error).message);
    }
  }
  return NextResponse.json({ ok: true, todos_added: todosAdded });
}
