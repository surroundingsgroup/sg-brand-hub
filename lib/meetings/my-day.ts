// The signed-in person's own day on Google Calendar (today and tomorrow), read
// through the Brief Tool, which holds the calendar access. The two apps share
// HUB_BRIEF_API_TOKEN as a bearer secret. Only ever asked for the person who
// is signed in. Fails soft: the card says the calendar could not be read.

export type DayEvent = {
  id: string;
  day: "today" | "tomorrow";
  title: string;
  start: string | null; // ISO instant; null for an all-day entry
  end: string | null;
  allDay: boolean;
  location: string | null;
  joinUrl: string | null;
  url: string | null;
  guests: number;
  status: "accepted" | "tentative" | "needsAction" | "own";
};

export type MyDay = { ok: boolean; today: string; tomorrow: string; events: DayEvent[]; error?: string };

const EMPTY: MyDay = { ok: false, today: "", tomorrow: "", events: [] };

export async function fetchMyDay(email: string): Promise<MyDay> {
  const base = (process.env.BRIEF_TOOL_URL ?? "https://briefs.surroundingsgroup.com").replace(/\/$/, "");
  const token = process.env.HUB_BRIEF_API_TOKEN;
  if (!token) return { ...EMPTY, error: "no_token" };
  const url = new URL("/api/my-day", base);
  url.searchParams.set("email", email.trim().toLowerCase());
  try {
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!res.ok) return { ...EMPTY, error: `HTTP ${res.status}` };
    const json = (await res.json()) as Partial<MyDay>;
    return { ok: !!json.ok, today: json.today ?? "", tomorrow: json.tomorrow ?? "", events: json.events ?? [], error: json.error };
  } catch (e) {
    return { ...EMPTY, error: (e as Error).message.slice(0, 120) };
  }
}
