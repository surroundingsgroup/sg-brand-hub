// POST /api/scope-draft   { brandId }
//
// Reads the newest agreement on the client's Monday All Accounts row and
// returns a drafted scope for the Scope form. Saves nothing: the account
// manager checks the draft in the form and presses Save.
//
// Signed-in team members only (this path sits behind the team sign-in; the
// check below is a second lock).

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/auth/domain";
import { draftScopeFor } from "@/lib/scope/agreement";
import type { BoardBrand } from "@/lib/scope/board-sync";

export const dynamic = "force-dynamic";
// Reading a multi-page agreement takes up to a minute or two.
export const maxDuration = 300;

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isEmailAllowed(user.email)) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { brandId?: string } | null;
  const brandId = body?.brandId?.trim();
  if (!brandId) return NextResponse.json({ ok: false, error: "No client given" }, { status: 400 });

  const { data: brand } = await supabase
    .from("brands")
    .select("id, business_name, monday_board_id, scope")
    .eq("id", brandId)
    .maybeSingle();
  if (!brand) return NextResponse.json({ ok: false, error: "Client not found" }, { status: 404 });

  try {
    const result = await draftScopeFor(brand as BoardBrand);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
