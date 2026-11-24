// Projects & briefs tile for the client profile: one list of the client's
// work, where each row is the Monday project and its brief together.
//
// A project on the Monday "All Projects" board and its brief in the Brief
// Tool are the same piece of work seen from two tools, so they share a row:
//
//   • the row is the Monday project (name, type, shoot date, status), with
//     the brief's link and revision count on it;
//   • opening the row shows the deliverables (Monday sub-items), each with a
//     way to ask for a revision, plus anything on the brief that has not
//     reached Monday yet;
//   • a brief that has no Monday project yet gets a row of its own, marked
//     "Not on Monday yet", so it is never out of sight.
//
// Buckets:
//   • Upcoming — a future shoot date, not finished
//   • In progress — active, no future shoot date
//   • Recently completed — up to 5, folded away unless nothing else is open
//
// "Project request" and "New brief" start new work in the Brief Tool.

import { Clapperboard, ExternalLink, FolderOpen, Pencil, ChevronDown, RefreshCw, FilePlus2, Plus, ArrowRight, Camera } from "lucide-react";
import { Tile, TileEmpty } from "./tile";
import { bucketProjects, type HubProject, type HubSubitem, type ProjectsForClient } from "@/lib/monday/projects";
import type { BriefsForClient, HubBrief, HubBriefDeliverable } from "@/lib/briefs/fetch";
import { easternToday } from "@/lib/scope/summary";
import { ProjectStatusPicker } from "./project-status-picker";
import { ProjectDateEditor } from "./project-date-editor";
import { UpdateInviteButton } from "./update-invite-button";
import { inviteNeedsUpdate, shootAhead } from "@/lib/briefs/invite";

const BRIEF_TOOL_URL = process.env.BRIEF_TOOL_URL ?? "https://briefs.surroundingsgroup.com";

// Team ops address for the calendar and travel quick requests.
const OPS_EMAIL = "operations@surroundingsgroup.com";

// A brief with no Monday project is only shown while it is live work: a
// shoot still ahead, or touched in the last 45 days (the same window the
// Brief Tool's own reminders use). Older ones stay one tap away in the tool.
const BRIEF_ONLY_DAYS = 45;

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

// What the Brief Tool knows about a project: its brief, and which Monday
// sub-item each deliverable is tied to (so a revision can be requested on it).
type BriefLinks = {
  byProject: Map<string, HubBrief>;
  reviseBySubitem: Map<string, { url: string; revisions: number }>;
  // Briefs that belong to a Monday project shown here (so they are not also
  // listed on their own).
  linked: Set<string>;
};

const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// "Amara Bay | November Professional Content Shoot" -> the part after the client.
const afterClient = (name: string) => (name.includes("|") ? name.slice(name.indexOf("|") + 1) : name);

// A brief belongs to a Monday project when the brief carries the project's
// id; failing that, when the project's own Brief link points at it; failing
// that, when the two have the same name.
function linkBriefs(briefs: HubBrief[], projects: HubProject[]): BriefLinks {
  const byProject = new Map<string, HubBrief>();
  const reviseBySubitem = new Map<string, { url: string; revisions: number }>();
  const linked = new Set<string>();
  const ids = new Set(projects.map((p) => p.id));
  for (const b of briefs) {
    if (b.monday_item_id && ids.has(String(b.monday_item_id)) && !byProject.has(String(b.monday_item_id))) {
      byProject.set(String(b.monday_item_id), b);
      linked.add(b.id);
    }
    for (const d of b.deliverables ?? []) {
      if (d.subitem_id) reviseBySubitem.set(String(d.subitem_id), { url: d.revise_url, revisions: d.revisions });
    }
  }
  for (const b of briefs) {
    if (linked.has(b.id) || b.monday_item_id) continue;
    const open = projects.filter((p) => !byProject.has(p.id));
    const match =
      open.find((p) => !!p.briefUrl && p.briefUrl.includes(b.id)) ??
      open.find((p) => plain(afterClient(p.name)) === plain(b.project) || plain(p.name) === plain(b.project));
    if (match) {
      byProject.set(match.id, b);
      linked.add(b.id);
    }
  }
  return { byProject, reviseBySubitem, linked };
}

function shortDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return isNaN(d.getTime()) ? null : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Task Status on Monday, in three quiet tones.
function statusTone(status: string | null): string {
  const t = (status ?? "").toLowerCase();
  if (/done|complete|approved|delivered|sent/.test(t)) return "text-emerald-700";
  if (/revision|stuck|hold|late/.test(t)) return "text-rose-600";
  if (!t) return "text-muted-foreground";
  return "text-foreground/80";
}

const KIND_LABEL: Record<HubBriefDeliverable["kind"], string> = {
  video: "Video",
  photo: "Photo",
  micro: "Micro",
  graphic: "Graphic",
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function RevisionLink({ url, revisions }: { url: string; revisions: number }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title="Open the revision form for this deliverable in the Brief Tool"
      className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 font-medium text-foreground transition-colors hover:bg-secondary"
    >
      <RefreshCw className="h-3 w-3" />
      Revision{revisions > 0 ? ` (${revisions})` : ""}
    </a>
  );
}

// ── Creative brief review ───────────────────────────────────────────────────
// Billy, 2026-11-23: every shoot gets a creative brief review with the AM and
// the creators, done no later than 24 hours before the shoot. The Brief tool
// keeps the Monday sub-item dated and owned (src/lib/brief-review.ts there);
// here it shows on the project's own line while the shoot is ahead, so it is
// seen without opening the row. It links to the sub-item on Monday, where it
// is marked Completed.
const REVIEW_URL = (id: string) => `https://nauticalnetwork.monday.com/boards/7006063086/pulses/${id}`;
const isReviewSub = (s: HubSubitem) => (s.taskType ?? "").trim().toLowerCase() === "creative brief review" || /^creative brief review\b/i.test(s.name.trim());
const isShootSub = (s: HubSubitem) => (s.taskType ?? "").trim().toLowerCase() === "content shoot";

type ReviewState = { state: "done" | "open" | "soon" | "overdue" | "missing"; text: string; href: string | null; title: string };

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function clock(hhmm: string | null | undefined): string {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h)) return "";
  return ` ${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
}

function briefReviewFor(p: HubProject, today: string): ReviewState | null {
  const subs = p.subitems ?? [];
  const nextShoot = subs.filter(isShootSub).map((s) => s.due).filter((d): d is string => !!d && d >= today).sort()[0];
  if (!nextShoot) return null; // only while a shoot is ahead
  const reviews = subs.filter(isReviewSub);
  const review = reviews.find((r) => !/^(completed|cache)$/i.test((r.status ?? "").trim())) ?? reviews[0];
  if (!review) return { state: "missing", text: "No brief review yet", href: null, title: "The Brief tool adds one within a few hours, due 24 hours before the shoot" };
  const who = review.owner ? `With ${review.owner}` : "No one assigned yet";
  if (/^(completed|cache)$/i.test((review.status ?? "").trim())) return { state: "done", text: "Brief reviewed", href: REVIEW_URL(review.id), title: who };
  if (!review.due) return { state: "open", text: "Brief review, no due date", href: REVIEW_URL(review.id), title: who };
  const when = review.due === today ? `today${clock(review.dueTime)}` : review.due === addDays(today, 1) ? `tomorrow${clock(review.dueTime)}` : shortDate(review.due) ?? review.due;
  if (review.due < today) return { state: "overdue", text: "Brief review overdue", href: REVIEW_URL(review.id), title: `${who}. Was due ${shortDate(review.due)}` };
  return { state: review.due <= addDays(today, 1) ? "soon" : "open", text: `Brief review due ${when}`, href: REVIEW_URL(review.id), title: `${who}. Mark it Completed on Monday once it is done` };
}

const REVIEW_TONE: Record<ReviewState["state"], string> = {
  done: "border-emerald-200 bg-emerald-50 text-emerald-800",
  open: "border-border bg-panel text-foreground/80",
  soon: "border-amber-200 bg-amber-50 text-amber-900",
  overdue: "border-red-200 bg-red-50 text-red-800",
  missing: "border-amber-200 bg-amber-50 text-amber-900",
};

function BriefReviewChip({ review }: { review: ReviewState }) {
  const cls = `inline-flex items-center rounded-full border px-1.5 py-px text-[10.5px] font-medium ${REVIEW_TONE[review.state]}`;
  return review.href ? (
    <a href={review.href} target="_blank" rel="noopener noreferrer" title={review.title} className={`${cls} hover:underline`}>
      {review.text}
    </a>
  ) : (
    <span title={review.title} className={cls}>
      {review.text}
    </span>
  );
}

// ── Which sub-items show ─────────────────────────────────────────────────────
// Billy, 2026-11-22: the list is for deliverables. Housekeeping steps (the
// creative brief review, uploading and organizing footage) never show in it;
// the content shoot does. The brief review has its own chip on the project
// line instead (above). And a deliverable shows once, as its newest version:
// "Main Video | 40 CC" and "Main Video | 40 CC (Revision 1 Internal)" are
// one row that opens the latest file, not a row per draft.
const HIDDEN_TASK_TYPES = new Set(["creative brief review", "project setup"]);
const HIDDEN_NAME = /^(creative brief review|upload and organize footage)\b/i;
const REVISION_SUFFIX = /\s*\((?:revision|rev)\.?\s*#?(\d+)(?:\s+(internal|external))?\)\s*$/i;

type ShownSub = HubSubitem & {
  revision: number; // 0 = the original
  ids: string[]; // every version's sub-item id
};

function shownSubitems(subitems: HubSubitem[]): ShownSub[] {
  const groups = new Map<string, { base: string; versions: { sub: HubSubitem; rev: number; at: number }[] }>();
  subitems.forEach((sub, at) => {
    if (HIDDEN_TASK_TYPES.has((sub.taskType ?? "").trim().toLowerCase()) || HIDDEN_NAME.test(sub.name.trim())) return;
    const m = sub.name.match(REVISION_SUFFIX);
    const base = (m ? sub.name.slice(0, m.index) : sub.name).trim();
    const key = plain(base);
    if (!groups.has(key)) groups.set(key, { base, versions: [] });
    groups.get(key)!.versions.push({ sub, rev: m ? Number(m[1]) : 0, at });
  });
  return [...groups.values()].map(({ base, versions }) => {
    // Newest version: the highest revision number, then the later one listed.
    const ordered = [...versions].sort((a, b) => b.rev - a.rev || b.at - a.at);
    const latest = ordered[0];
    // Open the newest version that actually has a file on it.
    const withFile = ordered.find((v) => !!v.sub.deliverableUrl);
    return {
      ...latest.sub,
      name: base,
      deliverableUrl: withFile?.sub.deliverableUrl ?? null,
      revision: latest.rev,
      ids: versions.map((v) => v.sub.id),
    };
  });
}

// Deliverables the brief lists that are not tied to one of the Monday
// sub-items shown above them.
function briefOnlyDeliverables(brief: HubBrief | undefined, subitems: HubSubitem[]): HubBriefDeliverable[] {
  if (!brief) return [];
  const shown = new Set(subitems.map((s) => s.id));
  return (brief.deliverables ?? []).filter((d) => !d.subitem_id || !shown.has(String(d.subitem_id)));
}

// Under a row: the Monday sub-items, then what is only on the brief so far,
// then the brief's own links.
function Deliverables({
  subitems,
  links,
  brief,
  brandName,
}: {
  subitems: HubSubitem[];
  links: BriefLinks;
  brief: HubBrief | undefined;
  brandName: string;
}) {
  const extra = briefOnlyDeliverables(brief, subitems);
  const shown = shownSubitems(subitems);
  return (
    <div className="flex flex-col gap-2 border-t border-border bg-background/60 px-3 pb-3 pt-2.5">
      {shown.length > 0 ? (
        <ul className="divide-y divide-border rounded-md border border-border bg-panel">
          {shown.map((sub) => {
            // The revision form is tied to whichever version the brief knows.
            const reviseId = sub.ids.find((id) => links.reviseBySubitem.has(id));
            const revise = reviseId ? links.reviseBySubitem.get(reviseId) : undefined;
            return (
              <li key={sub.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-2 text-xs">
                {sub.deliverableUrl ? (
                  // The name opens the deliverable itself (the link kept on Monday).
                  <a
                    href={sub.deliverableUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open the deliverable"
                    className="group/deliv inline-flex min-w-0 flex-1 items-center gap-1 font-medium text-foreground underline decoration-border underline-offset-2 transition-colors hover:decoration-foreground"
                  >
                    <span className="truncate">{sub.name}</span>
                    <ExternalLink className="h-3 w-3 flex-shrink-0 text-muted-foreground group-hover/deliv:text-foreground" />
                  </a>
                ) : (
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground">{sub.name}</span>
                )}
                <span className="flex flex-shrink-0 flex-wrap items-center gap-x-3 text-[11px] text-muted-foreground">
                  {sub.revision > 0 ? (
                    <span className="rounded-full border border-border px-1.5 py-px text-[10px] text-foreground/80" title="Showing the newest version of this deliverable">
                      Revision {sub.revision}
                    </span>
                  ) : null}
                  {sub.taskType ? <span>{sub.taskType}</span> : null}
                  {sub.owner ? <span>{sub.owner}</span> : null}
                  {shortDate(sub.due) ? <span>Due {shortDate(sub.due)}</span> : null}
                  <span className={statusTone(sub.status)}>{sub.status ?? "No status"}</span>
                  {revise ? <RevisionLink url={revise.url} revisions={revise.revisions} /> : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {extra.length > 0 ? (
        <div>
          {shown.length > 0 ? (
            <div className="mb-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              On the brief, not on Monday yet
            </div>
          ) : null}
          <ul className="divide-y divide-border rounded-md border border-border bg-panel">
            {extra.map((d) => (
              <li key={d.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-2 text-xs">
                <span className="w-12 flex-shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {KIND_LABEL[d.kind]}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">{d.title}</span>
                <span className="flex flex-shrink-0 items-center gap-x-3 text-[11px] text-muted-foreground">
                  {d.revisions > 0 && shortDate(d.last_revision_at) ? <span>Last revision {shortDate(d.last_revision_at)}</span> : null}
                  <RevisionLink url={d.revise_url} revisions={d.revisions} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {brief ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-medium text-muted-foreground">
          {brief.revisions_url ? (
            <a href={brief.revisions_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 transition-colors hover:text-foreground">
              Revision history
              <ArrowRight className="h-3 w-3" />
            </a>
          ) : null}
          <a href={calendarUpdateFor(brief, brandName)} className="transition-colors hover:text-foreground">
            Update calendar invite
          </a>
          <a href={travelRequestFor(brief, brandName)} className="transition-colors hover:text-foreground">
            Request travel
          </a>
        </div>
      ) : null}
    </div>
  );
}

// One piece of work: a Monday project (with its brief when there is one),
// or a brief that has no Monday project yet.
type Work = { key: string; p: HubProject; brief: HubBrief | undefined } | { key: string; p: null; brief: HubBrief };

function WorkRow({
  work,
  brandId,
  brandName,
  statusLabels,
  links,
}: {
  work: Work;
  brandId: string;
  brandName: string;
  statusLabels: string[];
  links: BriefLinks;
}) {
  const subitems = work.p?.subitems ?? [];
  const onBrief = briefOnlyDeliverables(work.brief, subitems).length;
  // Counted the way they are listed: one per deliverable, housekeeping left out.
  const count = shownSubitems(subitems).length || onBrief;
  const line = work.p ? (
    <ProjectLine p={work.p} brief={work.brief} brandId={brandId} statusLabels={statusLabels} count={count} />
  ) : (
    <BriefLine brief={work.brief} count={count} />
  );
  if (count > 0) {
    return (
      <li>
        <details className="group/project">
          <summary className="list-none [&::-webkit-details-marker]:hidden">{line}</summary>
          <Deliverables subitems={subitems} links={links} brief={work.brief} brandName={brandName} />
        </details>
      </li>
    );
  }
  return <li>{line}</li>;
}

function CountChevron({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="inline-flex items-center gap-0.5 font-medium text-foreground/80">
      · {plural(count, "deliverable")}
      <ChevronDown className="h-3 w-3 transition-transform group-open/project:rotate-180" />
    </span>
  );
}

// The way into a brief. Account managers come to this card to edit their
// briefs, so it is a real button on every row, not a small text link.
// A share link typed on Monday (read only) is swapped for the editor of the
// same brief; a link to anything else is opened as it is.
function briefLink(href: string): { href: string; inTool: boolean } {
  try {
    const u = new URL(href);
    const toolHosts = [new URL(BRIEF_TOOL_URL).hostname, "briefs.surroundingsgroup.com"];
    if (!toolHosts.includes(u.hostname)) return { href, inTool: false };
    const shared = u.pathname.match(/^\/share\/([^/]+)/);
    return { href: shared ? `${BRIEF_TOOL_URL}/briefs/${shared[1]}` : href, inTool: true };
  } catch {
    return { href, inTool: false };
  }
}

function BriefButton({ href }: { href: string }) {
  const link = briefLink(href);
  return (
    <a
      href={link.href}
      target="_blank"
      rel="noopener noreferrer"
      title={link.inTool ? "Open this brief in the Brief Tool to edit it" : "Open the brief linked on Monday"}
      className="tap-target inline-flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-foreground/25 bg-panel px-3 py-1.5 text-[12px] font-semibold text-foreground shadow-[0_1px_2px_rgba(16,10,0,0.06)] transition-colors hover:border-foreground hover:bg-foreground hover:text-background"
    >
      <Pencil className="h-3.5 w-3.5" />
      {link.inTool ? "Edit brief" : "Open brief"}
    </a>
  );
}

function ProjectLine({
  p,
  brief,
  brandId,
  statusLabels,
  count,
}: {
  p: HubProject;
  brief: HubBrief | undefined;
  brandId: string;
  statusLabels: string[];
  count: number;
}) {
  // The Brief Tool's own link when we have it; the link typed on Monday otherwise.
  const briefHref = brief?.url ?? p.briefUrl;
  const revisions = brief?.revision_count ?? 0;
  const today = easternToday();
  const review = briefReviewFor(p, today);
  // Who is on the shoot: Monday's Content Shoot owner, else the brief's list.
  const creators =
    p.subitems?.find((s) => s.taskType === "Content Shoot")?.owner ?? brief?.creators ?? null;
  // A shoot ahead with a calendar invite out gets "Update invite"; amber when
  // the invite no longer matches (creators or date changed since it was sent).
  const showInvite = Boolean(brief?.has_invite && brief && shootAhead(brief, today));
  const inviteStale = Boolean(brief && inviteNeedsUpdate(brief));
  return (
    <div className={`flex items-start justify-between gap-3 px-3 py-2.5 transition-colors hover:bg-secondary/60${count ? " cursor-pointer" : ""}`}>
      <div className="min-w-0 flex-1">
        <a
          href={p.mondayUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block truncate text-sm font-medium text-foreground hover:text-accent-foreground"
        >
          {p.name}
        </a>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {p.projectType ? <span>{p.projectType}</span> : null}
          <span className="inline-flex items-center gap-1">
            <span aria-hidden>·</span>
            <ProjectDateEditor brandId={brandId} projectId={p.id} projectName={p.name} currentIso={p.shootDateIso} />
          </span>
          {p.am ? <span>· {p.am}</span> : null}
          {creators && p.shootDateIso ? (
            <span className="inline-flex items-center gap-1" title="Creators on the shoot">
              <span aria-hidden>·</span>
              <Camera className="h-3 w-3" />
              {creators}
            </span>
          ) : null}
          {review ? <BriefReviewChip review={review} /> : null}
          {revisions > 0 ? <span>· {plural(revisions, "revision")}</span> : null}
          {p.dropboxUrl ? (
            <a
              href={p.dropboxUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-foreground/70 hover:text-foreground"
            >
              <FolderOpen className="h-3 w-3" />
              Files
            </a>
          ) : null}
          <CountChevron count={count} />
        </div>
      </div>
      <div className="flex flex-shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center sm:gap-2">
        <span className="order-1 sm:order-2">
          <ProjectStatusPicker brandId={brandId} projectId={p.id} projectName={p.name} currentStatus={p.status} labels={statusLabels} />
        </span>
        {briefHref ? (
          <span className="order-2 sm:order-1">
            <BriefButton href={briefHref} />
          </span>
        ) : null}
        {showInvite && brief ? (
          <span className="order-3 sm:order-first">
            <UpdateInviteButton briefId={brief.id} emphasize={inviteStale} />
          </span>
        ) : null}
      </div>
    </div>
  );
}

// A brief with no Monday project yet. Its status comes from the Brief Tool,
// since Monday has none for it.
function BriefLine({ brief, count }: { brief: HubBrief; count: number }) {
  const revisions = brief.revision_count ?? 0;
  return (
    <div className={`flex items-start justify-between gap-3 px-3 py-2.5 transition-colors hover:bg-secondary/60${count ? " cursor-pointer" : ""}`}>
      <div className="min-w-0 flex-1">
        <a
          href={brief.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block truncate text-sm font-medium text-foreground hover:text-accent-foreground"
        >
          {brief.project}
        </a>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>{brief.project_type ?? "Brief"}</span>
          {shortDate(brief.date) ? <span>· {shortDate(brief.date)}</span> : null}
          {revisions > 0 ? <span>· {plural(revisions, "revision")}</span> : null}
          <CountChevron count={count} />
        </div>
      </div>
      <div className="flex flex-shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center sm:gap-2">
        <div className="order-1 flex flex-col items-end gap-1 sm:order-2">
          <span className="rounded-full border border-border bg-panel px-2 py-0.5 text-[11px] font-medium capitalize text-foreground">
            {brief.status}
          </span>
          <span className="text-[10px] text-muted-foreground">Not on Monday yet</span>
        </div>
        <span className="order-2 sm:order-1">
          <BriefButton href={brief.url} />
        </span>
      </div>
    </div>
  );
}

function WorkSection({
  label,
  items,
  brandId,
  brandName,
  statusLabels,
  links,
}: {
  label: string;
  items: Work[];
  brandId: string;
  brandName: string;
  statusLabels: string[];
  links: BriefLinks;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
        <span className="ml-1.5 text-foreground/60">{items.length}</span>
      </div>
      <ul className="divide-y divide-border rounded-md border border-border bg-secondary/20">
        {items.map((w) => (
          <WorkRow key={w.key} work={w} brandId={brandId} brandName={brandName} statusLabels={statusLabels} links={links} />
        ))}
      </ul>
    </div>
  );
}

export function ProjectsTile({
  data,
  brandId,
  brandName,
  statusLabels,
  briefs,
}: {
  data: ProjectsForClient;
  brandId: string;
  brandName: string;
  statusLabels: string[];
  // This client's briefs from the Brief Tool.
  briefs: BriefsForClient;
}) {
  const allBriefs = briefs.briefs;
  const links = linkBriefs(allBriefs, data.projects);
  const { projects, ok } = data;
  const { upcoming, inFlight, recent } = bucketProjects(projects);
  const total = projects.length;
  const briefCount = allBriefs.length;

  const asWork = (p: HubProject): Work => ({ key: `p-${p.id}`, p, brief: links.byProject.get(p.id) });

  // Briefs with no Monday project yet, while they are live work.
  const today = easternToday();
  const cutoff = new Date(Date.now() - BRIEF_ONLY_DAYS * 86_400_000).toISOString();
  const briefOnly = allBriefs.filter(
    (b) =>
      !b.monday_item_id &&
      !links.linked.has(b.id) &&
      !/deliver|complete|archiv|cancel/i.test(b.status) &&
      ((b.date ?? "") >= today || b.updated_at >= cutoff)
  );
  const briefAhead = briefOnly.filter((b) => (b.date ?? "") >= today);
  const briefOpen = briefOnly.filter((b) => !((b.date ?? "") >= today));

  const upcomingWork: Work[] = [
    ...briefAhead.map((b): Work => ({ key: `b-${b.id}`, p: null, brief: b })),
    ...upcoming.slice(0, 5).map(asWork),
  ].sort((a, b) => {
    const da = a.p ? (a.p.shootDateIso ?? "") : (a.brief.date ?? "");
    const db = b.p ? (b.p.shootDateIso ?? "") : (b.brief.date ?? "");
    return da.slice(0, 10).localeCompare(db.slice(0, 10));
  });
  const openWork: Work[] = [...briefOpen.map((b): Work => ({ key: `b-${b.id}`, p: null, brief: b })), ...inFlight.slice(0, 5).map(asWork)];
  const nothingOpen = upcomingWork.length + openWork.length === 0;

  const boardUrl = `https://nauticalnetwork.monday.com/boards/${process.env.MONDAY_BOARD_ID_ALL_PROJECTS ?? ""}`;
  const encoded = encodeURIComponent(brandName);
  const clientUrl = `${BRIEF_TOOL_URL}/?client=${encoded}`;

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <a
        href={`${clientUrl}&request=1`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 rounded-md bg-foreground px-2.5 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90"
      >
        <FilePlus2 className="h-3 w-3" />
        Project request
      </a>
      <a
        href={`${clientUrl}&new=1`}
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
      label="Projects & briefs"
      icon={<Clapperboard className="h-3.5 w-3.5" />}
      href={boardUrl}
      hrefLabel={total > 0 ? `Open All Projects` : "Monday"}
      hrefExternal
      spans={2}
    >
      {total === 0 && briefOnly.length === 0 ? (
        <div className="flex flex-col gap-3">
          <TileEmpty>
            {ok ? "No projects on the All Projects board for this client yet." : "Couldn't reach Monday — refresh in a sec."}
          </TileEmpty>
          {actions}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <WorkSection links={links} label="Upcoming" items={upcomingWork} brandId={brandId} brandName={brandName} statusLabels={statusLabels} />
          <WorkSection links={links} label="In progress" items={openWork} brandId={brandId} brandName={brandName} statusLabels={statusLabels} />
          {recent.length > 0 ? (
            // Folded away while there is open work; shown when this is all there is.
            <details className="group/recent" open={nothingOpen}>
              <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground">
                {nothingOpen ? `Recently completed` : `View ${recent.length} recently completed →`}
                {nothingOpen ? <span className="ml-1.5 text-foreground/60">{recent.length}</span> : null}
              </summary>
              <div className="mt-2">
                <ul className="divide-y divide-border rounded-md border border-border bg-secondary/20">
                  {recent.map((p) => (
                    <WorkRow key={p.id} work={asWork(p)} brandId={brandId} brandName={brandName} statusLabels={statusLabels} links={links} />
                  ))}
                </ul>
              </div>
            </details>
          ) : null}
          {!briefs.ok ? (
            <div className="text-[11px] text-amber-700">
              Couldn&apos;t reach the Brief Tool, so briefs and revision links are missing for now.
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {plural(total, "project")} on the All Projects board
              {briefCount > 0 ? (
                <>
                  {" · "}
                  <a
                    href={clientUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-foreground transition-colors hover:text-accent-foreground"
                  >
                    {plural(briefCount, "brief")} in the Brief Tool
                    <ArrowRight className="h-3 w-3" />
                  </a>
                </>
              ) : null}
            </span>
            {actions}
          </div>
        </div>
      )}
    </Tile>
  );
}
