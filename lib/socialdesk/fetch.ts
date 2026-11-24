// Fetch a client's content-pulse summary from SocialDesk.
//
// SocialDesk exposes GET /api/hub-pulse?client_name=X, bearer-guarded by
// SOCIALDESK_HUB_API_TOKEN. SocialDesk's client set isn't 1:1 with the
// Hub's — some clients (project-only, no social retainer) legitimately
// have no SocialDesk record. `found: false` is the normal empty state,
// not an error.
//
// Fails soft like the Brief Tool fetch: any transport error returns the
// empty shape so the rest of the profile page keeps rendering.

export type PulseEvent = {
  platform: string;
  type: string | null;
  at: string;
};

// The last post on one channel. SocialDesk only knows a post went out when
// it published it itself or somebody marked it as posted, so there are two
// facts: `posted` (marked as out) and `passed` (approved, its scheduled time
// has gone by since then, never marked).
export type ChannelLast = {
  platform: string;
  posted: { type: string | null; at: string } | null;
  passed: { type: string | null; at: string } | null;
  passed_count: number;
};

// One calendar month of posts approved (or already out) per channel, since
// the contract term began. `built` is everything on that month's calendar.
export type SocialMonth = {
  year: number;
  month: number; // 1-12
  built: number;
  by_channel: Record<string, { inFeed: number; stories: number }>;
};

export type UpcomingPost = {
  id: string;
  platform: string;
  type: string | null;
  status: string | null;
  at: string;
  // Calendar date + Eastern wall-clock time as SocialDesk stores them, so the
  // tile can print them without converting time zones.
  date?: string; // YYYY-MM-DD
  time?: string | null; // HH:MM, null when the post has no time yet
};

// Where one month's posts stand. `total` leaves out declined posts.
export type MonthStatus = {
  year: number;
  month: number; // 1-indexed
  total: number;
  approved: number;
  posted: number; // already out (a subset of approved)
  awaiting_client: number;
  awaiting_am: number;
  revisions: number;
  draft: number;
  declined: number;
  // Built per channel this month (in-feed / stories), to set against the quota.
  by_channel?: Record<string, ChannelCounts>;
};

// Everything dated today or later that hasn't gone out.
export type QueueSummary = {
  total: number;
  approved: number;
  through: string | null; // YYYY-MM-DD of the last queued post
};

export type ChannelCounts = {
  inFeed: number;
  stories: number;
};

export type ChannelQuota = {
  inFeed?: number;
  stories?: number;
};

export type PipelineCounts = {
  approved: number;
  draft: number;
  pending_am: number;
  client_review: number;
  revisions: number;
  published: number;
  declined: number;
  total: number;
};

export type MonthReview = {
  year: number;
  month: number; // 1-indexed on the Hub side
  awaiting_review: number;
  revisions: number;
  total: number;
};

export type ReviewByMonth = {
  current: MonthReview;
  next: MonthReview;
};

export type ContentPulse = {
  found: boolean;
  client_id: string | null;
  client_name: string | null;
  /** Social accounts connected for publishing, and whether each token is live (added 2026-11-24). */
  connections: { platform: string; ok: boolean }[];
  last_post: PulseEvent | null;
  next_scheduled: PulseEvent | null;
  last_by_channel: ChannelLast[];
  history: SocialMonth[]; // only when the page asked with a contract start
  upcoming: UpcomingPost[];
  queued: QueueSummary | null;
  months: MonthStatus[]; // this month, then next month
  mtd: Record<string, ChannelCounts>;
  quotas: Record<string, ChannelQuota>;
  awaiting_am_review: number;
  awaiting_client_review: number;
  pipeline: PipelineCounts;
  review_by_month: ReviewByMonth;
  year: number | null;
  month: number | null;
  ok: boolean;
  error?: string;
};

const EMPTY_PIPELINE: PipelineCounts = {
  approved: 0,
  draft: 0,
  pending_am: 0,
  client_review: 0,
  revisions: 0,
  published: 0,
  declined: 0,
  total: 0,
};

const now = new Date();
const EMPTY_REVIEW_BY_MONTH: ReviewByMonth = {
  current: {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    awaiting_review: 0,
    revisions: 0,
    total: 0,
  },
  next: {
    year: now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear(),
    month: now.getMonth() === 11 ? 1 : now.getMonth() + 2,
    awaiting_review: 0,
    revisions: 0,
    total: 0,
  },
};

const EMPTY: ContentPulse = {
  found: false,
  client_id: null,
  client_name: null,
  connections: [],
  last_post: null,
  next_scheduled: null,
  last_by_channel: [],
  history: [],
  upcoming: [],
  queued: null,
  months: [],
  mtd: {},
  quotas: {},
  awaiting_am_review: 0,
  awaiting_client_review: 0,
  pipeline: EMPTY_PIPELINE,
  review_by_month: EMPTY_REVIEW_BY_MONTH,
  year: null,
  month: null,
  ok: true,
};

export async function fetchContentPulse(
  brandName: string,
  // since: the contract term's start (YYYY-MM-DD). Asks SocialDesk for the
  // month-by-month count of approved posts from then on.
  opts: { since?: string | null } = {}
): Promise<ContentPulse> {
  const base = (
    process.env.SOCIALDESK_URL ?? "https://socialdesk-lac.vercel.app"
  ).replace(/\/$/, "");
  const token = process.env.SOCIALDESK_HUB_API_TOKEN;
  if (!token) return { ...EMPTY, ok: false, error: "no_token" };

  const url = new URL("/api/hub-pulse", base);
  url.searchParams.set("client_name", brandName);
  if (opts.since) url.searchParams.set("since", opts.since.slice(0, 10));

  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      next: { revalidate: 60 },
    });
    if (!res.ok) {
      return { ...EMPTY, ok: false, error: `HTTP ${res.status}` };
    }
    const body = (await res.json()) as Partial<ContentPulse>;
    return {
      found: !!body.found,
      client_id: body.client_id ?? null,
      client_name: body.client_name ?? null,
      connections: Array.isArray(body.connections) ? body.connections : [],
      last_post: body.last_post ?? null,
      next_scheduled: body.next_scheduled ?? null,
      last_by_channel: Array.isArray(body.last_by_channel) ? body.last_by_channel : [],
      history: Array.isArray(body.history) ? body.history : [],
      upcoming: body.upcoming ?? [],
      queued: body.queued ?? null,
      months: Array.isArray(body.months) ? body.months : [],
      mtd: body.mtd ?? {},
      quotas: body.quotas ?? {},
      awaiting_am_review: body.awaiting_am_review ?? 0,
      awaiting_client_review: body.awaiting_client_review ?? 0,
      pipeline: { ...EMPTY_PIPELINE, ...(body.pipeline ?? {}) },
      review_by_month: body.review_by_month ?? EMPTY_REVIEW_BY_MONTH,
      year: body.year ?? null,
      month: body.month ?? null,
      ok: true,
    };
  } catch (e) {
    return { ...EMPTY, ok: false, error: (e as Error).message };
  }
}
