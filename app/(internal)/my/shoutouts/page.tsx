// Shoutouts & Showcases — reads the Monday board directly so the Hub
// stays in sync with Operations' existing workflow. Writes go through
// /api/my/shoutouts which creates items on the same board.

import { PageContainer } from "@/components/shell/page-container";
import { fetchAllTeamMembers } from "@/lib/monday/teams";
import { fetchShoutouts, fetchShoutoutsSchema } from "@/lib/monday/shoutouts";
import { ShoutoutsFeed } from "./shoutouts-feed";

export const dynamic = "force-dynamic";

export default async function ShoutoutsPage() {
  const [feed, schema, members] = await Promise.all([
    fetchShoutouts(),
    fetchShoutoutsSchema(),
    fetchAllTeamMembers().catch(() => []),
  ]);

  return (
    <PageContainer>
      <header className="mb-8 border-b border-border/70 pb-6">
        <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          My Surroundings · Shoutouts &amp; Showcases
        </div>
        <h1 className="mt-1.5 text-3xl font-semibold tracking-tight text-foreground md:text-[2.25rem]">
          Shoutouts &amp; Showcases
        </h1>
        <p className="mt-2.5 max-w-prose text-[13px] leading-relaxed text-muted-foreground">
          Positive feedback and showcases, synced with the Monday &ldquo;Shoutouts and Showcases&rdquo; board. Submit here, land there, everyone sees it everywhere.
        </p>
      </header>
      <ShoutoutsFeed
        initial={feed.items}
        teamNames={members.map((m) => m.name)}
        kindOptions={schema.kindLabels}
        schemaOk={feed.ok}
        error={feed.error ?? null}
      />
    </PageContainer>
  );
}
