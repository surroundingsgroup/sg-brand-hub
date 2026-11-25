// /api/brand/[id]/todos — the client page's To-dos tile.
//   GET    the client's to-dos (meeting, recurring, typed-in), its SocialDesk
//          notebook items, the team (owner picker) and the monthly schedule.
//          Makes the coming month's recurring to-dos first.
//   POST   { text, owner_email?, due_date? }        add one (lands on that
//          person's My Surroundings too)
//   PATCH  { id, done } | { id, clear: true }       tick / untick / clear
//          { notebook_id, done }                    tick a SocialDesk item
//          { schedule: { calendar_day, report, owner_email } }
// Any signed-in team member can work a client's list.

import { NextResponse } from "next/server";
import { createSupabaseServerClient, currentUser } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isEmailAllowed } from "@/lib/auth/domain";
import {
  DEFAULT_SCHEDULE,
  clientNotebook,
  emailForName,
  ensureRecurring,
  insertTodos,
  listClientTodos,
  parseSchedule,
  prefixFor,
  setNotebookDone,
  teamDirectory,
  type TodoSchedule,
} from "@/lib/todos/client-todos";

export const dynamic = "force-dynamic";

async function context(brandId: string) {
  const supabase = createSupabaseServerClient();
  const user = await currentUser(supabase);
  const email = user?.email ?? null;
  if (!email || !isEmailAllowed(email)) return null;
  const admin = createSupabaseAdminClient();
  const { data: brand } = await admin.from("brands").select("*").eq("id", brandId).maybeSingle();
  if (!brand) return { email, brand: null };
  return { email, brand: brand as Record<string, unknown> };
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await context(params.id);
  if (!ctx) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!ctx.brand) return NextResponse.json({ error: "Client not found." }, { status: 404 });
  const b = ctx.brand;
  const client = String(b.business_name ?? "");
  const [team, notebook] = await Promise.all([teamDirectory(), clientNotebook(client)]);
  const amEmail = emailForName(team, (b.account_manager as string | null) ?? (b.am as string | null));
  const saved = parseSchedule(b.todo_schedule);
  // Clients with a SocialDesk calendar get the monthly ones unless turned off.
  const schedule: TodoSchedule | null = saved ?? (notebook.found ? DEFAULT_SCHEDULE : null);
  const contactFirst = String(b.submitter_name ?? "").trim().split(/\s+/)[0] || null;
  if (schedule) await ensureRecurring({ brandId: params.id, client, contactFirst, schedule, ownerEmail: amEmail }).catch(() => 0);
  const { ready, todos } = await listClientTodos(params.id, client, team);
  return NextResponse.json({
    ready,
    me: ctx.email,
    todos,
    notebook,
    schedule: schedule ?? { calendar_day: null, report: null, owner_email: null },
    scheduleSaved: !!saved,
    social: notebook.found,
    amEmail,
    team,
  });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await context(params.id);
  if (!ctx) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!ctx.brand) return NextResponse.json({ error: "Client not found." }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { text?: unknown; owner_email?: unknown; due_date?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.replace(/\s+/g, " ").trim() : "";
  if (!text) return NextResponse.json({ error: "Type something first." }, { status: 400 });
  const owner = typeof body?.owner_email === "string" && body.owner_email.includes("@") ? body.owner_email.toLowerCase() : ctx.email;
  const due = typeof body?.due_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.due_date) ? body.due_date : null;
  const client = String(ctx.brand.business_name ?? "");
  try {
    await insertTodos([{ owner_email: owner, text: `${prefixFor(client)}${text}`, brand_id: params.id, due_date: due, source: "manual" }]);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const ctx = await context(params.id);
  if (!ctx) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!ctx.brand) return NextResponse.json({ error: "Client not found." }, { status: 404 });
  const client = String(ctx.brand.business_name ?? "");
  const body = (await req.json().catch(() => null)) as {
    id?: unknown;
    done?: unknown;
    clear?: unknown;
    notebook_id?: unknown;
    schedule?: unknown;
  } | null;
  const admin = createSupabaseAdminClient();

  if (body?.schedule && typeof body.schedule === "object") {
    const s = parseSchedule(body.schedule) ?? { calendar_day: null, report: null, owner_email: null };
    const { error } = await admin.from("brands").update({ todo_schedule: s }).eq("id", params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, schedule: s });
  }

  if (typeof body?.notebook_id === "string" && typeof body.done === "boolean") {
    const ok = await setNotebookDone(client, body.notebook_id, body.done);
    return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "SocialDesk didn't take that." }, { status: 502 });
  }

  const id = typeof body?.id === "string" && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : null;
  if (!id) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  // Only this client's rows (by tag, or by text before the migration).
  const { data: row } = await admin.from("my_todos").select("*").eq("id", id).maybeSingle();
  const r = row as Record<string, unknown> | null;
  if (!r || (r.brand_id ? r.brand_id !== params.id : !String(r.text ?? "").startsWith(prefixFor(client)))) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (body?.clear === true) {
    // A recurring one is closed rather than deleted, so it is not made again.
    const { error } =
      r.source === "recurring"
        ? await admin.from("my_todos").update({ done: true, done_at: new Date().toISOString() }).eq("id", id)
        : await admin.from("my_todos").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  if (typeof body?.done !== "boolean") return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const { error } = await admin
    .from("my_todos")
    .update({ done: body.done, done_at: body.done ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
