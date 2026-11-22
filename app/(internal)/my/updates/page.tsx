// Team updates — the one place team-wide announcements live. Replaces
// the email-signature builder route per Billy's call: when a new
// signature drops, post it here and the whole team sees it.

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageContainer } from "@/components/shell/page-container";
import { UpdatesFeed } from "./updates-feed";

export const dynamic = "force-dynamic";

export default async function UpdatesPage() {
  const supabase = createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  const myEmail = user.user?.email?.toLowerCase() ?? null;

  const { data } = await supabase
    .from("team_updates")
    .select("*")
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <PageContainer>
      <header className="mb-8 border-b border-border/70 pb-6">
        <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          My Surroundings · Updates
        </div>
        <h1 className="mt-1.5 text-3xl font-semibold tracking-tight text-foreground md:text-[2.25rem]">
          Team updates
        </h1>
        <p className="mt-2.5 max-w-prose text-[13px] leading-relaxed text-muted-foreground">
          Announcements, policy changes, new hires, signature drops. Pin the important ones; archive the rest.
        </p>
      </header>
      <UpdatesFeed initial={(data ?? []) as UpdateRow[]} myEmail={myEmail} />
    </PageContainer>
  );
}

export type UpdateRow = {
  id: string;
  kind: "announcement" | "policy" | "signature" | "new_hire" | "process" | "other";
  title: string;
  body: string | null;
  pinned: boolean;
  created_by_email: string | null;
  created_by_name: string | null;
  created_at: string;
};
