// POST   /api/brand/{id}/saved            a team member saves a link or idea for the client
// DELETE /api/brand/{id}/saved?item={id}  ...or removes one
//
// Signed-in team members only (the connector has its own routes under
// /api/connect, guarded by a token).

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/auth/domain";
import { addSaved, makeSavedItem, removeSaved } from "@/lib/connect/saved";

export const dynamic = "force-dynamic";

async function signedIn() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user && isEmailAllowed(user.email) ? { supabase, user } : null;
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const who = await signedIn();
  if (!who) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const name = (who.user.user_metadata?.full_name as string | undefined) || (who.user.email ?? "").split("@")[0] || "Team";
  const made = makeSavedItem(body, name);
  if ("error" in made) return NextResponse.json({ error: made.error }, { status: 400 });
  const saved = await addSaved(who.supabase, params.id, [made]);
  if (!saved) return NextResponse.json({ error: "Could not save." }, { status: 500 });
  return NextResponse.json({ saved });
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const who = await signedIn();
  if (!who) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const itemId = new URL(request.url).searchParams.get("item")?.trim();
  if (!itemId) return NextResponse.json({ error: "Missing item." }, { status: 400 });
  const saved = await removeSaved(who.supabase, params.id, itemId);
  if (!saved) return NextResponse.json({ error: "Could not remove." }, { status: 500 });
  return NextResponse.json({ saved });
}
