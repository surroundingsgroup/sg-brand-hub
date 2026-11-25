// POST /api/brand/[id]/meeting-notes/[meetingId]/items — check off, reopen,
// clear or restore one action item on a saved meeting.
//   { side: "us" | "them", index, task, action: "done" | "undone" | "clear" | "restore", item? }
// Our items stay in step with their To-dos in My Surroundings: done marks the
// To-do done, undone reopens it, clear removes the open To-do, restore puts
// the item (and its To-do) back.
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { addActionItemsToTodos, deleteItemTodos, setItemTodosDone } from "@/lib/meetings/todos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Item = Record<string, unknown> & { task?: string };

export async function POST(req: NextRequest, { params }: { params: { id: string; meetingId: string } }) {
  const supabase = createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    side?: string;
    index?: number;
    task?: string;
    action?: string;
    item?: Item;
  } | null;
  const side = body?.side === "them" ? "them" : body?.side === "us" ? "us" : null;
  const action = ["done", "undone", "clear", "restore"].includes(String(body?.action)) ? String(body?.action) : null;
  const task = typeof body?.task === "string" ? body.task.trim() : "";
  if (!side || !action || !task) return NextResponse.json({ error: "Bad request." }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const col = side === "us" ? "action_items_us" : "action_items_them";
  const [{ data: meeting }, { data: brand }] = await Promise.all([
    admin.from("meeting_notes").select(`id, ${col}`).eq("id", params.meetingId).eq("brand_id", params.id).maybeSingle(),
    admin.from("brands").select("business_name").eq("id", params.id).maybeSingle(),
  ]);
  if (!meeting) return NextResponse.json({ error: "Meeting not found." }, { status: 404 });
  const client = (brand?.business_name as string | undefined) ?? "Client";
  const list = [...((((meeting as Record<string, unknown>)[col] as Item[] | null) ?? []))];
  const index = typeof body?.index === "number" ? body.index : -1;

  if (action === "restore") {
    const item: Item = body?.item && typeof body.item === "object" ? { ...body.item, task } : { task };
    delete item.done;
    delete item.done_at;
    list.splice(Math.max(0, Math.min(index < 0 ? list.length : index, list.length)), 0, item);
  } else {
    const at = list[index] && String(list[index].task ?? "").trim() === task ? index : list.findIndex((i) => String(i.task ?? "").trim() === task);
    if (at < 0) return NextResponse.json({ error: "That item isn't on this meeting any more." }, { status: 404 });
    if (action === "clear") list.splice(at, 1);
    else list[at] = { ...list[at], done: action === "done", done_at: action === "done" ? new Date().toISOString() : null };
  }

  const { error } = await admin.from("meeting_notes").update({ [col]: list }).eq("id", params.meetingId).eq("brand_id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Our items: the matching To-dos follow. Best-effort; the meeting is saved.
  if (side === "us") {
    try {
      if (action === "done" || action === "undone") await setItemTodosDone(client, task, action === "done");
      else if (action === "clear") await deleteItemTodos(client, task);
      else if (action === "restore") await addActionItemsToTodos(params.id, [{ ...body?.item, task }], auth.user.email ?? null);
    } catch (e) {
      console.error("[meeting-notes.items] todo sync failed:", (e as Error).message);
    }
  }
  return NextResponse.json({ ok: true, items: list });
}
