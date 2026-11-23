// POST /api/my/case-study
//
// A signed-in team member submits a case study from My Surroundings. It is
// filed on the Monday "Shout Outs & Showcases" board as a showcase piece.

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/auth/domain";
import { findMondayPerson } from "@/lib/monday/deal-intake";
import { submitCaseStudy } from "@/lib/monday/case-study";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const line = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const block = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim().slice(0, max) : "");

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isEmailAllowed(user.email)) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const client = line(body?.client, 120);
  const title = line(body?.title, 140);
  const story = block(body?.story, 4000);
  const why = block(body?.why, 2000);
  const link = line(body?.link, 500);
  if (!client) return NextResponse.json({ error: "Add the client." }, { status: 400 });
  if (!title) return NextResponse.json({ error: "Give it a title." }, { status: 400 });
  if (story.length < 20) return NextResponse.json({ error: "Say a little more about what we did." }, { status: 400 });
  if (link && !/^https?:\/\/\S+\.\S+/i.test(link)) return NextResponse.json({ error: "That link does not look right. It should start with https://" }, { status: 400 });

  // Who is sending it: their name on Monday, else their profile, else the start of their address.
  const email = (user.email ?? "").toLowerCase();
  const person = await findMondayPerson(email).catch(() => null);
  let submittedBy = person?.name ?? "";
  if (!submittedBy) {
    const { data } = await supabase.from("team_profiles").select("name").eq("email", email).maybeSingle();
    submittedBy = data?.name?.trim() || email.split("@")[0];
  }

  try {
    const made = await submitCaseStudy({ client, title, story, why, link, submittedBy });
    return NextResponse.json({ ok: true, url: made.url });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
