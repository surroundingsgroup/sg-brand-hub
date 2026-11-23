// GET /api/connect
//
// What this API is and how to use it, for the assistant connecting to it.
// Like every route under /api/connect it needs the bearer token.

import { NextResponse } from "next/server";
import { connectorAuthorized } from "@/lib/connect/auth";
import { SAVED_KINDS } from "@/lib/connect/saved";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!connectorAuthorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const base = `${new URL(request.url).origin}/api/connect`;
  return NextResponse.json({
    name: "Surroundings client hub",
    about:
      "Surroundings Group's internal client hub. Use it to read a client's brand context and to save inspiration, competitor moves, industry news and strategy ideas onto that client's page for the team.",
    auth: "Send the token on every request as: Authorization: Bearer <token>",
    endpoints: [
      { method: "GET", path: `${base}/clients`, does: "List clients (id, name, vertical, account manager). Optional ?q= filters by name." },
      { method: "GET", path: `${base}/clients/{id}`, does: "One client's brand context (voice, audience, look and feel, social handles) and everything already saved for it." },
      {
        method: "POST",
        path: `${base}/clients/{id}/saved`,
        does: "Save one or more items onto the client's page.",
        body: { items: [{ kind: SAVED_KINDS.join(" | "), title: "required, up to 160 characters", note: "optional, up to 1200 characters", url: "optional http(s) link", source: "optional, where it came from" }] },
      },
      { method: "DELETE", path: `${base}/clients/{id}/saved?item={itemId}`, does: "Remove one saved item." },
    ],
    notes: ["Up to 25 items per save.", "Write plain text only. No em dashes."],
  });
}
