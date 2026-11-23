// /api/my/chat: the signed-in person's own Google Chat, for the chat card.
//
//   GET                       recent conversations (?limit= for more)
//   GET  ?space=&read=1       latest messages in one (read=1 marks it read)
//   GET  ?people=1            who a chat can be started with: the company directory on
//                             Google when that is allowed, the team directory here otherwise
//   GET  ?media=<ref>&type=   a picture attached to a message
//   POST { space, text, uploads? }   send a message as yourself; uploads are files already
//                                    put in storage through /api/my/chat/upload
//   POST { start: [{ email, name }] }   open a chat with one person or several
//
// Whose chat it is comes from the session, never from the request.

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isEmailAllowed } from "@/lib/auth/domain";
import { findMondayPerson } from "@/lib/monday/deal-intake";
import {
  CHAT_BUCKET,
  MAX_CHAT_FILES,
  fetchConversations,
  fetchDirectory,
  fetchMedia,
  fetchMessages,
  fetchSpaces,
  postMessage,
  startChat,
  validSpace,
  type ChatPerson,
} from "@/lib/chat/client";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function signedIn(): Promise<{ email: string; id: string } | null> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = user?.email?.toLowerCase() ?? null;
  return user && email && isEmailAllowed(email) ? { email, id: user.id } : null;
}

export async function GET(request: Request) {
  const me = await signedIn();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const q = new URL(request.url).searchParams;

  const media = q.get("media");
  if (media) {
    const res = await fetchMedia(me.email, media.slice(0, 600), (q.get("type") ?? "").slice(0, 40));
    if (!res) return new NextResponse(null, { status: 404 });
    if (!res.ok || !res.body) return NextResponse.json({ error: (await res.text().catch(() => "")).slice(0, 300) || `HTTP ${res.status}` }, { status: res.status === 200 ? 502 : res.status });
    return new NextResponse(res.body, {
      headers: { "Content-Type": res.headers.get("content-type") ?? "image/jpeg", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" },
    });
  }

  const space = q.get("space");
  if (space) {
    if (!validSpace(space)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
    return NextResponse.json(await fetchMessages(me.email, space, q.get("read") === "1"));
  }
  if (q.get("spaces") === "1") return NextResponse.json(await fetchSpaces(me.email));

  if (q.get("people") === "1") {
    // Everyone in the organization, from Google. Until that is allowed, the
    // team directory kept here.
    const google = await fetchDirectory(me.email);
    if (google.ok && google.people.length) return NextResponse.json({ ok: true, people: google.people, everyone: true });
    const supabase = createSupabaseServerClient();
    const { data } = await supabase.from("team_profiles").select("name, email").order("name");
    const people: ChatPerson[] = (data ?? [])
      .filter((p) => p.email && p.email.toLowerCase() !== me.email)
      .map((p) => ({ name: (p.name ?? "").trim() || (p.email as string).split("@")[0], email: (p.email as string).toLowerCase() }));
    return NextResponse.json({ ok: true, people, everyone: false });
  }

  // Their own name tells a direct message apart from the person on the other side.
  const person = await findMondayPerson(me.email).catch(() => null);
  const limit = Math.min(60, Math.max(5, Number(q.get("limit")) || 14));
  return NextResponse.json(await fetchConversations(me.email, person?.name ?? "", limit));
}

export async function POST(request: Request) {
  const me = await signedIn();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { space?: unknown; text?: unknown; uploads?: unknown; start?: unknown } | null;

  // Open a chat with one person or several. Company addresses only.
  if (Array.isArray(body?.start)) {
    const others: ChatPerson[] = [];
    for (const raw of body.start.slice(0, 20) as { email?: unknown; name?: unknown }[]) {
      const email = typeof raw?.email === "string" ? raw.email.trim().toLowerCase() : "";
      if (!isEmailAllowed(email) || email === me.email || others.some((o) => o.email === email)) continue;
      others.push({ email, name: typeof raw?.name === "string" ? raw.name.replace(/\s+/g, " ").trim().slice(0, 80) : "" });
    }
    if (!others.length) return NextResponse.json({ error: "Pick someone to message." }, { status: 400 });
    return NextResponse.json(await startChat(me.email, others));
  }

  const space = typeof body?.space === "string" ? body.space : "";
  const text = typeof body?.text === "string" ? body.text.trim().slice(0, 4000) : "";
  const uploads = (Array.isArray(body?.uploads) ? body.uploads.slice(0, MAX_CHAT_FILES) : []) as { path?: unknown; name?: unknown; type?: unknown }[];
  if (!validSpace(space) || (!text && !uploads.length)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  if (!uploads.length) return NextResponse.json(await postMessage(me.email, space, text));

  // Files were put in our storage by this same person a moment ago. Hand
  // Google a short-lived link to each, then clear them out whatever happens.
  const admin = createSupabaseAdminClient();
  const paths: string[] = [];
  const files: { name: string; type: string; url: string }[] = [];
  for (const u of uploads) {
    const path = typeof u.path === "string" ? u.path : "";
    if (!path.startsWith(`${me.id}/`) || path.includes("..")) return NextResponse.json({ error: "Bad request." }, { status: 400 });
    const { data, error } = await admin.storage.from(CHAT_BUCKET).createSignedUrl(path, 300);
    if (error || !data?.signedUrl) return NextResponse.json({ ok: false, error: "The file could not be read back. Try attaching it again." });
    paths.push(path);
    files.push({ name: typeof u.name === "string" ? u.name.slice(0, 200) || "file" : "file", type: typeof u.type === "string" ? u.type.slice(0, 120) : "", url: data.signedUrl });
  }
  try {
    return NextResponse.json(await postMessage(me.email, space, text, files));
  } finally {
    await admin.storage.from(CHAT_BUCKET).remove(paths).catch(() => null);
  }
}
