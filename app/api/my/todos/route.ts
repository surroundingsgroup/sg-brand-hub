// /api/my/todos: the signed-in person's own to-do list (To-dos card on My
// Surroundings). GET lists, POST adds, PATCH ticks or unticks, DELETE removes.
// Runs as the signed-in person, and the table's own rule only lets anyone
// touch rows under their email.

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/auth/domain";
import { ensureRecurringForPerson, missingColumn } from "@/lib/todos/client-todos";

export const dynamic = "force-dynamic";

export type Todo = { id: string; text: string; done: boolean; done_at: string | null; created_at: string; due_date?: string | null; brand_id?: string | null; source?: string | null };

// The table is added by a one-time setup step; until then the card says so.
const missingTable = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "42P01" || e.code === "PGRST205" || /my_todos/.test(e.message ?? "") && /not exist|not find|schema cache/i.test(e.message ?? ""));

async function who() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = user?.email?.toLowerCase() ?? null;
  return { supabase, email: email && isEmailAllowed(email) ? email : null };
}

export async function GET() {
  const { supabase, email } = await who();
  if (!email) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  // The month's recurring client to-dos (calendar to the client, the report)
  // for the clients this person runs, so they show up here on their own.
  await ensureRecurringForPerson(email).catch(() => undefined);
  // Open items, plus what was ticked off in the last day so a slip can be undone.
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const query = (cols: string) =>
    supabase
      .from("my_todos")
      .select(cols)
      .eq("owner_email", email)
      .or(`done.eq.false,done_at.gte.${since}`)
      .order("done", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(80);
  let { data, error } = await query("id, text, done, done_at, created_at, due_date, brand_id, source");
  if (missingColumn(error)) ({ data, error } = await query("id, text, done, done_at, created_at"));
  if (missingTable(error)) return NextResponse.json({ ready: false, todos: [] });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ready: true, todos: (data ?? []) as unknown as Todo[] });
}

export async function POST(request: Request) {
  const { supabase, email } = await who();
  if (!email) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.replace(/\s+/g, " ").trim().slice(0, 300) : "";
  if (!text) return NextResponse.json({ error: "Type something first." }, { status: 400 });
  const { data, error } = await supabase.from("my_todos").insert({ owner_email: email, text }).select("id, text, done, done_at, created_at").single();
  if (missingTable(error)) return NextResponse.json({ error: "The list is not switched on yet." }, { status: 503 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, todo: data as Todo });
}

export async function PATCH(request: Request) {
  const { supabase, email } = await who();
  if (!email) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { id?: unknown; done?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  if (!/^[0-9a-f-]{36}$/i.test(id) || typeof body?.done !== "boolean") return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const { error } = await supabase
    .from("my_todos")
    .update({ done: body.done, done_at: body.done ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("owner_email", email);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const { supabase, email } = await who();
  if (!email) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const { error } = await supabase.from("my_todos").delete().eq("id", id).eq("owner_email", email);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
