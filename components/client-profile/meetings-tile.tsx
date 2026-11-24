// Meetings tile — the Hub-native meeting notes surface. Four meeting
// cadences, each with a "Start notes" link that opens the composer at
// /client/[id]/meeting/new?type=<meeting_type>.
//
// The card stays short: the two monthly meetings show, and the quarterly
// review, the annual audit and the most recent saved notes (one click to
// the raw notes + AI-generated recap) open with a tap.
//
// This replaces the Monday client-board "Meeting Cadence" subitem
// pattern. Nothing reads from or writes to that board.

import Link from "next/link";
import { Users, Sparkles, ArrowRight, CalendarDays, ChevronDown } from "lucide-react";
import { Tile } from "./tile";
import type { ClientMeeting, ClientMeetings } from "@/lib/meetings/calendar";

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

// "Tue, Dec 2 · 10:00 AM", in the team's time zone.
function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
  return `${day} · ${time}`;
}

function CalendarLine({ m, label }: { m: ClientMeeting; label?: string }) {
  const body = (
    <>
      {label ? <span className="w-9 flex-shrink-0 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</span> : null}
      <span className="flex-shrink-0 font-medium text-foreground">{fmtWhen(m.start)}</span>
      <span className="min-w-0 truncate text-muted-foreground">{m.title}</span>
    </>
  );
  const cls = "flex items-baseline gap-2 text-[12px]";
  return m.url ? (
    <a href={m.url} target="_blank" rel="noopener noreferrer" className={`${cls} transition-colors hover:text-foreground`} title="Open in Google Calendar">
      {body}
    </a>
  ) : (
    <div className={cls}>{body}</div>
  );
}

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

// One meeting type on a single line: name, cadence, Start notes. What the
// meeting is for shows on hover, and in the composer it opens.
function MeetingRow({ m, brandId }: { m: MeetingKind; brandId: string }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2" title={m.blurb}>
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="truncate text-[13.5px] font-medium text-foreground sm:text-[13px]">{m.label}</span>
        <span className="flex-shrink-0 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{m.cadence}</span>
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
  );
}

export function MeetingsTile({
  brandId,
  pastMeetings,
  calendar,
}: {
  brandId: string;
  pastMeetings: PastMeeting[];
  // Meetings with this client on the team's Google Calendars.
  calendar?: ClientMeetings;
}) {
  const next = calendar?.ok ? (calendar.upcoming[0] ?? null) : null;
  const lastMet = calendar?.ok ? (calendar.recent[0] ?? null) : null;
  // The next and the last meeting stay in view; anything further is a tap away.
  const moreOnCalendar = calendar?.ok ? [...calendar.upcoming.slice(1), ...calendar.recent.slice(1)] : [];
  // Kept short so the card sits level with Contact beside it: the two
  // monthly meetings are always there, and the less frequent ones and the
  // past notes open with a tap.
  const monthly = MEETINGS.filter((m) => m.cadence === "Monthly");
  const occasional = MEETINGS.filter((m) => m.cadence !== "Monthly");
  // Most recent meeting from each of the last 6 months, so history stays
  // readable even after a year of monthly syncs.
  const notes = oneMeetingPerMonth(pastMeetings);
  const last = notes[0];

  return (
    <Tile label="Meetings" icon={<Users className="h-3.5 w-3.5" />}>
      {/* From Google Calendar, always in view: the next meeting with this
          client and the last one. */}
      {calendar?.ok ? (
        <div className="-mt-1 flex flex-col gap-1 border-b border-border/60 pb-2.5">
          <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            <CalendarDays className="h-3 w-3" />
            On the calendar
          </div>
          {next ? (
            <CalendarLine m={next} label="Next" />
          ) : (
            <div className="flex items-baseline gap-2 text-[12px]">
              <span className="w-9 flex-shrink-0 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Next</span>
              <span className="text-muted-foreground">Nothing scheduled</span>
            </div>
          )}
          {lastMet ? (
            <CalendarLine m={lastMet} label="Last" />
          ) : !next ? (
            <div className="text-[12px] text-muted-foreground">No meetings found with this client.</div>
          ) : null}
        </div>
      ) : null}
      <ul className={`${calendar?.ok ? "" : "-mt-1 "}divide-y divide-border/60`}>
        {monthly.map((m) => (
          <MeetingRow key={m.type} m={m} brandId={brandId} />
        ))}
      </ul>

      <details className="group/more border-t border-border/60">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-2.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 truncate">
            Quarterly review, annual audit
            {moreOnCalendar.length > 0 ? " · more meetings" : ""}
            {last ? ` · last notes ${fmtDate(last.meeting_date)}` : ""}
          </span>
          <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 transition-transform group-open/more:rotate-180" />
        </summary>

        <ul className="divide-y divide-border/60 border-t border-border/60">
          {occasional.map((m) => (
            <MeetingRow key={m.type} m={m} brandId={brandId} />
          ))}
        </ul>

        {moreOnCalendar.length > 0 ? (
          <div className="border-t border-border/60 py-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              <CalendarDays className="h-3 w-3" />
              More on the calendar
            </div>
            <div className="flex flex-col gap-1">
              {moreOnCalendar.map((m) => (
                <CalendarLine key={`${m.id}-${m.start}`} m={m} />
              ))}
            </div>
          </div>
        ) : null}

        {notes.length > 0 ? (
          <div className="border-t border-border/60 pt-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              <CalendarDays className="h-3 w-3" />
              Recent notes
            </div>
            <ul className="divide-y divide-border/50">
              {notes.map((m) => (
                <li key={m.id}>
                  <a
                    href={`/client/${brandId}/meeting/${m.id}`}
                    className="flex items-start justify-between gap-3 py-1.5 text-[12px] transition-colors hover:text-foreground"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-foreground">{m.meeting_title ?? m.meeting_type.replace(/_/g, " ")}</div>
                      {m.summary ? <div className="truncate text-[11px] text-muted-foreground">{m.summary.replace(/^[-•*]\s*/gm, "").split("\n").filter(Boolean).join(" · ")}</div> : null}
                    </div>
                    <span className="whitespace-nowrap text-[11px] text-muted-foreground">{fmtDate(m.meeting_date)}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </details>
    </Tile>
  );
}
