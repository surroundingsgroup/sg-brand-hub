// Meetings tile — the Hub-native meeting notes surface. Four meeting
// cadences, each with a "Start notes" link that opens the composer at
// /client/[id]/meeting/new?type=<meeting_type>.
//
// Below the cadences is a compact history strip of the most recent
// saved meetings for this client — one-click to the raw notes +
// AI-generated recap.
//
// This replaces the Monday client-board "Meeting Cadence" subitem
// pattern. Nothing reads from or writes to that board.

import Link from "next/link";
import { Users, Sparkles, ArrowRight, CalendarDays } from "lucide-react";
import { Tile } from "./tile";

type MeetingKind = {
  type: string;
  label: string;
  cadence: string;
  blurb: string;
};

const MEETINGS: MeetingKind[] = [
  {
    type: "monthly_external_sync",
    label: "Monthly External Sync",
    cadence: "Monthly",
    blurb: "Results, what's next, scheduling the next shoot.",
  },
  {
    type: "internal_strategy_collab",
    label: "Internal Strategy Collab",
    cadence: "Monthly",
    blurb: "Creative + AM alignment on direction.",
  },
  {
    type: "quarterly_business_review",
    label: "Quarterly Business Review",
    cadence: "Quarterly",
    blurb: "Big-picture health, roadmap, renewal.",
  },
  {
    type: "annual_audit",
    label: "Annual Audit",
    cadence: "Annual",
    blurb: "Full scope review and plan reset.",
  },
];

type PastMeeting = {
  id: string;
  meeting_type: string;
  meeting_title: string | null;
  meeting_date: string;
  summary: string | null;
  analyzed_at: string | null;
  created_at: string;
};

function fmtDate(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Keep only the most recent meeting from each calendar month, newest
// first. Billy's call: after many months of syncs the strip would
// bloat; one headline per month keeps it skimmable.
function oneMeetingPerMonth(meetings: PastMeeting[]): PastMeeting[] {
  // Rely on caller-sorted order (meeting_date desc) and pick the first
  // meeting for each YYYY-MM.
  const seen = new Set<string>();
  const out: PastMeeting[] = [];
  for (const m of meetings) {
    const key = m.meeting_date.slice(0, 7); // YYYY-MM
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
    if (out.length >= 6) break;
  }
  return out;
}

export function MeetingsTile({
  brandId,
  pastMeetings,
}: {
  brandId: string;
  pastMeetings: PastMeeting[];
}) {
  return (
    <Tile label="Meetings" icon={<Users className="h-3.5 w-3.5" />}>
      <ul className="divide-y divide-border/60 -mt-1">
        {MEETINGS.map((m) => (
          <li
            key={m.type}
            className="flex items-center justify-between gap-3 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-col items-start gap-0 sm:flex-row sm:items-center sm:gap-2">
                <span className="text-[13.5px] font-medium text-foreground sm:text-[13px]">
                  {m.label}
                </span>
                <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  {m.cadence}
                </span>
              </div>
              <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {m.blurb}
              </div>
            </div>
            <Link
              href={`/client/${brandId}/meeting/new?type=${m.type}`}
              className="group/btn inline-flex h-9 flex-shrink-0 items-center gap-1 rounded-full border border-border bg-background px-3 text-[12px] font-medium text-foreground transition-colors hover:border-foreground/30 hover:bg-secondary md:h-auto md:rounded-md md:px-2.5 md:py-1 md:text-[11px]"
            >
              <Sparkles className="h-3 w-3 text-muted-foreground group-hover/btn:text-foreground" />
              Start notes
              <ArrowRight className="h-3 w-3 text-muted-foreground transition-transform group-hover/btn:translate-x-0.5" />
            </Link>
          </li>
        ))}
      </ul>

      {/* Recent notes — most recent meeting from each of the last 6
          months, so history stays readable even after a year of
          monthly syncs. Grouped by YYYY-MM; first (newest) per group
          wins. */}
      {pastMeetings.length > 0 ? (
        <div className="mt-3 border-t border-border/60 pt-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            <CalendarDays className="h-3 w-3" />
            Recent notes
          </div>
          <ul className="divide-y divide-border/50">
            {oneMeetingPerMonth(pastMeetings).map((m) => (
              <li key={m.id}>
                <a
                  href={`/client/${brandId}/meeting/${m.id}`}
                  className="flex items-start justify-between gap-3 py-1.5 text-[12px] transition-colors hover:text-foreground"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-foreground">
                      {m.meeting_title ?? m.meeting_type.replace(/_/g, " ")}
                    </div>
                    {m.summary ? (
                      <div className="truncate text-[11px] text-muted-foreground">
                        {m.summary}
                      </div>
                    ) : null}
                  </div>
                  <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                    {fmtDate(m.meeting_date)}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Tile>
  );
}
