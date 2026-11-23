// GET /api/my/chat-check
//
// A yes/no check for whoever is signed in: can the workspace read Google Chat
// on their behalf yet? It asks the Brief Tool (which holds the Google access)
// and passes back only whether it worked and Google's error text if not.
// Used to see which Google admin switches are still off before a chat widget.

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/auth/domain";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isEmailAllowed(user.email)) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const base = (process.env.BRIEF_TOOL_URL ?? "https://briefs.surroundingsgroup.com").replace(/\/$/, "");
  const token = process.env.HUB_BRIEF_API_TOKEN;
  if (!token) return NextResponse.json({ ok: false, error: "no_token" });
  const url = new URL("/api/chat-check", base);
  url.searchParams.set("email", (user.email ?? "").toLowerCase());
  try {
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const json = (await res.json().catch(() => null)) as {
      ok?: boolean;
      conversations?: number;
      error?: string;
      project?: string | null;
      clientId?: string | null;
      newChats?: string | true;
      directory?: string | number;
    } | null;
    return NextResponse.json({
      ok: !!json?.ok,
      conversations: json?.conversations ?? null,
      error: json?.error ?? (res.ok ? null : `HTTP ${res.status}`),
      // Which Google Cloud project and service account entry the admin edits.
      project: json?.project ?? null,
      clientId: json?.clientId ?? null,
      // true when brand-new chats are allowed, else Google's reason.
      newChats: json?.newChats ?? null,
      // How many people the company directory returned, else Google's reason.
      directory: json?.directory ?? null,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message.slice(0, 160) });
  }
}
