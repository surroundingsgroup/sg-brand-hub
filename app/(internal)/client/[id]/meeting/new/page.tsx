// New meeting notes — takeover page from the client profile's
// Meetings tile "Start notes" button. Lives at
//   /client/[id]/meeting/new?type=<meeting_type>
//
// Server component: looks up the brand so the composer has the AM
// name + POC pre-wired, and renders the client composer below.
import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { MeetingComposer } from "./meeting-composer";
import type { Brand } from "@/types/brand";

export const dynamic = "force-dynamic";

const MEETING_TITLES: Record<string, string> = {
  monthly_external_sync: "Monthly External Sync",
  internal_strategy_collab: "Internal Strategy Collab",
  quarterly_business_review: "Quarterly Business Review",
  annual_audit: "Annual Audit",
  other: "Client Meeting",
};

export default async function NewMeetingPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { type?: string };
}) {
  const type = searchParams.type ?? "other";
  const title = MEETING_TITLES[type] ?? MEETING_TITLES.other;

  const supabase = createSupabaseServerClient();
  const { data: brand } = await supabase
    .from("brands")
    .select(
      "id, business_name, submitter_name, submitter_email, account_manager"
    )
    .eq("id", params.id)
    .single();
  if (!brand) notFound();
  const b = brand as Pick<Brand, "id" | "business_name" | "submitter_name" | "submitter_email" | "account_manager">;

  return (
    <div className="min-h-screen bg-background">
      {/* Taskbar — not a nav; a quiet "Esc back" ribbon. */}
      <div className="border-b border-border/70 bg-panel">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-3">
          <Link
            href={`/client/${b.id}`}
            className="inline-flex items-center gap-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Back to {b.business_name}
          </Link>
          <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Meeting notes
          </div>
        </div>
      </div>

      <MeetingComposer
        brandId={b.id}
        brandName={b.business_name}
        meetingType={type}
        meetingTitle={title}
        pocName={b.submitter_name ?? null}
        pocEmail={b.submitter_email ?? null}
        amName={b.account_manager ?? null}
      />
    </div>
  );
}
