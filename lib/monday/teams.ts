import { unstable_cache } from "next/cache";
// Fetch Monday teams + members. Used to source the "Account Managers"
// dropdown on the brand editor — whoever's in the team in Monday is
// assignable as an AM in Brand Hub, zero deploys required.

const MONDAY_API_URL = "https://api.monday.com/v2";

function token(): string {
  const t = process.env.MONDAY_API_TOKEN;
  if (!t) throw new Error("MONDAY_API_TOKEN is not set");
  return t;
}

async function mondayFetch<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token(),
      "API-Version": "2024-10",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`Monday API HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const body = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (body.errors?.length) throw new Error(`Monday: ${body.errors.map((e) => e.message).join("; ")}`);
  if (!body.data) throw new Error("Monday returned no data");
  return body.data;
}

export type TeamMember = {
  id: string;
  name: string;
  email: string | null;
};

const AM_TEAM_NAME = "Account Managers";

/** Cached in-process so the dropdown doesn't re-query on every page render. */
let cache: { at: number; members: TeamMember[] } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// The AM team list: kept in Vercel's shared data cache for an hour so a fresh
// server doesn't wait on Monday; force reads Monday now.
export async function fetchAccountManagers(opts: { force?: boolean } = {}): Promise<TeamMember[]> {
  if (!opts.force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.members;
  }
  if (!opts.force) {
    const members = await cachedAccountManagers();
    cache = { at: Date.now(), members };
    return members;
  }
  return readAccountManagers();
}
const cachedAccountManagers = unstable_cache(() => readAccountManagers(), ["monday-account-managers"], { revalidate: 3600 });

async function readAccountManagers(): Promise<TeamMember[]> {

  const data = await mondayFetch<{
    teams: Array<{
      id: string;
      name: string;
      users: Array<{ id: string; name: string; email: string | null }>;
    }>;
  }>(`query { teams { id name users { id name email } } }`);

  const team = data.teams.find((t) => t.name.trim().toLowerCase() === AM_TEAM_NAME.toLowerCase());
  if (!team) {
    // No team configured — return empty list so the dropdown is just empty.
    // The caller can fall back to free-text if needed.
    cache = { at: Date.now(), members: [] };
    return [];
  }

  const members = team.users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
  }));
  cache = { at: Date.now(), members };
  return members;
}

/** Look up an AM by name (case-insensitive, trims whitespace). Returns the
 *  Monday TeamMember or null. Used for routing notifications — given a
 *  brand's free-text account_manager value, find the Monday user. */
export async function findAmByName(name: string | null | undefined): Promise<TeamMember | null> {
  if (!name?.trim()) return null;
  const lower = name.trim().toLowerCase();
  const members = await fetchAccountManagers();
  return members.find((m) => m.name.trim().toLowerCase() === lower) ?? null;
}

/** Resolve the signed-in Hub user to their Monday team-member record by
 *  email. Returns null if they aren't on the "Account Managers" team —
 *  caller can fall back to the raw email in that case. Used by the
 *  dashboard's "mine" filter to map user → canonical AM display name
 *  that matches brand.account_manager. */
export async function findAmByEmail(email: string | null | undefined): Promise<TeamMember | null> {
  if (!email?.trim()) return null;
  const lower = email.trim().toLowerCase();
  const members = await fetchAccountManagers();
  return members.find((m) => m.email?.trim().toLowerCase() === lower) ?? null;
}

// Full team roster — every member across every Monday team in the SG
// workspace. Used by the Allocation editor's Owner dropdown so an AM
// can assign a line to anyone on the team (not just AMs).
let rosterCache: { at: number; members: TeamMember[] } | null = null;

export async function fetchAllTeamMembers(): Promise<TeamMember[]> {
  if (rosterCache && Date.now() - rosterCache.at < CACHE_TTL_MS) {
    return rosterCache.members;
  }
  const data = await mondayFetch<{
    teams: Array<{
      users: Array<{ id: string; name: string; email: string | null }>;
    }>;
  }>(`query { teams { users { id name email } } }`);

  const byId = new Map<string, TeamMember>();
  for (const t of data.teams ?? []) {
    for (const u of t.users ?? []) {
      if (byId.has(u.id)) continue;
      byId.set(u.id, { id: u.id, name: u.name, email: u.email });
    }
  }
  const members = Array.from(byId.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  rosterCache = { at: Date.now(), members };
  return members;
}
