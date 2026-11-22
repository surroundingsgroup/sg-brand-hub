// Per-update endpoint — toggle pin or delete.
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    pinned?: boolean;
    title?: string;
    body?: string;
  };
  const patch: Record<string, unknown> = {};
  if (typeof body.pinned === "boolean") patch.pinned = body.pinned;
  if (typeof body.title === "string") patch.title = body.title.trim().slice(0, 200);
  if (typeof body.body === "string") patch.body = body.body.slice(0, 4000);
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }
  const { error } = await supabase
    .from("team_updates")
    .update(patch)
    .eq("id", params.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const { error } = await supabase
    .from("team_updates")
    .delete()
    .eq("id", params.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
