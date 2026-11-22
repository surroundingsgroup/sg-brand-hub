// Briefs tile for the client profile — pulls briefs from the Brief Tool
// API and renders a compact list of the most recent ones. Clicking a
// brief deep-links to the Brief Tool editor; the "New brief" button
// deep-links to the Brief Tool's new-brief flow with the client name
// pre-stamped so the AM lands in the right record.
//
// Rendered from the client profile server component, so this does its
// own data fetch — no loading state needed, errors fall back to a
// "couldn't reach Brief Tool" inline note.

import { Sparkles, Plus, FilePlus2, ArrowRight, CalendarClock, Plane } from "lucide-react";
import { Tile } from "./tile";
import type { BriefsForClient, HubBrief } from "@/lib/briefs/fetch";

const BRIEF_TOOL_URL =
  process.env.BRIEF_TOOL_URL ?? "https://briefs.surroundingsgroup.com";

// Team ops addresses — the mailto quick-actions route here. Centralised
// so one edit updates every tile that fires an ops email.
const OPS_EMAIL = "operations@surroundingsgroup.com";

function calendarUpdateFor(brief: HubBrief, brandName: string): string {
  return `mailto:${OPS_EMAIL}?subject=${encodeURIComponent(
    `Calendar update — ${brandName} · ${brief.project}`
  )}&body=${encodeURIComponent(
    `Hey team,\n\nPlease update the calendar invite for this brief:\n\nBrand: ${brandName}\nProject: ${brief.project}\nBrief: ${brief.url}\n\n• New date/time:\n• Attendees to add/remove:\n\nThanks.`
  )}`;
}

function travelRequestFor(brief: HubBrief, brandName: string): string {
  return `mailto:${OPS_EMAIL}?subject=${encodeURIComponent(
    `Travel request — ${brandName} · ${brief.project}`
  )}&body=${encodeURIComponent(
    `Hey team,\n\nTravel needed for:\n\nBrand: ${brandName}\nProject: ${brief.project}\nBrief: ${brief.url}\n\n• Shoot date:\n• Location:\n• Travelers:\n• Notes:\n\nThanks.`
  )}`;
}

function formatBriefDate(iso: string | null): string | null {
  if (!iso) return null;
  // Date-only ISO (YYYY-MM-DD) from the brief → "Nov 19". If a full
  // timestamp sneaks through, slice the date part first.
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function BriefsTile({ brandName, data }: { brandName: string; data: BriefsForClient }) {
  const result = data;
  const briefs = result.briefs.slice(0, 5);
  const totalBriefs = result.briefs.length;
  const extraBriefs = Math.max(0, totalBriefs - briefs.length);

  const encoded = encodeURIComponent(brandName);
  // Deep-links into the Brief Tool. The dashboard already honors
  // ?client= to filter; ?request=1 is new (handled on the Brief Tool
  // page.tsx) and auto-opens the Project Request modal on mount.
  const clientUrl = `${BRIEF_TOOL_URL}/?client=${encoded}`;
  const newBriefUrl = `${BRIEF_TOOL_URL}/?client=${encoded}&new=1`;
  const projectRequestUrl = `${BRIEF_TOOL_URL}/?client=${encoded}&request=1`;

  const actionsRow = (
    <div className="flex flex-wrap items-center gap-2">
      <a
        href={projectRequestUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 rounded-md bg-foreground px-2.5 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90"
      >
        <FilePlus2 className="h-3 w-3" />
        Project request
      </a>
      <a
        href={newBriefUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 rounded-md border border-border bg-panel px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
      >
        <Plus className="h-3 w-3" />
        New brief
      </a>
    </div>
  );

  return (
    <Tile
      label="Briefs"
      icon={<Sparkles className="h-3.5 w-3.5" />}
      href={clientUrl}
      hrefLabel={totalBriefs > 0 ? `See all ${totalBriefs}` : "Brief Tool"}
      hrefExternal
      spans={2}
    >
      <div className="flex flex-col gap-3">
        {briefs.length === 0 ? (
          <div className="flex flex-col gap-3 rounded-md border border-dashed border-border bg-secondary/30 p-4">
            <p className="text-xs text-muted-foreground">
              {result.ok
                ? "No briefs yet for this client."
                : "Couldn't reach the Brief Tool — refresh in a sec."}
            </p>
            {actionsRow}
          </div>
        ) : (
          <>
            <ul className="divide-y divide-border rounded-md border border-border bg-secondary/20">
              {briefs.map((b) => (
                <li key={b.id}>
                  <div className="flex items-center justify-between gap-3 px-3 py-2.5 transition-colors hover:bg-secondary/60">
                    <a
                      href={b.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-w-0 flex-1"
                    >
                      <div className="truncate text-sm font-medium text-foreground">
                        {b.project}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {b.project_type ?? "Brief"}
                        {formatBriefDate(b.date) ? ` · ${formatBriefDate(b.date)}` : null}
                        {` · ${b.status}`}
                      </div>
                    </a>
                    {/* Per-brief quick actions. Hidden until hover so
                        the list stays clean at rest; icon-only to keep
                        the row compact. */}
                    <div className="flex flex-shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover/tile:opacity-100">
                      <a
                        href={calendarUpdateFor(b, brandName)}
                        title="Update calendar invite for this brief"
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                      >
                        <CalendarClock className="h-3.5 w-3.5" />
                      </a>
                      <a
                        href={travelRequestFor(b, brandName)}
                        title="Request travel for this brief"
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                      >
                        <Plane className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              {extraBriefs > 0 ? (
                <a
                  href={clientUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-foreground transition-colors hover:text-accent-foreground"
                >
                  See all {totalBriefs} briefs
                  <ArrowRight className="h-3 w-3" />
                </a>
              ) : (
                <span>
                  {totalBriefs} brief{totalBriefs === 1 ? "" : "s"} total
                </span>
              )}
              {actionsRow}
            </div>
          </>
        )}
      </div>
    </Tile>
  );
}
