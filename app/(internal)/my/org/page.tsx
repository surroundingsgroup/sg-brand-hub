// Accountability Chart — server shell. Flattens team_profiles into a
// shape the client component can build the tree from, then renders the
// interactive OrgChart which handles the tree math + inline edits.

import { PageContainer } from "@/components/shell/page-container";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchAccountManagers } from "@/lib/monday/teams";
import type { TeamProfile } from "@/lib/team/profile";
import { OrgChart, type OrgNode } from "./org-chart";

export const dynamic = "force-dynamic";

export default async function OrgChartPage() {
  const supabase = createSupabaseServerClient();
  const [profilesRes, ams, approvedBrands] = await Promise.all([
    supabase.from("team_profiles").select("*"),
    fetchAccountManagers().catch(() => []),
    supabase.from("brands").select("account_manager").eq("status", "approved"),
  ]);
  const profiles = (profilesRes.data ?? []) as TeamProfile[];
  const amEmails = new Set(
    ams.map((a) => (a.email ?? "").toLowerCase()).filter(Boolean)
  );

  const clientCountByName = new Map<string, number>();
  for (const row of approvedBrands.data ?? []) {
    const name = (row as { account_manager: string | null }).account_manager;
    if (!name) continue;
    clientCountByName.set(name, (clientCountByName.get(name) ?? 0) + 1);
  }

  const nodes: OrgNode[] = profiles.map((p) => ({
    email: p.email.toLowerCase(),
    name: p.name ?? p.email,
    title: p.title,
    department: p.department,
    avatar_url: p.avatar_url,
    is_am: amEmails.has(p.email.toLowerCase()),
    client_count: clientCountByName.get(p.name ?? "") ?? 0,
    manager_email: p.manager_email?.toLowerCase() ?? null,
  }));

  return (
    <PageContainer>
      <header className="mb-8 border-b border-border/70 pb-6">
        <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          My Surroundings · Accountability chart
        </div>
        <h1 className="mt-1.5 text-3xl font-semibold tracking-tight text-foreground md:text-[2.25rem]">
          Who reports to whom
        </h1>
        <p className="mt-2.5 max-w-prose text-[13px] leading-relaxed text-muted-foreground">
          Hover a card and hit <strong>Edit</strong> to change the reporting line. CEO is amber-ringed, leads are marked.
        </p>
      </header>

      {nodes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-panel/50 p-10 text-center text-[12.5px] text-muted-foreground">
          No team profiles yet.
        </div>
      ) : (
        // Top padding keeps the CEO card's amber ring from pinching
        // against the header border. x-auto handles wide trees without
        // clipping the ring at the edges (overflow-visible on y axis).
        <div className="overflow-x-auto overflow-y-visible px-2 pb-8 pt-6">
          <OrgChart nodes={nodes} />
        </div>
      )}
    </PageContainer>
  );
}
