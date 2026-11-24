// When a shoot's calendar invite needs another send, and which creator change
// to tell the team about. Pure helpers over the Brief tool feed (HubBrief).

import type { CreatorChange, HubBrief } from "./fetch";

const DAY = 86_400_000;

/** The shoot is today or later (Eastern dates compared as strings). */
export function shootAhead(brief: HubBrief, today: string): boolean {
  return Boolean(brief.date && brief.date >= today);
}

/** The newest creator change, if it happened in the last `days` days. */
export function recentCreatorChange(brief: HubBrief, days = 3): CreatorChange | null {
  const last = brief.creator_changes?.at(-1);
  if (!last) return null;
  const t = Date.parse(last.at);
  return Number.isFinite(t) && Date.now() - t <= days * DAY ? last : null;
}

/** An invite is out but no longer matches the shoot (creators or dates changed since it was sent). */
export function inviteNeedsUpdate(brief: HubBrief): boolean {
  if (!brief.has_invite) return false;
  if (brief.invite_stale) return true;
  const last = brief.creator_changes?.at(-1);
  if (!last) return false;
  return !brief.invite_sent_at || Date.parse(brief.invite_sent_at) < Date.parse(last.at);
}

/** "Austin Tompkins, Kyle Daniels" -> "Austin and Kyle" for short notices. */
export function firstNames(names: string): string {
  const list = names.split(",").map((n) => n.trim().split(/\s+/)[0]).filter(Boolean);
  if (list.length <= 1) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}
