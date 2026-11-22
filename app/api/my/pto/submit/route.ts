// Submit a Hub-native PTO request. Writes a new item onto the Monday
// PTO board so Operations' existing approval workflow still works —
// the Hub becomes the UI, Monday stays the system of record.

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchAllTeamMembers } from "@/lib/monday/teams";
import { submitPtoRequest } from "@/lib/monday/pto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  type?: string;
  start_date?: string;
  end_date?: string;
  notes?: string;
};

function validDate(s: string | undefined): boolean {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + "T12:00:00").getTime());
}

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user?.email) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const email = user.user.email.toLowerCase();

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const type = body.type?.toString().trim();
  const startDate = body.start_date?.toString().trim();
  const endDate = body.end_date?.toString().trim() || startDate;
  const notes = body.notes?.toString() ?? "";

  if (!type) {
    return NextResponse.json({ error: "Pick a PTO type." }, { status: 400 });
  }
  if (!validDate(startDate) || !validDate(endDate)) {
    return NextResponse.json({ error: "Dates are invalid." }, { status: 400 });
  }
  if (endDate! < startDate!) {
    return NextResponse.json(
      { error: "End date can't be before start date." },
      { status: 400 }
    );
  }

  // Look up the signed-in user's Monday ID + display name so the
  // "requestor" person column on Monday maps to a real account.
  let requestorMondayId: string | null = null;
  let requestorName = email.split("@")[0];
  try {
    const members = await fetchAllTeamMembers();
    const me = members.find((m) => m.email?.toLowerCase() === email);
    if (me) {
      requestorMondayId = me.id;
      requestorName = me.name;
    }
  } catch {
    // Non-fatal — the item still lands, just without the person column
    // populated.
  }

  try {
    const created = await submitPtoRequest({
      requestorMondayId,
      requestorName,
      requestorEmail: email,
      type,
      startDate: startDate!,
      endDate: endDate!,
      notes,
    });
    return NextResponse.json({ ok: true, ...created });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Submit failed.";
    console.error("[pto.submit] monday error:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
