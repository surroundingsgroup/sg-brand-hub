// Edit a saved meeting: the same composer it was written in, filled with the
// saved notes, recap, action items and email. Save writes back to it.
import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { MeetingComposer, type Analysis } from "../../new/meeting-composer";

export const dynamic = "force-dynamic";

const MEETING_TITLES: Record<string, string> = {
  monthly_external_sync: "Monthly External Sync",
  internal_strategy_collab: "Internal Strategy Collab",
  quarterly_business_review: "Quarterly Business Review",
  annual_audit: "Annual Audit",
  other: "Client Meeting",
};

export default async function EditMeetingPage({ params }: { params: { id: string; meetingId: string } }) {
  const supabase = createSupabaseServerClient();
  const [{ data: meeting }, { data: brand }, { data: team }] = await Promise.all([
    supabase.from("meeting_notes").select("*").eq("id", params.meetingId).eq("brand_id", params.id).single(),
    supabase.from("brands").select("id, business_name, submitter_name, submitter_email, account_manager").eq("id", params.id).single(),
    supabase.from("team_profiles").select("name").order("name"),
  ]);
  if (!meeting || !brand) notFound();

  const m = meeting as Record<string, unknown>;
  const type = String(m.meeting_type ?? "other");
  const title = (m.meeting_title as string | null) ?? MEETING_TITLES[type] ?? MEETING_TITLES.other;
  const analysis: Partial<Analysis> = {
    summary: (m.summary as string | null) ?? "",
    action_items_us: Array.isArray(m.action_items_us) ? (m.action_items_us as Analysis["action_items_us"]) : [],
    action_items_them: Array.isArray(m.action_items_them) ? (m.action_items_them as Analysis["action_items_them"]) : [],
    followup_email_subject: (m.followup_email_subject as string | null) ?? "",
    followup_email_body: (m.followup_email_body as string | null) ?? "",
    next_meeting_focus: (m.next_meeting_focus as string | null) ?? "",
  };
  const teamNames = ((team ?? []) as { name: string | null }[]).map((p) => (p.name ?? "").trim()).filter(Boolean);

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border/70 bg-panel">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-3">
          <Link
            href={`/client/${params.id}/meeting/${params.meetingId}`}
            className="inline-flex items-center gap-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Back to the saved meeting
          </Link>
          <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Editing meeting notes</div>
        </div>
      </div>
      <MeetingComposer
        brandId={brand.id as string}
        brandName={brand.business_name as string}
        meetingType={type}
        meetingTitle={title}
        pocName={(brand.submitter_name as string | null) ?? null}
        pocEmail={(brand.submitter_email as string | null) ?? null}
        amName={(brand.account_manager as string | null) ?? null}
        teamNames={teamNames}
        existing={{
          id: params.meetingId,
          meeting_date: String(m.meeting_date ?? ""),
          raw_notes: (m.raw_notes as string | null) ?? "",
          analysis,
        }}
      />
    </div>
  );
}
