// GET /api/connect/clients/{id}   one client's brand context, plus what is saved for it
//
// Brand and creative context only. Contracts, fees, contact details and
// internal notes are deliberately not part of this API.

import { NextResponse } from "next/server";
import { connectorAuthorized } from "@/lib/connect/auth";
import { readSaved } from "@/lib/connect/saved";
import { readRequests } from "@/lib/connect/requests";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const CONTEXT =
  "id, business_name, vertical, vertical_other, tagline, overview_polished, website, instagram, facebook, youtube, tiktok, linkedin, audience_gender, audience_age, audience_type, brand_voice, look_and_feel, what_to_avoid, inspiration_references, coloring_tone, music_mood, music_genre, account_manager, industry_update";

export async function GET(request: Request, { params }: { params: { id: string } }) {
  if (!connectorAuthorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: b, error } = await createSupabaseAdminClient().from("brands").select(CONTEXT).eq("id", params.id).maybeSingle();
  if (error || !b) return NextResponse.json({ error: "client not found" }, { status: 404 });
  const row = b as unknown as Record<string, unknown>;
  const { industry_update, ...context } = row;
  const notes = (industry_update as { items?: unknown } | null)?.items;
  return NextResponse.json({
    client: { ...context, name: row.business_name, vertical: row.vertical ? String(row.vertical).replace(/_/g, " ") : null },
    industry_notes: Array.isArray(notes) ? notes : [],
    saved: readSaved(industry_update),
    requests: readRequests(industry_update),
  });
}
