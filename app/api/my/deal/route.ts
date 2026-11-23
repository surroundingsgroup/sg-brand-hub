// POST /api/my/deal
//
// A signed-in team member adds a deal or a prospect from the widget on My
// Surroundings. A deal lands in Deal Intake on the Monday Deals board with its
// contact; a prospect lands in Prospect Intake on the Prospects board. Same
// rules as the website's Quick Add Deal form.

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/auth/domain";
import { addDeal, addProspect, findMondayPerson } from "@/lib/monday/deal-intake";
import { DEAL_BRANDS, DEAL_SOURCES, DEAL_VERTICALS } from "@/lib/monday/deal-options";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const pick = <T extends readonly string[]>(v: unknown, list: T): T[number] | null => (list as readonly string[]).includes(v as string) ? (v as T[number]) : null;
const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isEmailAllowed(user.email)) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const mode = body?.mode === "prospect" ? "prospect" : "deal";
  const company = clean(body?.company, 160);
  const what = clean(body?.what, 120);
  const contactName = clean(body?.contactName, 120);
  const title = clean(body?.title, 120);
  const email = clean(body?.email, 160).toLowerCase();
  const phone = clean(body?.phone, 40);
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 5000) : "";
  const source = pick(body?.source, DEAL_SOURCES);
  const vertical = pick(body?.vertical, DEAL_VERTICALS);

  if (!company) return NextResponse.json({ error: "Add the company." }, { status: 400 });
  if (!vertical) return NextResponse.json({ error: "Pick the vertical." }, { status: 400 });
  if (email && !isEmail(email)) return NextResponse.json({ error: "That email does not look right." }, { status: 400 });
  if (mode === "deal") {
    if (!contactName) return NextResponse.json({ error: "Add the contact's name." }, { status: 400 });
    if (!email) return NextResponse.json({ error: "Add an email for the contact." }, { status: 400 });
    if (!source) return NextResponse.json({ error: "Pick where the lead came from." }, { status: 400 });
  }

  // Who is adding it, as a person on Monday (BD/AM, and who added it).
  const owner = await findMondayPerson(user.email ?? "").catch(() => null);

  try {
    if (mode === "prospect") {
      const result = await addProspect({ company, vertical, name: contactName, title, email, phone, source, what, note, ownerMondayId: owner?.id ?? null });
      return NextResponse.json({ ok: true, mode, url: result.prospectUrl, ownerName: owner?.name ?? null });
    }
    const result = await addDeal({
      name: what ? `${company} | ${what}` : company,
      company,
      brand: DEAL_BRANDS[0], // one brand for every deal, as on the website form
      source: source as string,
      vertical,
      contact: { name: contactName, email, phone, title },
      note,
      ownerMondayId: owner?.id ?? null,
    });
    return NextResponse.json({
      ok: true,
      mode,
      url: result.dealUrl,
      contactWasOnFile: result.contactWasOnFile,
      needsPhone: result.needsPhone,
      ownerName: owner?.name ?? null,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
