// A client's meetings from the team's Google Calendars, read through the
// Brief Tool (which holds the calendar access). The two apps share
// HUB_BRIEF_API_TOKEN as a bearer secret.
//
// Only meetings that are clearly with the client come back: somebody at the
// client's email domain is invited, or the client's name is in the title.
// Fails soft: if the calendar cannot be read the Meetings card simply shows
// no calendar line.

export type ClientMeeting = {
  id: string;
  title: string;
  start: string; // ISO instant
  end: string | null;
  url: string | null;
};

export type ClientMeetings = {
  ok: boolean;
  upcoming: ClientMeeting[]; // soonest first
  recent: ClientMeeting[]; // most recent first
  checked: number;
  error?: string;
};

const EMPTY: ClientMeetings = { ok: false, upcoming: [], recent: [], checked: 0 };

export async function fetchClientMeetings(brandName: string, opts: { fresh?: boolean } = {}): Promise<ClientMeetings> {
  const base = (process.env.BRIEF_TOOL_URL ?? "https://briefs.surroundingsgroup.com").replace(/\/$/, "");
  const token = process.env.HUB_BRIEF_API_TOKEN;
  if (!token) return { ...EMPTY, error: "no_token" };
  const url = new URL("/api/client-meetings", base);
  url.searchParams.set("brand_name", brandName);
  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      // Calendars change a few times a day at most.
      ...(opts.fresh ? { cache: "no-store" as const } : { next: { revalidate: 300 } }),
    });
    if (!res.ok) return { ...EMPTY, error: `HTTP ${res.status}` };
    const body = (await res.json()) as Partial<ClientMeetings>;
    return {
      ok: !!body.ok,
      upcoming: Array.isArray(body.upcoming) ? body.upcoming : [],
      recent: Array.isArray(body.recent) ? body.recent : [],
      checked: body.checked ?? 0,
      error: body.error,
    };
  } catch (e) {
    return { ...EMPTY, error: (e as Error).message };
  }
}

// ── Lifecycle meetings (onboarding checklist) ─────────────────────────────────
// The Brief Tool sorts the client's meetings (about a year ahead) by title into
// kickoff / monthly sync / strategy collab / quarterly review / annual audit.

export type LifecycleKey = "kickoff" | "monthly_sync" | "strategy_collab" | "quarterly_review" | "annual_audit";
export type LifecycleMeeting = { title: string; start: string; upcoming: boolean };
/** null = the calendar could not be read (so nothing can be said either way). */
export type ClientLifecycle = Partial<Record<LifecycleKey, LifecycleMeeting>> | null;

export async function fetchClientLifecycle(brandName: string): Promise<ClientLifecycle> {
  const base = (process.env.BRIEF_TOOL_URL ?? "https://briefs.surroundingsgroup.com").replace(/\/$/, "");
  const token = process.env.HUB_BRIEF_API_TOKEN;
  if (!token) return null;
  const url = new URL("/api/client-meetings", base);
  url.searchParams.set("brand_name", brandName);
  url.searchParams.set("lifecycle", "1");
  try {
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` }, next: { revalidate: 300 } });
    if (!res.ok) return null;
    const body = (await res.json()) as { ok?: boolean; lifecycle?: Partial<Record<LifecycleKey, LifecycleMeeting>> };
    return body.ok ? body.lifecycle ?? {} : null;
  } catch {
    return null;
  }
}
