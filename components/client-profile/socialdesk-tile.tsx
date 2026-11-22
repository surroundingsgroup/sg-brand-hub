// SocialDesk pulse tile — pulls per-client content state from
// SocialDesk's /api/hub-pulse endpoint and renders:
//
//   • Last published post  — platform + relative time
//   • Next scheduled post  — platform + when
//   • Per-channel quota    — month-to-date vs. contracted min, per
//                            Instagram / Facebook / etc. (whichever
//                            channels the client has quotas on)
//
// Each row deep-links into SocialDesk for that client. "Not connected"
// renders cleanly for brands without a SocialDesk record (project-only
// clients, never-onboarded clients, etc.).

import { Instagram, Calendar, NotebookPen, Eye, RotateCcw } from "lucide-react";
import { Tile, TileEmpty } from "./tile";
import type { ContentPulse, UpcomingPost, MonthReview } from "@/lib/socialdesk/fetch";

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
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  }
  return diff < 0 ? `${d}d ago` : `in ${d}d`;
}

export function SocialDeskTile({ pulse }: { pulse: ContentPulse }) {
  // Only link into SocialDesk when THIS client exists there. Linking to
  // the generic SocialDesk root for unconnected clients was confusing —
  // felt like "it loaded the wrong client" rather than "this client
  // isn't in SocialDesk yet". For connected clients, ?client=<id>
  // auto-selects them in the calendar.
  const connected = pulse.found && !!pulse.client_id;
  const clientUrl = connected
    ? `${SOCIALDESK_URL}/?client=${pulse.client_id}`
    : null;
  // Deep-link straight into this client's notebook in SocialDesk.
  // The SocialDesk side reads ?nb=1 and auto-opens the notebook modal
  // on mount. Lets the AM jot social-media updates without first
  // navigating through the SocialDesk UI.
  const notebookUrl = connected
    ? `${SOCIALDESK_URL}/?client=${pulse.client_id}&nb=1`
    : null;

  const upcoming = pulse.upcoming ?? [];
  const hasAnyPulse =
    !!pulse.last_post || !!pulse.next_scheduled || upcoming.length > 0 ||
    pulse.awaiting_am_review > 0 || pulse.awaiting_client_review > 0;

  return (
    <Tile
      label="SocialDesk"
      icon={<Instagram className="h-3.5 w-3.5" />}
      href={clientUrl ?? undefined}
      hrefLabel={clientUrl ? "Open calendar" : undefined}
      hrefExternal
    >
      {!pulse.found ? (
        <TileEmpty>
          {pulse.ok
            ? "Not connected to SocialDesk yet."
            : "Couldn't reach SocialDesk — refresh in a sec."}
        </TileEmpty>
      ) : !hasAnyPulse ? (
        <TileEmpty>Connected, but no posts or quotas yet this month.</TileEmpty>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Awaiting-review banner — only renders when there's something
              demanding attention. Clicking it jumps to the client's
              SocialDesk calendar where the Pending posts live. */}
          {pulse.awaiting_am_review > 0 && clientUrl ? (
            <a
              href={clientUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-between gap-2 rounded-md bg-amber-100 px-3 py-2 text-xs text-amber-900 transition-colors hover:bg-amber-200"
            >
              <span className="font-medium">
                {pulse.awaiting_am_review} post{pulse.awaiting_am_review === 1 ? "" : "s"} awaiting your review
              </span>
              <span className="text-[11px] uppercase tracking-wide">Review →</span>
            </a>
          ) : null}
          {pulse.awaiting_client_review > 0 ? (
            <div className="inline-flex items-center justify-between gap-2 rounded-md bg-secondary px-3 py-2 text-xs text-foreground/80">
              <span>
                {pulse.awaiting_client_review} post{pulse.awaiting_client_review === 1 ? "" : "s"} with the client
              </span>
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Waiting on client</span>
            </div>
          ) : null}
          {/* Pulse rows */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Last posted
              </div>
              <div className="mt-0.5 text-sm font-medium text-foreground">
                {pulse.last_post ? relative(pulse.last_post.at) : "No posts yet"}
              </div>
              {pulse.last_post ? (
                <div className="text-[11px] text-muted-foreground">
                  {pulse.last_post.platform}
                  {pulse.last_post.type ? ` · ${pulse.last_post.type}` : ""}
                </div>
              ) : null}
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Next scheduled
              </div>
              <div className="mt-0.5 text-sm font-medium text-foreground">
                {pulse.next_scheduled
                  ? relative(pulse.next_scheduled.at)
                  : "Nothing queued"}
              </div>
              {pulse.next_scheduled ? (
                <div className="text-[11px] text-muted-foreground">
                  {pulse.next_scheduled.platform}
                  {pulse.next_scheduled.type
                    ? ` · ${pulse.next_scheduled.type}`
                    : ""}
                </div>
              ) : null}
            </div>
          </div>

          {/* Per-month review breakdown — the "where are they with us"
              view Billy wants. Current month + next month, each showing
              awaiting-review and revisions-requested counts. Dropped
              the approved-by-client stat per his call. */}
          <ReviewByMonth pulse={pulse} />

          {/* Deep-link quick-actions — calendar and notebook. */}
          {notebookUrl ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
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

          {/* Upcoming — next 5 within 2 weeks. Quota meters live in the
              Scope tile (same numbers) so we don't duplicate them here. */}
          {upcoming.length > 0 ? (
            <div>
              <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                <Calendar className="h-3 w-3" />
                Next up
              </div>
              <ul className="divide-y divide-border rounded-md border border-border bg-secondary/20">
                {upcoming.map((p) => (
                  <UpcomingRow key={p.id} post={p} />
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </Tile>
  );
}

// Per-month review breakdown. For each of CURRENT and NEXT month, shows:
//   • how many posts are awaiting client review (needs their sign-off)
//   • how many posts have revisions requested (back on us)
// Nothing visible when both are zero across both months — no need to
// show 0s on a client with a clean calendar.
function ReviewByMonth({ pulse }: { pulse: ContentPulse }) {
  const cur = pulse.review_by_month.current;
  const nxt = pulse.review_by_month.next;
  const anyActivity =
    cur.awaiting_review + cur.revisions + nxt.awaiting_review + nxt.revisions > 0;
  if (!anyActivity) {
    return (
      <div className="flex items-center justify-between rounded-md border border-border/60 bg-secondary/20 px-3 py-2 text-[11px] text-muted-foreground">
        <span>Review queue</span>
        <span>No posts awaiting review</span>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      <MonthCard label="This month" m={cur} />
      <MonthCard label="Next month" m={nxt} />
    </div>
  );
}

function MonthCard({ label, m }: { label: string; m: MonthReview }) {
  const monthName = new Date(m.year, m.month - 1, 1).toLocaleDateString("en-US", {
    month: "short",
  });
  return (
    <div className="rounded-md border border-border/60 bg-background/80 px-3 py-2.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {monthName}
        </span>
      </div>
      <div className="mt-2 flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-[11px] text-foreground/80">
            <Eye className="h-3 w-3 text-muted-foreground" />
            Awaiting review
          </span>
          <span
            className={`text-[15px] font-semibold tabular-nums ${m.awaiting_review > 0 ? "text-amber-700" : "text-muted-foreground"}`}
          >
            {m.awaiting_review}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-[11px] text-foreground/80">
            <RotateCcw className="h-3 w-3 text-muted-foreground" />
            Revisions
          </span>
          <span
            className={`text-[15px] font-semibold tabular-nums ${m.revisions > 0 ? "text-rose-700" : "text-muted-foreground"}`}
          >
            {m.revisions}
          </span>
        </div>
      </div>
    </div>
  );
}

function UpcomingRow({ post }: { post: UpcomingPost }) {
  const d = new Date(post.at);
  const day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return (
    <li className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
      <div className="min-w-0 flex-1">
        <div className="truncate text-foreground">
          {post.platform}
          {post.type ? <span className="text-muted-foreground"> · {post.type}</span> : null}
        </div>
        {post.status ? (
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {post.status}
          </div>
        ) : null}
      </div>
      <div className="text-right text-muted-foreground">
        <div>{day}</div>
        <div className="text-[10px] tabular-nums">{time}</div>
      </div>
    </li>
  );
}

