// POST /api/my/l10  { boardId, itemId, done, restore? }
//
// Tick one of your own L10 to-dos off from My Surroundings (or put it back).
// The signed-in person is matched to their Monday account here, never taken
// from the request, and the to-do has to have them on it.

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/auth/domain";
import { findMondayPerson } from "@/lib/monday/deal-intake";
import { setL10TodoDone } from "@/lib/monday/l10";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isEmailAllowed(user.email)) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { boardId?: unknown; itemId?: unknown; done?: unknown; restore?: unknown } | null;
  const boardId = typeof body?.boardId === "string" ? body.boardId : "";
  const itemId = typeof body?.itemId === "string" ? body.itemId : "";
  if (!/^\d+$/.test(boardId) || !/^\d+$/.test(itemId) || typeof body?.done !== "boolean") return NextResponse.json({ error: "Bad request." }, { status: 400 });

  const person = await findMondayPerson(user.email ?? "").catch(() => null);
  if (!person) return NextResponse.json({ error: "Your Monday account could not be found." }, { status: 403 });

  try {
    await setL10TodoDone({ mondayPersonId: person.id, boardId, itemId, done: body.done, restore: typeof body.restore === "string" ? body.restore.slice(0, 60) : null });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
