// GET /api/client-meetings?brand=<client name>
//
// The raw calendar result behind a client's Meetings card, for checking.
// Signed-in team members only.

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/auth/domain";
import { fetchClientMeetings } from "@/lib/meetings/calendar";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isEmailAllowed(user.email)) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const brand = new URL(request.url).searchParams.get("brand")?.trim();
  if (!brand) return NextResponse.json({ error: "missing brand" }, { status: 400 });
  return NextResponse.json(await fetchClientMeetings(brand, { fresh: true }));
}
