// POST   /api/connect/clients/{id}/saved            save items onto a client's page
// DELETE /api/connect/clients/{id}/saved?item={id}  remove one

import { NextResponse } from "next/server";
import { connectorAuthorized, connectorName } from "@/lib/connect/auth";
import { addSaved, makeSavedItem, removeSaved, type SavedItem } from "@/lib/connect/saved";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  if (!connectorAuthorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { items?: unknown } | null;
  const incoming = Array.isArray(body?.items) ? body!.items : body && typeof body === "object" && "title" in body ? [body] : [];
  if (!incoming.length) return NextResponse.json({ error: 'send { "items": [ { kind, title, note?, url?, source? } ] }' }, { status: 400 });
  if (incoming.length > 25) return NextResponse.json({ error: "at most 25 items per save" }, { status: 400 });
  const items: SavedItem[] = [];
  for (const [i, raw] of incoming.entries()) {
    const made = makeSavedItem(raw, connectorName());
    if ("error" in made) return NextResponse.json({ error: `item ${i + 1}: ${made.error}` }, { status: 400 });
    items.push(made);
  }
  const saved = await addSaved(createSupabaseAdminClient(), params.id, items);
  if (!saved) return NextResponse.json({ error: "client not found" }, { status: 404 });
  return NextResponse.json({ saved: items.length, items });
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  if (!connectorAuthorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const itemId = new URL(request.url).searchParams.get("item")?.trim();
  if (!itemId) return NextResponse.json({ error: "missing ?item=" }, { status: 400 });
  const saved = await removeSaved(createSupabaseAdminClient(), params.id, itemId);
  if (!saved) return NextResponse.json({ error: "client not found" }, { status: 404 });
  return NextResponse.json({ ok: true, remaining: saved.length });
}
