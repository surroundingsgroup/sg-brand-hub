// POST /api/my/chat/upload  { name, type, size }
//
// A place to put one file that is about to be sent in a chat message. The
// browser uploads straight to our storage with the one-time link this returns
// (so the file can be far bigger than a normal request allows), then the
// message is sent through /api/my/chat, which hands the file to Google and
// deletes it from storage. The bucket is private and each person can only
// send what is under their own folder.

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isEmailAllowed } from "@/lib/auth/domain";
import { CHAT_BUCKET, MAX_CHAT_FILE } from "@/lib/chat/client";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isEmailAllowed(user.email)) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { name?: unknown; size?: unknown } | null;
  const size = Number(body?.size);
  const name = typeof body?.name === "string" ? body.name : "file";
  if (!Number.isFinite(size) || size <= 0) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  if (size > MAX_CHAT_FILE) return NextResponse.json({ ok: false, error: "too_large" });

  const admin = createSupabaseAdminClient();
  // The bucket is made the first time anyone attaches a file.
  const made = await admin.storage.createBucket(CHAT_BUCKET, { public: false, fileSizeLimit: MAX_CHAT_FILE });
  if (made.error && !/exist/i.test(made.error.message)) return NextResponse.json({ ok: false, error: "Storage is not ready for attachments." });

  const safe = name.replace(/[^\w.\- ]+/g, "_").slice(-120) || "file";
  const path = `${user.id}/${randomUUID()}/${safe}`;
  const { data, error } = await admin.storage.from(CHAT_BUCKET).createSignedUploadUrl(path);
  if (error || !data?.token) return NextResponse.json({ ok: false, error: "Storage is not ready for attachments." });
  return NextResponse.json({ ok: true, bucket: CHAT_BUCKET, path, token: data.token });
}
