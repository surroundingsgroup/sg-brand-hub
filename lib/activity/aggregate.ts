// Fold every "something happened for this client" signal we already
// have into a single reverse-chronological timeline for the client
// profile's Activity tile. Everything we need is already in flight from
// other tiles — this just normalizes the shapes into one list.
//
// Zero extra network calls: the parent page passes the data it fetched
// for the Brand / Briefs / Projects / SocialDesk tiles plus the brand's
// own activity log, and we reduce.

import type { HubBrief } from "@/lib/briefs/fetch";
import type { HubProject } from "@/lib/monday/projects";
import type { ContentPulse } from "@/lib/socialdesk/fetch";

export type ActivityKind =
  | "intake_submitted"
  | "brand_edit"
  | "brand_approved"
  | "brand_archived"
  | "brief_update"
  | "monday_update"
  | "social_post";

export type ActivityItem = {
  at: string;
  kind: ActivityKind;
  title: string;
  detail?: string;
  href?: string;
  external?: boolean;
};

type BrandActivityRow = {
  event_type: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

const WINDOW_DAYS = 14;

export function aggregateActivity(input: {
  brandActivity: BrandActivityRow[];
  briefs: HubBrief[];
  projects: HubProject[];
  pulse: ContentPulse;
  briefToolBase: string;
}): ActivityItem[] {
  const cutoff = Date.now() - WINDOW_DAYS * 86400 * 1000;
  const items: ActivityItem[] = [];

  // Brand Hub: activity log entries
  for (const row of input.brandActivity) {
    const ts = new Date(row.created_at).getTime();
    if (isNaN(ts) || ts < cutoff) continue;

    const evt = row.event_type ?? "";
    const meta = row.metadata ?? {};
    if (evt === "submitted") {
      items.push({
        at: row.created_at,
        kind: "intake_submitted",
        title: "Intake submitted",
        detail:
          typeof meta.submitter === "string"
            ? `by ${meta.submitter}`
            : "via the public intake form",
      });
    } else if (evt === "approved") {
      items.push({
        at: row.created_at,
        kind: "brand_approved",
        title: "Brand approved",
      });
    } else if (evt === "archived") {
      items.push({
        at: row.created_at,
        kind: "brand_archived",
        title: "Brand archived",
      });
    } else if (evt === "edited") {
      const fields = Array.isArray(meta.fields) ? (meta.fields as string[]) : [];
      items.push({
        at: row.created_at,
        kind: "brand_edit",
        title: fields.length
          ? `Updated ${fields.slice(0, 3).join(", ")}${fields.length > 3 ? "…" : ""}`
          : "Brand updated",
      });
    } else {
      // Unknown event — surface it anyway so we don't lose signal.
      items.push({
        at: row.created_at,
        kind: "brand_edit",
        title: `Event · ${evt}`,
      });
    }
  }

  // Brief Tool: recently updated briefs
  for (const b of input.briefs) {
    const ts = new Date(b.updated_at).getTime();
    if (isNaN(ts) || ts < cutoff) continue;
    const createdTs = new Date(b.created_at).getTime();
    const isNew = createdTs >= cutoff && Math.abs(ts - createdTs) < 60_000;
    items.push({
      at: b.updated_at,
      kind: "brief_update",
      title: isNew ? `Brief created · ${b.project}` : `Brief updated · ${b.project}`,
      detail: b.project_type ? `${b.project_type} · ${b.status}` : b.status,
      href: b.url,
      external: true,
    });
  }

  // Monday: projects whose Monday row was touched recently
  for (const p of input.projects) {
    const ts = new Date(p.updatedAt).getTime();
    if (isNaN(ts) || ts < cutoff) continue;
    items.push({
      at: p.updatedAt,
      kind: "monday_update",
      title: `Project · ${p.name}`,
      detail: [p.projectType, p.status].filter(Boolean).join(" · "),
      href: p.mondayUrl,
      external: true,
    });
  }

  // SocialDesk: the most recently published post (one event).
  if (input.pulse.found && input.pulse.last_post) {
    const ts = new Date(input.pulse.last_post.at).getTime();
    if (!isNaN(ts) && ts >= cutoff) {
      items.push({
        at: input.pulse.last_post.at,
        kind: "social_post",
        title: `Posted to ${input.pulse.last_post.platform}`,
        detail: input.pulse.last_post.type ?? undefined,
      });
    }
  }

  // Newest first, cap at 15 so the tile stays compact.
  items.sort((a, b) => b.at.localeCompare(a.at));
  return items.slice(0, 15);
}
