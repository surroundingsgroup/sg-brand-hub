// "Needs you" summary bar — the one-line answer to "what does this
// client want from me today?". Lives between the hero and the tile
// grid so it's the first thing the AM reads.
//
// Each callout is derived from data the page already fetched (zero
// extra network calls):
//   • Upcoming shoot this week (next 7 days from Monday All Projects)
//   • Posts awaiting AM review (from SocialDesk pulse)
//   • Briefs in a "ready" status (from the Brief Tool feed)
//   • Renewal date within 60 days (from scope)
//
// Nothing to flag? → "All clear" state, which is intentionally quiet.

import Link from "next/link";
import { CalendarCheck, Instagram, Sparkles, AlarmClock, CheckCircle2, Receipt } from "lucide-react";
import type { HubBrief } from "@/lib/briefs/fetch";
import type { HubProject } from "@/lib/monday/projects";
import type { ContentPulse } from "@/lib/socialdesk/fetch";
import type { BrandScope } from "@/lib/scope/types";

type Callout = {
  tone: "warn" | "info" | "ok";
  icon: React.ReactNode;
  label: string;
  detail?: string;
  href?: string;
  external?: boolean;
};

export function NeedsYouBar({
  projects,
  pulse,
  briefs,
  scope,
  socialdeskClientUrl,
  overdueInvoices,
  clientBoardUrl,
}: {
  projects: HubProject[];
  pulse: ContentPulse;
  briefs: HubBrief[];
  scope: BrandScope | null;
  socialdeskClientUrl: string | null;
  overdueInvoices: number;
  clientBoardUrl: string | null;
}) {
  const now = Date.now();
  const weekOut = now + 7 * 86400 * 1000;

  const callouts: Callout[] = [];

  // Shoots in the next 7 days
  const upcomingThisWeek = projects.filter((p) => {
    if (!p.shootDateIso) return false;
    const t = new Date(p.shootDateIso).getTime();
    return !isNaN(t) && t >= now && t <= weekOut;
  });
  if (upcomingThisWeek.length > 0) {
    const next = upcomingThisWeek[0];
    const nextDate = new Date(next.shootDateIso!).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    callouts.push({
      tone: "info",
      icon: <CalendarCheck className="h-3.5 w-3.5" />,
      label:
        upcomingThisWeek.length === 1
          ? `Shoot ${nextDate}`
          : `${upcomingThisWeek.length} shoots this week`,
      detail: next.name,
      href: next.mondayUrl,
      external: true,
    });
  }

  // Overdue invoices — $$$ first
  if (overdueInvoices > 0) {
    callouts.push({
      tone: "warn",
      icon: <Receipt className="h-3.5 w-3.5" />,
      label: `${overdueInvoices} invoice${overdueInvoices === 1 ? "" : "s"} overdue`,
      detail: "Invoicing",
      href: clientBoardUrl ?? undefined,
      external: true,
    });
  }

  // Posts awaiting AM review
  if (pulse.awaiting_am_review > 0) {
    callouts.push({
      tone: "warn",
      icon: <Instagram className="h-3.5 w-3.5" />,
      label: `${pulse.awaiting_am_review} post${pulse.awaiting_am_review === 1 ? "" : "s"} awaiting review`,
      detail: "SocialDesk",
      href: socialdeskClientUrl ?? undefined,
      external: true,
    });
  }

  // Briefs in a "ready" status
  const readyBriefs = briefs.filter((b) => /ready/i.test(b.status));
  if (readyBriefs.length > 0) {
    callouts.push({
      tone: "info",
      icon: <Sparkles className="h-3.5 w-3.5" />,
      label: `${readyBriefs.length} brief${readyBriefs.length === 1 ? "" : "s"} ready`,
      detail: readyBriefs[0].project,
      href: readyBriefs[0].url,
      external: true,
    });
  }

  // Renewal within 60 days
  if (scope?.renewal_date) {
    const t = new Date(scope.renewal_date + "T12:00:00").getTime();
    const days = Math.round((t - now) / 86400000);
    if (!isNaN(days) && days <= 60 && days >= -30) {
      callouts.push({
        tone: days < 0 ? "warn" : days <= 14 ? "warn" : "info",
        icon: <AlarmClock className="h-3.5 w-3.5" />,
        label:
          days < 0
            ? `Renewal overdue ${Math.abs(days)}d`
            : days === 0
              ? "Renewal today"
              : `Renewal in ${days}d`,
        detail: new Date(scope.renewal_date + "T12:00:00").toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
      });
    }
  }

  if (callouts.length === 0) {
    return (
      <div className="mb-6 flex items-center gap-2 rounded-xl bg-panel px-4 py-3 text-xs text-muted-foreground shadow-panel">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
        All clear — nothing urgent for this client right now.
      </div>
    );
  }

  return (
    <div className="mb-6 flex flex-wrap items-stretch gap-2 rounded-xl bg-panel px-3 py-3 shadow-panel">
      <div className="hidden items-center gap-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground md:flex">
        Needs you
      </div>
      {callouts.map((c, i) => {
        const classes = {
          warn: "bg-amber-100 text-amber-900 hover:bg-amber-200",
          info: "bg-accent-soft text-accent-foreground hover:bg-accent/30",
          ok: "bg-emerald-100 text-emerald-900 hover:bg-emerald-200",
        }[c.tone];
        const inner = (
          <>
            <span className="opacity-70">{c.icon}</span>
            <span className="text-xs font-medium">{c.label}</span>
            {c.detail ? (
              <span className="hidden truncate text-[11px] opacity-70 sm:inline">
                · {c.detail}
              </span>
            ) : null}
          </>
        );
        const key = `${c.label}-${i}`;
        const className = `inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors ${classes}`;
        if (!c.href) {
          return (
            <div key={key} className={className}>
              {inner}
            </div>
          );
        }
        return c.external ? (
          <a
            key={key}
            href={c.href}
            target="_blank"
            rel="noopener noreferrer"
            className={className}
          >
            {inner}
          </a>
        ) : (
          <Link key={key} href={c.href} className={className}>
            {inner}
          </Link>
        );
      })}
    </div>
  );
}
