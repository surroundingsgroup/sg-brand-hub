// Who sees what, for the pages that list money or people across the company.
//
// Billy, 2026-11-23: "I don't want everyone to see everyone." The rule is the
// one he gave for PTO, used everywhere: each person sees their own, a manager
// also sees their team's, and Billy and Justin (CFO) see everything.
//
// There are no roles in the database yet. Until there are, the people who see
// everything are named here.

import { currentUser, type createSupabaseServerClient } from "@/lib/supabase/server";

export const SEES_EVERYTHING = ["Billy Pavlock", "Justin Tarr"];

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

export type Viewer = {
  email: string | null;
  name: string | null;
  everyone: boolean; // sees company-wide numbers
  names: string[]; // normalized names this person may see: their own and their direct reports'
};

export async function getViewer(supabase: ReturnType<typeof createSupabaseServerClient>): Promise<Viewer> {
  const [user, { data: profiles }] = await Promise.all([currentUser(supabase), supabase.from("team_profiles").select("email, name, manager_email")]);
  const email = user?.email ?? null;
  const rows = (profiles ?? []) as { email: string; name: string | null; manager_email: string | null }[];
  const me = email ? rows.find((p) => p.email.toLowerCase() === email) : undefined;
  const name = me?.name?.trim() || null;
  const everyone = !!name && SEES_EVERYTHING.some((n) => norm(n) === norm(name));
  const names = name ? [norm(name), ...rows.filter((p) => email && p.manager_email?.toLowerCase() === email && p.name).map((p) => norm(p.name))] : [];
  return { email, name, everyone, names };
}

/** May this viewer see an account's numbers? Theirs, their team's, or everything. */
export const seesAccount = (viewer: Viewer, accountManager: string | null | undefined) => viewer.everyone || (!!accountManager && viewer.names.includes(norm(accountManager)));
