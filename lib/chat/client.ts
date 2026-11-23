// Google Chat for the chat card on My Surroundings, read and sent through the
// Brief Tool (which holds the Google access) with the bearer secret the two
// apps share. Only ever called for the person who is signed in: the address
// comes from their session, never from the browser. Fails soft: when Chat is
// not connected for the workspace yet, `ok` is false and the card stays hidden.

export type ChatConversation = {
  id: string; // "spaces/AAAA..."
  kind: "dm" | "group" | "space";
  title: string;
  lastActive: string | null;
  unread: boolean;
  url: string | null;
  pinned?: boolean; // kept at the top of the list for everyone in it
};

export type ChatFile = { name: string; url: string | null; image?: string | null; type?: string | null };
export type ChatMessage = { id: string; mine: boolean; sender: string; text: string; time: string; attachments: number; files?: ChatFile[] };
export type ChatPerson = { name: string; email: string };

/** Files go to our own storage first and are passed on from there, so they can be this big. */
export const MAX_CHAT_FILE = 50 * 1024 * 1024;
export const MAX_CHAT_FILES = 5;
export const CHAT_BUCKET = "chat-uploads";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

const base = () => (process.env.BRIEF_TOOL_URL ?? "https://briefs.surroundingsgroup.com").replace(/\/$/, "");

async function call<T>(params: Record<string, string>, body?: Record<string, unknown>): Promise<Result<T>> {
  const token = process.env.HUB_BRIEF_API_TOKEN;
  if (!token) return { ok: false, error: "no_token" };
  const url = new URL("/api/chat", base());
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  try {
    const res = await fetch(url.toString(), {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => null)) as (T & { ok?: boolean; error?: string }) | null;
    if (!res.ok || !json?.ok) return { ok: false, error: json?.error ?? `HTTP ${res.status}` };
    return { ...json, ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message.slice(0, 160) };
  }
}

export const validSpace = (s: string) => /^spaces\/[A-Za-z0-9_-]{4,}$/.test(s);

export const fetchConversations = (email: string, name: string, limit = 14) => call<{ conversations: ChatConversation[] }>({ email, name, limit: String(limit) });

/** Every named space the person is in, with member counts (used to choose what to pin). */
export const fetchSpaces = (email: string) => call<{ spaces: { id: string; title: string; members: number | null; lastActive: string | null }[] }>({ email, spaces: "1" });

/** The company directory on Google. `needs_permission` until the admin has allowed it. */
export const fetchDirectory = (email: string) => call<{ people: ChatPerson[] }>({ email, people: "1" });

export const fetchMessages = (email: string, space: string, markRead: boolean) =>
  call<{ messages: ChatMessage[] }>({ email, space, ...(markRead ? { read: "1" } : {}) });

/** Send a message. Each file is a short-lived link into our own storage. */
export const postMessage = (email: string, space: string, text: string, files: { name: string; type: string; url: string }[] = []) =>
  call<{ message: ChatMessage }>({}, { email, space, text, files });

/** Open a chat with one person (existing or new direct message) or several (a new group chat). */
export const startChat = (email: string, others: ChatPerson[]) => call<{ conversation: ChatConversation }>({}, { email, start: others });

/** A picture attached to a message, streamed from Google through the Brief Tool. */
export async function fetchMedia(email: string, ref: string, type: string): Promise<Response | null> {
  const token = process.env.HUB_BRIEF_API_TOKEN;
  if (!token) return null;
  const url = new URL("/api/chat", base());
  url.searchParams.set("email", email);
  url.searchParams.set("media", ref);
  url.searchParams.set("type", type);
  try {
    // Passed back even when it failed, so the reason can be seen.
    return await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  } catch {
    return null;
  }
}
