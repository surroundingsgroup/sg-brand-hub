// Surroundings -> SocialDesk: the contract's monthly post minimums.
//
// The scope on the client page is where "10 in-feed + 10 stories on Instagram"
// is recorded. This sends those numbers to SocialDesk (client.profile.quotas),
// so the calendar's quota pills, the notify-AM gate and Content Pacing all use
// the contract instead of a second, hand-typed copy.
//
// Only numbers the scope actually has are sent, and SocialDesk keeps every
// other number it already holds (a Facebook minimum that mirrors Instagram,
// for example). A scope with no numbers sends nothing at all.

import type { BrandScope } from "@/lib/scope/types";

type Quotas = Record<string, { inFeed?: number; stories?: number }>;

const base = () => (process.env.SOCIALDESK_URL ?? "https://socialdesk-lac.vercel.app").replace(/\/$/, "");

// Only these two have stories; a stories number on any other channel is a slip.
const HAS_STORIES = new Set(["Instagram", "Facebook"]);

export function quotasFromScope(scope: BrandScope | null | undefined): Quotas {
  const out: Quotas = {};
  for (const c of scope?.channels ?? []) {
    const row: { inFeed?: number; stories?: number } = {};
    if (typeof c.inFeed === "number") row.inFeed = c.inFeed;
    if (typeof c.stories === "number" && HAS_STORIES.has(c.name)) row.stories = c.stories;
    if (c.name && Object.keys(row).length) out[c.name] = row;
  }
  return out;
}

export type QuotaPush =
  | { status: "sent" | "same"; client: string; previous: Quotas; quotas: Quotas }
  | { status: "no numbers" | "not in SocialDesk" | "error"; detail?: string };

export async function pushQuotas(brandName: string, scope: BrandScope | null | undefined, opts: { dry?: boolean } = {}): Promise<QuotaPush> {
  const quotas = quotasFromScope(scope);
  if (!Object.keys(quotas).length) return { status: "no numbers" };
  const token = process.env.SOCIALDESK_HUB_API_TOKEN;
  if (!token) return { status: "error", detail: "SocialDesk is not configured" };
  try {
    const res = await fetch(`${base()}/api/hub-quotas`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ client_name: brandName, quotas, dry: !!opts.dry }),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => ({}))) as {
      found?: boolean;
      client_name?: string;
      previous?: Quotas;
      quotas?: Quotas;
      changed?: boolean;
      error?: string;
    };
    if (!res.ok) return { status: "error", detail: body.error ?? `HTTP ${res.status}` };
    if (!body.found) return { status: "not in SocialDesk" };
    return {
      status: body.changed ? "sent" : "same",
      client: body.client_name ?? brandName,
      previous: body.previous ?? {},
      quotas: body.quotas ?? quotas,
    };
  } catch (e) {
    return { status: "error", detail: (e as Error).message };
  }
}

/** Every SocialDesk client's name and current minimums (for the naming check). */
export async function listSocialDeskClients(): Promise<{ id: string; name: string; quotas: Quotas }[] | null> {
  const token = process.env.SOCIALDESK_HUB_API_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`${base()}/api/hub-quotas`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { clients?: { id: string; name: string; quotas: Quotas }[] };
    return body.clients ?? null;
  } catch {
    return null;
  }
}
