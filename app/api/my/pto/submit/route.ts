// File a time-off request from Surroundings. It lands on the Monday "Time
// Off Request" board filled in the way that board's own form fills it, so the
// approval flow there carries on unchanged: the right manager is assigned, and
// on approval the hours go to the person's PTO board.

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { findMondayPerson } from "@/lib/monday/deal-intake";
import { fetchPtoTypes, HALF_DAY, submitPtoRequest, teamFor, weekdaysBetween } from "@/lib/monday/pto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Body = { type?: string; start_date?: string; end_date?: string; hours?: number | string; notes?: string };

const validDate = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(`${s}T12:00:00Z`).getTime());

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user?.email) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const email = user.user.email.toLowerCase();

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const startDate = body.start_date?.toString().trim();
  const endDate = body.end_date?.toString().trim() || startDate;
  if (!validDate(startDate) || !validDate(endDate)) return NextResponse.json({ error: "Pick the dates." }, { status: 400 });
  if (endDate < startDate) return NextResponse.json({ error: "The end date can't be before the start date." }, { status: 400 });

  const types = await fetchPtoTypes();
  const type = types.find((t) => t === body.type?.toString().trim());
  if (!type) return NextResponse.json({ error: "Pick the kind of time off." }, { status: 400 });

  const workdays = weekdaysBetween(startDate, endDate);
  if (workdays === 0) return NextResponse.json({ error: "Those dates are a weekend or a company holiday. Pick working days." }, { status: 400 });
  const hours = Math.round(Number(body.hours) * 100) / 100;
  if (!(hours > 0)) return NextResponse.json({ error: "Enter the hours you are asking for." }, { status: 400 });
  if (hours > workdays * 8) return NextResponse.json({ error: `That is more than ${workdays * 8} hours, the working time in those dates.` }, { status: 400 });
  if (HALF_DAY.test(type) && hours > 4 * workdays) return NextResponse.json({ error: "A half day is 4 hours. Pick Time off for a full day." }, { status: 400 });

  // Who is asking: their name and manager from their profile, their Monday account by email.
  const { data: profiles } = await supabase.from("team_profiles").select("email, name, manager_email");
  const rows = (profiles ?? []) as { email: string; name: string | null; manager_email: string | null }[];
  const me = rows.find((p) => p.email.toLowerCase() === email);
  const manager = me?.manager_email ? rows.find((p) => p.email.toLowerCase() === me.manager_email!.toLowerCase())?.name ?? null : null;
  let monday: { id: string; name: string } | null = null;
  try {
    monday = await findMondayPerson(email);
  } catch {
    monday = null;
  }
  const name = me?.name?.trim() || monday?.name || null;
  if (!name) return NextResponse.json({ error: "Add your name to your profile first, so the request is filed under it." }, { status: 400 });
  const route = teamFor(manager, name);
  // When the request has to go to someone other than the board's own pick, find that person's Monday account.
  let approverMondayId: string | null = null;
  if (route.overridden) {
    const approverEmail = rows.find((p) => (p.name ?? "").trim().toLowerCase() === route.approver.toLowerCase())?.email;
    try {
      approverMondayId = approverEmail ? (await findMondayPerson(approverEmail))?.id ?? null : null;
    } catch {
      approverMondayId = null;
    }
  }

  try {
    const created = await submitPtoRequest({
      requestorMondayId: monday?.id ?? null,
      requestorName: name,
      type,
      startDate,
      endDate,
      hours,
      team: route.team,
      notes: body.notes?.toString() ?? "",
      approverMondayId,
    });
    return NextResponse.json({ ok: true, ...created, approver: route.approver });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Submit failed.";
    console.error("[pto.submit] monday error:", msg);
    return NextResponse.json({ error: "Monday did not take the request. Try again in a moment." }, { status: 502 });
  }
}
