// Cross-app read of a client's briefs from the sg-brief-tool API.
//
// The two apps share HUB_BRIEF_API_TOKEN as a bearer secret. Brief data
// otherwise never flows into this codebase — the Hub only shows a
// glanceable summary + deep-links back to the Brief Tool editor for
// actual work.
//
// Fails soft: network / 500 / missing env all return an empty list so
// the client profile page still renders the rest of its tiles if the
// Brief Tool is down.

export type HubBrief = {
  id: string;
  project: string;
  project_type: string | null;
  date: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  url: string;
};

export type BriefsForClient = {
  briefs: HubBrief[];
  brand_id: string | null;
  brand_name?: string;
  ok: boolean;
  error?: string;
};

export async function fetchBriefsForClient(
  brandName: string
): Promise<BriefsForClient> {
  const base = (
    process.env.BRIEF_TOOL_URL ?? "https://briefs.surroundingsgroup.com"
  ).replace(/\/$/, "");
  const token = process.env.HUB_BRIEF_API_TOKEN;
  if (!token) {
    return { briefs: [], brand_id: null, ok: false, error: "no_token" };
  }

  const url = new URL("/api/briefs-for-client", base);
  url.searchParams.set("brand_name", brandName);

  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      // 60s cache — a client profile page open while someone edits
      // briefs on the other side shouldn't have to force-refresh to
      // see the newest state, but we also don't want a chatty fetch
      // on every nav.
      next: { revalidate: 60 },
    });
    if (!res.ok) {
      return {
        briefs: [],
        brand_id: null,
        ok: false,
        error: `HTTP ${res.status}`,
      };
    }
    const data = (await res.json()) as {
      briefs: HubBrief[];
      brand_id: string | null;
      brand_name?: string;
    };
    return {
      briefs: data.briefs ?? [],
      brand_id: data.brand_id ?? null,
      brand_name: data.brand_name,
      ok: true,
    };
  } catch (e) {
    return {
      briefs: [],
      brand_id: null,
      ok: false,
      error: (e as Error).message,
    };
  }
}
