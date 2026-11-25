// Saved meeting view, opened from the Meetings tile. Reads like the composer
// did: the recap card, our numbered next steps with their tools (requests,
// revisions, open times, links), the client's side and the follow-up email.
// Edit opens the composer on this meeting.

import { notFound } from "next/navigation";
import { EmailPreview } from "@/components/meetings/email-preview";
import { OpenInGmail } from "@/components/meetings/open-in-gmail";
import { RecapHero } from "@/components/meetings/recap-hero";
import { RawNotesButton } from "@/components/meetings/raw-notes-button";
import { type ActionToolItem } from "@/components/meetings/action-tool";
import { SavedActionList } from "@/components/meetings/saved-action-list";
import { clientTodoStates, todoPrefix } from "@/lib/meetings/todos";
import Link from "next/link";
import { ChevronLeft, Mail, ListChecks, Users as UsersIcon, Calendar, PenLine } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const MEETING_LABEL: Record<string, string> = {
  monthly_external_sync: "Monthly External Sync",
  internal_strategy_collab: "Internal Strategy Collab",
  quarterly_business_review: "Quarterly Business Review",
  annual_audit: "Annual Audit",
  other: "Client Meeting",
};

type ActionItem = ActionToolItem & {
  owner?: string | null;
  due?: string | null;
  done?: boolean;
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

  // Our items follow their To-dos: one checked off in My Surroundings shows
  // as done here too (and one reopened there shows open).
  const clientName = brand.business_name as string;
  const todos = await clientTodoStates(clientName).catch(() => []);
  const ours = (m.action_items_us ?? []).map((it) => {
    const prefix = todoPrefix(clientName, it.task ?? "");
    const rows = todos.filter((t) => t.text.startsWith(prefix));
    return rows.length ? { ...it, done: rows.every((t) => t.done) } : it;
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border/70 bg-panel">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-3">
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

      <div className="mx-auto w-full max-w-6xl px-6 py-8">
        <div className="mb-8">
          <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {title}
          </div>
          <h1 className="mt-1.5 text-3xl font-semibold tracking-tight text-foreground md:text-[2.25rem]">
            {brand.business_name}
          </h1>
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <Calendar className="h-3.5 w-3.5" />
              {fmtDate(m.meeting_date)}
            </span>
            <div className="flex items-center gap-2">
            <RawNotesButton notes={m.raw_notes} />
            <Link
              href={`/client/${params.id}/meeting/${m.id}/edit`}
              className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-[12.5px] font-semibold text-background shadow-sm transition-opacity hover:opacity-90"
            >
              <PenLine className="h-3.5 w-3.5" />
              Edit notes
            </Link>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            {m.summary || m.next_meeting_focus ? (
              <RecapHero summary={m.summary ?? ""} focus={m.next_meeting_focus ?? ""} clientName={brand.business_name as string} />
            ) : null}

            <Card
              title={`Our next steps${(m.action_items_us ?? []).length ? ` · ${(m.action_items_us ?? []).length}` : ""}`}
              icon={<ListChecks className="h-3.5 w-3.5" />}
            >
              <SavedActionList
                items={ours}
                side="us"
                brandId={params.id}
                meetingId={m.id}
                emptyLabel="Nothing we promised."
                numbered
                tool={{ brandName: clientName, pocEmail }}
              />
            </Card>
          </div>

          <div className="flex flex-col gap-4">

            <Card
              title={`On ${brand.submitter_name ? possessive(String(brand.submitter_name).split(" ")[0]) : "the client's"} side`}
              icon={<UsersIcon className="h-3.5 w-3.5" />}
            >
              <SavedActionList
                items={m.action_items_them ?? []}
                side="them"
                brandId={params.id}
                meetingId={m.id}
                emptyLabel="Nothing owed from them."
              />
            </Card>

            {(m.followup_email_subject || m.followup_email_body) ? (
              <Card
                title="Follow-up email"
                icon={<Mail className="h-3.5 w-3.5" />}
                trailing={
                  m.followup_email_body ? (
                    <OpenInGmail to={pocEmail} subject={m.followup_email_subject ?? ""} body={m.followup_email_body} />
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
                    <EmailPreview body={m.followup_email_body} />
                  ) : null}
                </div>
              </Card>
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

// "Bertram Yachts'" not "Bertram Yachts's".
function possessive(name: string): string {
  return /s$/i.test(name.trim()) ? `${name.trim()}'` : `${name.trim()}'s`;
}
