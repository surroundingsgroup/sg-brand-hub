// Saved meeting view — opened from the Meetings tile's "Recent notes"
// strip. Read-only for now; the raw dump, AI output, and follow-up
// email all render as plain cards. (Edit-in-place lands next pass.)

import { notFound } from "next/navigation";
import { SummaryList } from "@/components/meetings/summary-list";
import Link from "next/link";
import { ChevronLeft, Mail, ListChecks, Users as UsersIcon, Calendar } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const MEETING_LABEL: Record<string, string> = {
  monthly_external_sync: "Monthly External Sync",
  internal_strategy_collab: "Internal Strategy Collab",
  quarterly_business_review: "Quarterly Business Review",
  annual_audit: "Annual Audit",
  other: "Client Meeting",
};

type ActionItem = {
  task: string;
  owner?: string | null;
  due?: string | null;
};

function fmtDate(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default async function SavedMeetingPage({
  params,
}: {
  params: { id: string; meetingId: string };
}) {
  const supabase = createSupabaseServerClient();
  const [{ data: meeting }, { data: brand }] = await Promise.all([
    supabase
      .from("meeting_notes")
      .select("*")
      .eq("id", params.meetingId)
      .eq("brand_id", params.id)
      .single(),
    supabase
      .from("brands")
      .select("business_name, submitter_email, submitter_name")
      .eq("id", params.id)
      .single(),
  ]);

  if (!meeting || !brand) notFound();

  const m = meeting as {
    id: string;
    meeting_type: string;
    meeting_title: string | null;
    meeting_date: string;
    raw_notes: string | null;
    summary: string | null;
    action_items_us: ActionItem[];
    action_items_them: ActionItem[];
    followup_email_subject: string | null;
    followup_email_body: string | null;
    next_meeting_focus: string | null;
    analyzed_at: string | null;
    created_at: string;
  };

  const title =
    m.meeting_title ?? MEETING_LABEL[m.meeting_type] ?? MEETING_LABEL.other;

  const pocEmail = brand.submitter_email as string | null;
  const followupMailto =
    pocEmail && m.followup_email_subject && m.followup_email_body
      ? `mailto:${pocEmail}?subject=${encodeURIComponent(m.followup_email_subject)}&body=${encodeURIComponent(m.followup_email_body)}`
      : null;

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border/70 bg-panel">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-3">
          <Link
            href={`/client/${params.id}`}
            className="inline-flex items-center gap-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Back to {brand.business_name}
          </Link>
          <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Meeting notes
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-5xl px-6 py-8">
        <div className="mb-8">
          <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {title}
          </div>
          <h1 className="mt-1.5 text-3xl font-semibold tracking-tight text-foreground md:text-[2.25rem]">
            {brand.business_name}
          </h1>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-5 text-[12px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              {fmtDate(m.meeting_date)}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <section className="rounded-xl border border-border/70 bg-panel p-5">
            <div className="mb-3 border-b border-border/60 pb-2.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Raw notes
            </div>
            {m.raw_notes ? (
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/90">
                {m.raw_notes}
              </p>
            ) : (
              <p className="text-[12px] italic text-muted-foreground">
                No raw notes saved.
              </p>
            )}
          </section>

          <div className="flex flex-col gap-4">
            {m.summary ? (
              <Card title="Summary">
                <SummaryList text={m.summary} />
              </Card>
            ) : null}

            <Card title="Action items — us" icon={<ListChecks className="h-3.5 w-3.5" />}>
              <ActionList items={m.action_items_us ?? []} emptyLabel="Nothing we promised." />
            </Card>

            <Card
              title="Action items — client"
              icon={<UsersIcon className="h-3.5 w-3.5" />}
            >
              <ActionList
                items={m.action_items_them ?? []}
                emptyLabel="Nothing owed from them."
              />
            </Card>

            {(m.followup_email_subject || m.followup_email_body) ? (
              <Card
                title="Follow-up email"
                icon={<Mail className="h-3.5 w-3.5" />}
                trailing={
                  followupMailto ? (
                    <a
                      href={followupMailto}
                      className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Mail className="h-3 w-3" />
                      Open in mail
                    </a>
                  ) : null
                }
              >
                <div className="space-y-2">
                  {m.followup_email_subject ? (
                    <div className="text-[12px]">
                      <span className="font-medium text-foreground">Subject:</span>{" "}
                      <span className="text-foreground/90">{m.followup_email_subject}</span>
                    </div>
                  ) : null}
                  {m.followup_email_body ? (
                    <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/90">
                      {m.followup_email_body}
                    </p>
                  ) : null}
                </div>
              </Card>
            ) : null}

            {m.next_meeting_focus ? (
              <div className="rounded-xl border border-border/70 bg-panel p-4">
                <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Next meeting focus
                </div>
                <p className="mt-1.5 text-[13px] text-foreground/90">
                  {m.next_meeting_focus}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function Card({
  title,
  icon,
  trailing,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border/70 bg-panel p-5">
      <header className="mb-3 flex items-center justify-between gap-3 border-b border-border/60 pb-2.5">
        <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {icon ? <span className="text-foreground/50">{icon}</span> : null}
          {title}
        </div>
        {trailing}
      </header>
      {children}
    </section>
  );
}

function ActionList({
  items,
  emptyLabel,
}: {
  items: ActionItem[];
  emptyLabel: string;
}) {
  if (!items || items.length === 0) {
    return <p className="text-[12px] italic text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <ul className="space-y-2.5">
      {items.map((it, i) => (
        <li key={i} className="flex items-start gap-2.5 border-b border-border/40 pb-2.5 last:border-b-0 last:pb-0">
          <div className="pt-0.5 text-muted-foreground">•</div>
          <div className="flex-1">
            <div className="text-[13px] leading-snug text-foreground">{it.task}</div>
            {(it.owner || it.due) ? (
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                {it.owner ? <span>{it.owner}</span> : null}
                {it.owner && it.due ? <span className="text-foreground/20">·</span> : null}
                {it.due ? <span>{it.due}</span> : null}
              </div>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
