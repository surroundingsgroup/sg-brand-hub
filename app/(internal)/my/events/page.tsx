// Team events + meetings — upcoming (and a brief look back). Same
// table backs both the "AM standup Tuesdays" style recurring calls
// and the "Dec 14 holiday party" one-offs.

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageContainer } from "@/components/shell/page-container";
import { EventsFeed } from "./events-feed";

export const dynamic = "force-dynamic";

export type EventRow = {
  id: string;
  title: string;
  kind: "meeting" | "all_hands" | "event" | "offsite" | "holiday" | "other";
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  notes: string | null;
  created_by_email: string | null;
  created_by_name: string | null;
  created_at: string;
};

export default async function EventsPage() {
  const supabase = createSupabaseServerClient();
  const horizonBack = new Date(Date.now() - 14 * 86400 * 1000).toISOString();
  const { data } = await supabase
    .from("team_events")
    .select("*")
    .gte("starts_at", horizonBack)
    .order("starts_at", { ascending: true })
    .limit(100);

  return (
    <PageContainer>
      <header className="mb-8 border-b border-border/70 pb-6">
        <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          My Surroundings · Team events
        </div>
        <h1 className="mt-1.5 text-3xl font-semibold tracking-tight text-foreground md:text-[2.25rem]">
          Events &amp; meetings
        </h1>
        <p className="mt-2.5 max-w-prose text-[13px] leading-relaxed text-muted-foreground">
          All-hands, standups, off-sites, holidays. One place for the shared team calendar.
        </p>
      </header>
      <EventsFeed initial={(data ?? []) as EventRow[]} />
    </PageContainer>
  );
}
