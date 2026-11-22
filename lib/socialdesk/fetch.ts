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

export type UpcomingPost = {
  id: string;
  platform: string;
  type: string | null;
  status: string | null;
  at: string;
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
  last_post: PulseEvent | null;
  next_scheduled: PulseEvent | null;
  upcoming: UpcomingPost[];
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
  last_post: null,
  next_scheduled: null,
  upcoming: [],
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
  brandName: string
): Promise<ContentPulse> {
  const base = (
    process.env.SOCIALDESK_URL ?? "https://socialdesk-lac.vercel.app"
  ).replace(/\/$/, "");
  const token = process.env.SOCIALDESK_HUB_API_TOKEN;
  if (!token) return { ...EMPTY, ok: false, error: "no_token" };

  const url = new URL("/api/hub-pulse", base);
  url.searchParams.set("client_name", brandName);

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
      last_post: body.last_post ?? null,
      next_scheduled: body.next_scheduled ?? null,
      upcoming: body.upcoming ?? [],
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
