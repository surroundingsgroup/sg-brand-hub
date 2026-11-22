// Activity feed — unified "last 14 days" timeline for one client. Reads
// from the aggregated list the parent builds; no data fetching here.
//
// Tiles across the page handle the heavy lifting (Projects, Briefs,
// SocialDesk) and the Activity feed stitches them together so an AM
// returning after a week can see at a glance: "we approved the brand,
// shot the Happy Hour, the brief got updated twice, three posts went
// out, next shoot is Friday."

import { ArrowUpRight, FileCheck, FileEdit, Clapperboard, Instagram, Inbox, Sparkles } from "lucide-react";
import { Tile, TileEmpty } from "./tile";
import type { ActivityItem } from "@/lib/activity/aggregate";

function iconFor(kind: ActivityItem["kind"]) {
  switch (kind) {
    case "intake_submitted":
      return <Inbox className="h-3.5 w-3.5" />;
    case "brand_approved":
      return <FileCheck className="h-3.5 w-3.5" />;
    case "brand_archived":
      return <FileCheck className="h-3.5 w-3.5 opacity-50" />;
    case "brand_edit":
      return <FileEdit className="h-3.5 w-3.5" />;
    case "brief_update":
      return <Sparkles className="h-3.5 w-3.5" />;
    case "monday_update":
      return <Clapperboard className="h-3.5 w-3.5" />;
    case "social_post":
      return <Instagram className="h-3.5 w-3.5" />;
  }
}

function relative(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const abs = Math.abs(diff);
  const dayMs = 86400 * 1000;
  if (abs < 3600 * 1000) {
    const m = Math.max(1, Math.round(abs / 60000));
    return `${m}m ago`;
  }
  if (abs < dayMs) {
    const h = Math.round(abs / (3600 * 1000));
    return `${h}h ago`;
  }
  const d = Math.round(abs / dayMs);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function ActivityFeedTile({ items }: { items: ActivityItem[] }) {
  return (
    <Tile label="Activity · last 14 days" icon={<FileEdit className="h-3.5 w-3.5" />} spans={2}>
      {items.length === 0 ? (
        <TileEmpty>
          Nothing has changed for this client in the last two weeks.
        </TileEmpty>
      ) : (
        <ol className="relative ml-2 border-l border-border">
          {items.map((it, i) => (
            <li key={`${it.at}-${i}`} className="relative py-2 pl-5">
              <span className="absolute -left-[7px] top-3 flex h-3 w-3 items-center justify-center rounded-full bg-accent-soft text-accent-foreground ring-2 ring-panel">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              </span>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    <span className="text-muted-foreground">{iconFor(it.kind)}</span>
                    {it.href ? (
                      <a
                        href={it.href}
                        target={it.external ? "_blank" : undefined}
                        rel={it.external ? "noopener noreferrer" : undefined}
                        className="inline-flex items-center gap-0.5 hover:text-accent-foreground"
                      >
                        {it.title}
                        {it.external ? <ArrowUpRight className="h-3 w-3" /> : null}
                      </a>
                    ) : (
                      <span>{it.title}</span>
                    )}
                  </div>
                  {it.detail ? (
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {it.detail}
                    </div>
                  ) : null}
                </div>
                <div className="flex-shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">
                  {relative(it.at)}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Tile>
  );
}
