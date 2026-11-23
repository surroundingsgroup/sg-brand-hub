// SocialDesk tile on the client page — where this month's and next month's
// posts stand, read from SocialDesk's /api/hub-pulse.
//
// Always on show: when the last post went out and when the next one is due,
// then one block per month:
//
//   • what was built against the contract (In-feed 10/10 · Stories 10/10),
//   • a bar and a line for where the posts sit (published, approved and
//     waiting to publish, awaiting client review, awaiting AM review,
//     revisions, drafts),
//   • one verdict in the corner.
//
// The queue underneath ("Next up · 25 in the queue") stays folded until
// tapped, so the card is not a long list by default.
//
// Colours: green = approved or published (darker once it is out), yellow =
// awaiting client review (as on SocialDesk's board), blue = awaiting AM
// review, red = revision requested, grey = still building. Counts that are
// short of the contract stay plain, not red: red is for revisions only.
//
// "Not connected" renders cleanly for brands without a SocialDesk record
// (project-only clients, never-onboarded clients, etc.).

import { Instagram, Calendar, NotebookPen, ChevronDown } from "lucide-react";
import { Tile, TileEmpty } from "./tile";
import type { ContentPulse, UpcomingPost, MonthStatus } from "@/lib/socialdesk/fetch";

const SOCIALDESK_URL =
  process.env.SOCIALDESK_URL ?? "https://socialdesk-lac.vercel.app";

function relative(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (isNaN(then)) return "—";
  const diff = then - Date.now();
  const abs = Math.abs(diff);
  const dayMs = 86400 * 1000;
  if (abs < 3600 * 1000) {
    const m = Math.round(abs / 60000);
    return diff < 0 ? `${m}m ago` : `in ${m}m`;
  }
  if (abs < dayMs) {
    const h = Math.round(abs / (3600 * 1000));
    return diff < 0 ? `${h}h ago` : `in ${h}h`;
  }
  const d = Math.round(abs / dayMs);
  if (d > 30) {
    // An old date needs its year: "Dec 31" alone reads as last month.
    const sameYear =
      new Date(iso).toLocaleDateString("en-US", { year: "numeric", timeZone: "America/New_York" }) ===
      new Date().toLocaleDateString("en-US", { year: "numeric", timeZone: "America/New_York" });
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      ...(sameYear ? {} : { year: "numeric" }),
      timeZone: "America/New_York",
    });
  }
  return diff < 0 ? `${d}d ago` : `in ${d}d`;
}

// "2026-12-14" -> "Dec 14". Built from the calendar date itself, so it reads
// the same on the server and in any browser time zone.
function shortDay(dateIso: string, weekday = false): string {
  const d = new Date(`${dateIso.slice(0, 10)}T12:00:00`);
  if (isNaN(d.getTime())) return dateIso;
  return d.toLocaleDateString("en-US", { ...(weekday ? { weekday: "short" as const } : {}), month: "short", day: "numeric" });
}

// "14:30" -> "2:30 PM"
function clock(time: string | null | undefined): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

// SocialDesk's status words and colours.
const STATUS_WORDS: Record<string, { text: string; tone: string }> = {
  Approved: { text: "Approved", tone: "text-emerald-700" },
  Published: { text: "Published", tone: "text-violet-700" },
  Sent: { text: "Awaiting client review", tone: "text-yellow-700" },
  Pending: { text: "Awaiting AM review", tone: "text-blue-700" },
  Revision: { text: "Revision requested", tone: "text-rose-600" },
  Declined: { text: "Revision requested", tone: "text-rose-600" },
  Draft: { text: "Draft", tone: "text-muted-foreground" },
};

type Minimums = Record<string, { inFeed?: number; stories?: number }>;

export function SocialDeskTile({
  pulse,
  contractChannels,
}: {
  pulse: ContentPulse;
  // Monthly minimums from the client's contract (the Scope on this page).
  // Used ahead of the numbers typed into SocialDesk, which are often defaults.
  contractChannels?: { name: string; inFeed?: number; stories?: number }[];
}) {
  // Full-width on the client page: the two months sit side by side.
  // Only link into SocialDesk when THIS client exists there. Linking to
  // the generic SocialDesk root for unconnected clients was confusing —
  // felt like "it loaded the wrong client" rather than "this client
  // isn't in SocialDesk yet". For connected clients the link carries
  // SocialDesk's own route for the client (#/client/<id>). A plain
  // ?client=<id> is NOT enough: SocialDesk ignores it and reopens whichever
  // client the person viewed last (it opened Bertram's notebook from Tide
  // Homes' page).
  const connected = pulse.found && !!pulse.client_id;
  const clientUrl = connected
    ? `${SOCIALDESK_URL}/#/client/${pulse.client_id}`
    : null;
  // Deep-link straight into this client's notebook in SocialDesk.
  // The SocialDesk side reads ?nb=1 and auto-opens the notebook modal
  // on mount. Lets the AM jot social-media updates without first
  // navigating through the SocialDesk UI.
  const notebookUrl = connected
    ? `${SOCIALDESK_URL}/?nb=1#/client/${pulse.client_id}`
    : null;

  const upcoming = pulse.upcoming ?? [];
  const months = (pulse.months ?? []).filter((m) => m.total > 0);
  const fromContract: Minimums = Object.fromEntries(
    (contractChannels ?? [])
      .filter((c) => c.inFeed != null || c.stories != null)
      .map((c) => [c.name, { inFeed: c.inFeed, stories: c.stories }])
  );
  const minimums: Minimums = Object.keys(fromContract).length ? fromContract : (pulse.quotas ?? {});
  // The last post on each channel: whichever is later of the last one marked
  // as posted and the last approved one whose scheduled time has passed.
  const lastByChannel = (pulse.last_by_channel ?? [])
    .map((c) => {
      const posted = c.posted ? Date.parse(c.posted.at) : NaN;
      const passed = c.passed ? Date.parse(c.passed.at) : NaN;
      const unmarked = !isNaN(passed) && (isNaN(posted) || passed > posted);
      const pick = unmarked ? c.passed : c.posted;
      return pick ? { platform: c.platform, at: pick.at, type: pick.type, unmarked, count: unmarked ? c.passed_count : 0 } : null;
    })
    .filter((c): c is { platform: string; at: string; type: string | null; unmarked: boolean; count: number } => !!c)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const hasAnyPulse =
    lastByChannel.length > 0 || !!pulse.last_post || !!pulse.next_scheduled || upcoming.length > 0 || months.length > 0 ||
    pulse.awaiting_am_review > 0 || pulse.awaiting_client_review > 0;

  return (
    <Tile
      label="SocialDesk"
      icon={<Instagram className="h-3.5 w-3.5" />}
      href={clientUrl ?? undefined}
      hrefLabel={clientUrl ? "Open calendar" : undefined}
      hrefExternal
      spans={2}
    >
      {!pulse.found ? (
        <TileEmpty>
          {pulse.ok
            ? "Not connected to SocialDesk yet."
            : "Couldn't reach SocialDesk — refresh in a sec."}
        </TileEmpty>
      ) : !hasAnyPulse ? (
        <TileEmpty>Connected, but nothing is on the calendar for this month or next yet.</TileEmpty>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Last post out, next one due */}
          <div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-[auto_auto_1fr] md:gap-10">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Last posted</div>
              {lastByChannel.length > 0 ? (
                // One line per channel: the last post marked as out, or the
                // last approved post whose scheduled time has passed (the
                // hover says which).
                <ul className="mt-0.5 flex flex-col gap-0.5">
                  {lastByChannel.map((c) => (
                    <li key={c.platform} className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
                      <span className="w-[5.5rem] flex-shrink-0 text-muted-foreground">{c.platform}</span>
                      <span
                        className="font-medium text-foreground"
                        title={c.unmarked ? "The last approved post's scheduled time (not marked as posted in SocialDesk)" : undefined}
                      >
                        {relative(c.at)}
                      </span>
                      {c.type ? <span className="text-[11px] text-muted-foreground">{c.type}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <>
                  <div className="mt-0.5 text-sm font-medium text-foreground">
                    {pulse.last_post ? relative(pulse.last_post.at) : "None marked yet"}
                  </div>
                  {pulse.last_post ? (
                    <div className="text-[11px] text-muted-foreground">
                      {pulse.last_post.platform}
                      {pulse.last_post.type ? ` · ${pulse.last_post.type}` : ""}
                    </div>
                  ) : null}
                </>
              )}
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Next scheduled</div>
              <div className="mt-0.5 text-sm font-medium text-foreground">
                {pulse.next_scheduled ? relative(pulse.next_scheduled.at) : "Nothing queued"}
              </div>
              {pulse.next_scheduled ? (
                <div className="text-[11px] text-muted-foreground">
                  {pulse.next_scheduled.platform}
                  {pulse.next_scheduled.type ? ` · ${pulse.next_scheduled.type}` : ""}
                </div>
              ) : null}
            </div>
          </div>

          {/* This month and next month, always open, side by side on a wide screen */}
          {months.length > 0 ? (
            <div className="grid grid-cols-1 divide-y divide-border/60 rounded-md border border-border/60 bg-background/80 md:grid-cols-2 md:divide-x md:divide-y-0">
              {months.map((m) => (
                <MonthBlock key={`${m.year}-${m.month}`} m={m} quotas={minimums} />
              ))}
            </div>
          ) : null}

          {notebookUrl ? (
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={notebookUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:border-foreground/30 hover:bg-secondary"
              >
                <NotebookPen className="h-3 w-3 text-muted-foreground" />
                Open notebook
              </a>
            </div>
          ) : null}

          {/* The queue: one line, opens on tap */}
          {upcoming.length > 0 ? <QueueRow pulse={pulse} upcoming={upcoming} /> : null}
        </div>
      )}
    </Tile>
  );
}

// One verdict per month, most urgent first:
//   red     a revision was requested (back on us)
//   grey    still building (drafts, or fewer posts than the contract calls for)
//   blue    built, waiting on the AM's review
//   yellow  built and reviewed, in the client's hands
//   green   every post approved
type Verdict = { text: string; dot: string; tone: string };

function monthVerdict(m: MonthStatus, short: boolean): Verdict {
  if (m.revisions > 0) return { text: m.revisions === 1 ? "Revision requested" : `${m.revisions} revisions requested`, dot: "bg-rose-500", tone: "text-rose-600" };
  if (short || m.draft > 0) return { text: "Still building", dot: "bg-zinc-400", tone: "text-foreground/70" };
  if (m.awaiting_am > 0) return { text: "Awaiting AM review", dot: "bg-blue-500", tone: "text-blue-700" };
  if (m.awaiting_client > 0) return { text: "With the client", dot: "bg-yellow-400", tone: "text-yellow-700" };
  return { text: "All approved", dot: "bg-emerald-500", tone: "text-emerald-700" };
}

function MonthBlock({ m, quotas }: { m: MonthStatus; quotas: Minimums }) {
  const monthName = new Date(m.year, m.month - 1, 1, 12).toLocaleDateString("en-US", { month: "long" });
  // Channels with a contracted minimum, plus how many were built this month.
  const channels = Object.entries(quotas)
    .filter(([, q]) => q && (q.inFeed != null || q.stories != null))
    .map(([name, q]) => {
      const built = m.by_channel?.[name] ?? { inFeed: 0, stories: 0 };
      return {
        name,
        parts: [
          q.inFeed != null ? { label: "In-feed", done: built.inFeed, quota: q.inFeed } : null,
          q.stories != null ? { label: "Stories", done: built.stories, quota: q.stories } : null,
        ].filter((x): x is { label: string; done: number; quota: number } => !!x),
      };
    });
  const parts = channels.flatMap((c) => c.parts);
  const short = parts.some((p) => p.done < p.quota);
  // Across every channel: built toward the minimum (extra posts on one
  // channel do not make up for a gap on another).
  const owed = parts.reduce((n, p) => n + p.quota, 0);
  const built = parts.reduce((n, p) => n + Math.min(p.done, p.quota), 0);
  const verdict = monthVerdict(m, short);
  const waitingToPublish = Math.max(0, m.approved - m.posted);
  const where = [
    m.revisions ? { text: `${m.revisions} revision${m.revisions === 1 ? "" : "s"} requested`, tone: "text-rose-600 font-medium" } : null,
    m.posted ? { text: `${m.posted} published`, tone: "text-foreground/80" } : null,
    waitingToPublish ? { text: `${waitingToPublish} approved, waiting to publish`, tone: "text-foreground/80" } : null,
    m.awaiting_client ? { text: `${m.awaiting_client} awaiting client review`, tone: "text-yellow-700" } : null,
    m.awaiting_am ? { text: `${m.awaiting_am} awaiting AM review`, tone: "text-blue-700" } : null,
    m.draft ? { text: `${m.draft} draft${m.draft === 1 ? "" : "s"}`, tone: "text-muted-foreground" } : null,
  ].filter((x): x is { text: string; tone: string } => !!x);
  const pct = (n: number) => `${m.total > 0 ? (n / m.total) * 100 : 0}%`;
  const count = (p: { label: string; done: number; quota: number }) => (
    <span key={p.label} className={`tabular-nums ${p.done >= p.quota ? "text-emerald-700" : "text-foreground/80"}`}>
      {p.label} {p.done}/{p.quota}
    </span>
  );
  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-foreground">{monthName}</span>
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${verdict.tone}`}>
          <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${verdict.dot}`} />
          {verdict.text}
        </span>
      </div>

      {channels.length === 0 ? (
        <div className="mt-1.5 text-[11px] text-muted-foreground">
          {m.total} post{m.total === 1 ? "" : "s"} on the calendar
        </div>
      ) : channels.length === 1 ? (
        // One channel: the whole story fits on one line.
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 text-[11px]">
          <span className="text-muted-foreground">{channels[0].name}</span>
          {channels[0].parts.map(count)}
        </div>
      ) : (
        // Several channels: one line for the total, the channels behind a tap.
        <details className="group/ch mt-1.5 text-[11px]">
          <summary className="flex cursor-pointer list-none items-baseline gap-x-2 [&::-webkit-details-marker]:hidden">
            <span className={`tabular-nums ${built >= owed ? "text-emerald-700" : "text-foreground/80"}`}>
              {built} of {owed} contracted posts built
            </span>
            <span className="inline-flex items-center gap-0.5 text-muted-foreground">
              {channels.length} channels
              <ChevronDown className="h-3 w-3 transition-transform group-open/ch:rotate-180" />
            </span>
          </summary>
          <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-4 gap-y-0.5">
            {channels.map((c) => {
              const inFeed = c.parts.find((p) => p.label === "In-feed");
              const stories = c.parts.find((p) => p.label === "Stories");
              return (
                <div key={c.name} className="contents">
                  <span className="truncate text-muted-foreground">{c.name}</span>
                  <span className="text-right">{inFeed ? count(inFeed) : null}</span>
                  <span className="text-right">{stories ? count(stories) : null}</span>
                </div>
              );
            })}
          </div>
        </details>
      )}

      <div className="mt-1.5 flex h-1.5 w-full overflow-hidden rounded-full bg-secondary" aria-hidden>
        <span className="bg-rose-500" style={{ width: pct(m.revisions) }} />
        <span className="bg-emerald-600" style={{ width: pct(m.posted) }} />
        <span className="bg-emerald-400" style={{ width: pct(waitingToPublish) }} />
        <span className="bg-yellow-400" style={{ width: pct(m.awaiting_client) }} />
        <span className="bg-blue-500" style={{ width: pct(m.awaiting_am) }} />
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
        {where.map((w) => (
          <span key={w.text} className={w.tone}>
            {w.text}
          </span>
        ))}
      </div>
    </div>
  );
}

// The queue, folded: "Next up · 25 in the queue through Dec 31". Opens to the
// next five posts.
function QueueRow({ pulse, upcoming }: { pulse: ContentPulse; upcoming: UpcomingPost[] }) {
  const total = pulse.queued?.total ?? upcoming.length;
  const through = pulse.queued?.through ?? null;
  return (
    <details className="group/queue rounded-md border border-border/60 bg-background/80">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 transition-colors hover:bg-secondary/40 md:py-2.5 [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
          Next up
        </span>
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-xs text-muted-foreground">
            {total} in the queue{through ? ` through ${shortDay(through)}` : ""}
          </span>
          <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform group-open/queue:rotate-180" />
        </span>
      </summary>
      <div className="px-3 pb-3">
        <ul className="divide-y divide-border rounded-md border border-border bg-secondary/20">
          {upcoming.map((p) => (
            <UpcomingRow key={p.id} post={p} />
          ))}
        </ul>
        {total > upcoming.length ? (
          <div className="mt-2 text-[11px] text-muted-foreground">
            Showing the next {upcoming.length} of {total}. The rest are on the SocialDesk calendar.
          </div>
        ) : null}
      </div>
    </details>
  );
}

function UpcomingRow({ post }: { post: UpcomingPost }) {
  // Prefer the calendar date + Eastern time SocialDesk stores; older feeds
  // only send an instant.
  const fallback = new Date(post.at);
  const day = post.date
    ? shortDay(post.date, true)
    : fallback.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" });
  const time = post.date
    ? clock(post.time)
    : fallback.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
  const status = post.status ? (STATUS_WORDS[post.status] ?? { text: post.status, tone: "text-muted-foreground" }) : null;
  return (
    <li className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
      <div className="min-w-0 flex-1">
        <div className="truncate text-foreground">
          {post.platform}
          {post.type ? <span className="text-muted-foreground"> · {post.type}</span> : null}
        </div>
        {status ? <div className={`text-[11px] ${status.tone}`}>{status.text}</div> : null}
      </div>
      <div className="text-right text-muted-foreground">
        <div>{day}</div>
        {time ? <div className="text-[10px] tabular-nums">{time}</div> : null}
      </div>
    </li>
  );
}
