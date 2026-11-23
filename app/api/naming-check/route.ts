// GET /api/naming-check
//
// One client, one name, everywhere. Lists every client whose name is not
// spelled the same in: the client database (Surroundings), the Monday All
// Accounts board, the Client list on the Monday All Projects board, and
// SocialDesk. Read-only. Signed-in team members only.

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listSocialDeskClients } from "@/lib/socialdesk/quotas";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const loose = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/\(.*?\)/g, "").replace(/[^a-z0-9]/g, "");

async function monday<T>(query: string): Promise<T | null> {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) return null;
  const res = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token, "API-Version": "2024-10" },
    body: JSON.stringify({ query }),
    cache: "no-store",
  });
  const json = (await res.json()) as { data?: T };
  return json.data ?? null;
}

type Page = { cursor: string | null; items: { name: string; group: { title: string } }[] };

export async function GET() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data: brands } = await supabase.from("brands").select("business_name, engagement_type, scope").order("business_name");

  // All Accounts rows
  const rows: { name: string; group: string }[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 10; i++) {
    const q: string = cursor
      ? `query { next_items_page(limit: 200, cursor: "${cursor}") { cursor items { name group { title } } } }`
      : `query { boards(ids: [7006568275]) { items_page(limit: 200) { cursor items { name group { title } } } } }`;
    const d = await monday<{ next_items_page?: Page; boards?: { items_page: Page }[] }>(q);
    const page: Page | undefined = cursor ? d?.next_items_page : d?.boards?.[0]?.items_page;
    if (!page) break;
    rows.push(...page.items.map((it) => ({ name: it.name, group: it.group.title })));
    cursor = page.cursor;
    if (!cursor) break;
  }

  // Client labels on All Projects
  const col = await monday<{ boards: { columns: { settings_str: string }[] }[] }>(
    `query { boards(ids: [${process.env.MONDAY_BOARD_ID_ALL_PROJECTS ?? "7006062832"}]) { columns(ids: ["dropdown"]) { settings_str } } }`
  );
  let labels: string[] = [];
  try {
    const s = JSON.parse(col?.boards?.[0]?.columns?.[0]?.settings_str ?? "{}") as { labels?: { id: number; name: string }[]; deactivated_labels?: number[] };
    const off = new Set(s.deactivated_labels ?? []);
    labels = (s.labels ?? []).filter((l) => !off.has(l.id)).map((l) => l.name);
  } catch {
    labels = [];
  }

  const social = (await listSocialDeskClients())?.map((c) => c.name) ?? null;

  // For one name, the matching names in another list: exact (ignoring case and
  // punctuation), else one starting with the other.
  const find = (name: string, list: string[]) => {
    const n = loose(name);
    const exact = list.filter((x) => loose(x) === n);
    if (exact.length) return exact;
    return list.filter((x) => {
      const m = loose(x);
      return m.length >= 5 && n.length >= 5 && (m.startsWith(n) || n.startsWith(m));
    });
  };

  const activeRows = rows.filter((r) => r.group !== "Inactive Clients");
  const mismatches: { surroundings: string; allAccounts: string[]; allProjects: string[]; socialDesk: string[] | null }[] = [];
  let checked = 0;
  for (const b of brands ?? []) {
    const name = b.business_name as string;
    const acc = find(name, activeRows.map((r) => r.name));
    const proj = find(name, labels);
    // A client with a recorded SocialDesk name is a known, deliberate difference.
    const alias = (b.scope as { socialdesk_client?: string } | null)?.socialdesk_client;
    const soc = social ? (alias ? [] : find(name, social)) : null;
    if (!acc.length && !proj.length && !(soc ?? []).length) continue; // only lives in the database
    checked++;
    const differs = (list: string[] | null) => !!list && list.length > 0 && list.some((x) => x.trim() !== name.trim());
    const doubled = (list: string[] | null) => !!list && new Set(list.map((x) => x.trim())).size > 1;
    if (differs(acc) || differs(proj) || differs(soc) || doubled(acc) || doubled(proj) || doubled(soc)) {
      mismatches.push({ surroundings: name, allAccounts: acc, allProjects: proj, socialDesk: soc });
    }
  }
  const known = new Set((brands ?? []).map((b) => loose(b.business_name as string)));
  const aliases = new Set(
    (brands ?? []).map((b) => (b.scope as { socialdesk_client?: string } | null)?.socialdesk_client).filter((x): x is string => !!x).map(loose)
  );
  const hasBrand = (x: string) => {
    const n = loose(x);
    return known.has(n) || aliases.has(n) || [...known].some((k) => k.length >= 5 && n.length >= 5 && (k.startsWith(n) || n.startsWith(k)));
  };
  return NextResponse.json({
    checked,
    spelledDifferently: mismatches,
    activeRetainerRowsWithNoClientRecord: rows.filter((r) => r.group === "Active Retainer Clients" && !hasBrand(r.name)).map((r) => r.name),
    socialDeskClientsWithNoClientRecord: social ? social.filter((x) => !hasBrand(x)) : null,
  });
}
