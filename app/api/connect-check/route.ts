// GET /api/connect-check
//
// For a signed-in team member: is the connector key (HUB_CONNECT_TOKEN) set,
// and does it look well-formed? Says nothing about the key itself beyond its
// length and shape, so a paste mistake can be spotted without revealing it.

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/auth/domain";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isEmailAllowed(user.email)) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const raw = process.env.HUB_CONNECT_TOKEN ?? "";
  const key = raw.trim();
  return NextResponse.json({
    set: raw.length > 0,
    length: key.length,
    looksLikeTheGeneratedKey: /^[0-9a-f]{64}$/.test(key), // 64 characters, 0-9 and a-f
    hasSpacesOrLineBreaksInside: /\s/.test(key),
    hadSpaceOrLineBreakAtTheEnds: raw !== key,
    startsWithBearer: /^bearer\s/i.test(key),
    onlyPlainCharacters: /^[\x21-\x7e]*$/.test(key),
    longEnoughToBeAccepted: key.length >= 24,
  });
}
