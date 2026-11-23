// POST /api/my/pto/decide  { itemId, decision: "approve" | "decline", note? }
//
// Approve or decline a time-off request from Surroundings (the To-dos card and
// the Time off page). The signed-in person is matched to their Monday account
// here, never taken from the request, and has to be the request's approver
// (or Billy or Justin).

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/access";
import { findMondayPerson } from "@/lib/monday/deal-intake";
import { decidePtoRequest } from "@/lib/monday/pto";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const viewer = await getViewer(supabase);
  if (!viewer.email) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { itemId?: unknown; decision?: unknown; note?: unknown } | null;
  const itemId = typeof body?.itemId === "string" ? body.itemId : "";
  const decision = body?.decision === "approve" || body?.decision === "decline" ? body.decision : null;
  if (!/^\d+$/.test(itemId) || !decision) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const person = await findMondayPerson(viewer.email).catch(() => null);
  if (!person) return NextResponse.json({ error: "Your Monday account could not be found." }, { status: 403 });
  try {
    const out = await decidePtoRequest({
      itemId,
      decision,
      deciderMondayId: person.id,
      deciderName: viewer.name ?? person.name,
      isAdmin: viewer.everyone,
      note: typeof body?.note === "string" ? body.note : undefined,
    });
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
