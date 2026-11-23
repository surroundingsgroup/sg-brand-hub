// POST /api/my/deal/scan  { images: ["data:image/...;base64,...", ...] }
//
// A signed-in team member hands over a photo of a business card or a
// screenshot; the contact details come back to fill the New deal form.
// Nothing is saved here and the image is not kept.

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/auth/domain";
import { readCard } from "@/lib/monday/card-reader";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isEmailAllowed(user.email)) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { images?: unknown } | null;
  const images = (Array.isArray(body?.images) ? body.images : []).filter((v): v is string => typeof v === "string" && v.startsWith("data:image/")).slice(0, 2);
  if (!images.length) return NextResponse.json({ error: "No image was received." }, { status: 400 });

  try {
    return NextResponse.json({ ok: true, card: await readCard(images) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message.slice(0, 200) }, { status: 502 });
  }
}
