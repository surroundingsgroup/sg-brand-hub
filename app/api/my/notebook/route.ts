// /api/my/notebook: the SocialDesk notebook "To Produce" items for the
// clients this person works (as the SMM, or the AM where there is no SMM),
// for the To-dos card on My Surroundings. PATCH ticks one in SocialDesk.

import { NextResponse } from "next/server";
import { createSupabaseServerClient, currentUser } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/auth/domain";
import { personNotebook, setNotebookDone } from "@/lib/todos/client-todos";

export const dynamic = "force-dynamic";

async function me() {
  const supabase = createSupabaseServerClient();
  const user = await currentUser(supabase);
  const email = user?.email ?? null;
  return email && isEmailAllowed(email) ? email : null;
}

export async function GET() {
  const email = await me();
  if (!email) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  return NextResponse.json({ tasks: await personNotebook(email) });
}

export async function PATCH(request: Request) {
  const email = await me();
  if (!email) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { client?: unknown; id?: unknown; done?: unknown } | null;
  if (typeof body?.client !== "string" || typeof body?.id !== "string" || typeof body?.done !== "boolean") {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const ok = await setNotebookDone(body.client, body.id, body.done);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "SocialDesk didn't take that." }, { status: 502 });
}
