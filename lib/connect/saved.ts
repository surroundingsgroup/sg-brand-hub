// Things saved for a client: inspiration, competitor moves, industry news,
// strategy ideas. Saved by the team from the client page, or by an outside
// assistant (Muse) through the connector API in app/api/connect.
//
// Kept inside brands.industry_update (a JSON column) under "saved", next to
// the generated industry notes, so no new table is needed.
//
// Everything here is treated as plain text from an outside source: sizes are
// capped, links must be ordinary web addresses, and nothing is ever rendered
// as HTML.

import type { SupabaseClient } from "@supabase/supabase-js";

export const SAVED_KINDS = ["inspiration", "competitor", "news", "strategy"] as const;
export type SavedKind = (typeof SAVED_KINDS)[number];

export type SavedItem = {
  id: string;
  kind: SavedKind;
  title: string;
  note: string | null;
  url: string | null;
  source: string | null; // where it came from: "Instagram", a publication, ...
  saved_at: string; // ISO
  saved_by: string; // a team member, or the connector's name
};

const MAX_ITEMS = 300;

const text = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

function webAddress(v: unknown): string | null {
  const raw = text(v, 600);
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Read the saved list out of whatever is in the column. */
export function readSaved(raw: unknown): SavedItem[] {
  const list = (raw as { saved?: unknown } | null)?.saved;
  if (!Array.isArray(list)) return [];
  return list
    .map((it): SavedItem | null => {
      if (!it || typeof it !== "object") return null;
      const r = it as Record<string, unknown>;
      const kind = (SAVED_KINDS as readonly string[]).includes(r.kind as string) ? (r.kind as SavedKind) : null;
      const title = text(r.title, 160);
      if (!kind || !title || typeof r.id !== "string") return null;
      return {
        id: r.id,
        kind,
        title,
        note: text(r.note, 1200) || null,
        url: webAddress(r.url),
        source: text(r.source, 60) || null,
        saved_at: typeof r.saved_at === "string" ? r.saved_at : new Date().toISOString(),
        saved_by: text(r.saved_by, 80) || "Unknown",
      };
    })
    .filter((x): x is SavedItem => x !== null);
}

/** Turn what somebody sent into an item, or say why not. */
export function makeSavedItem(input: unknown, savedBy: string): SavedItem | { error: string } {
  if (!input || typeof input !== "object") return { error: "each item must be an object" };
  const r = input as Record<string, unknown>;
  const kind = (SAVED_KINDS as readonly string[]).includes(r.kind as string) ? (r.kind as SavedKind) : null;
  if (!kind) return { error: `kind must be one of: ${SAVED_KINDS.join(", ")}` };
  const title = text(r.title, 160);
  if (!title) return { error: "title is required" };
  if (r.url != null && r.url !== "" && !webAddress(r.url)) return { error: "url must be an http or https address" };
  return {
    id: `sv_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    kind,
    title,
    note: text(r.note, 1200) || null,
    url: webAddress(r.url),
    source: text(r.source, 60) || null,
    saved_at: new Date().toISOString(),
    saved_by: text(savedBy, 80) || "Unknown",
  };
}

async function load(supabase: SupabaseClient, brandId: string): Promise<{ column: Record<string, unknown>; saved: SavedItem[] } | null> {
  const { data, error } = await supabase.from("brands").select("industry_update").eq("id", brandId).maybeSingle();
  if (error || !data) return null;
  const column = (data.industry_update && typeof data.industry_update === "object" ? data.industry_update : {}) as Record<string, unknown>;
  return { column, saved: readSaved(column) };
}

export async function addSaved(supabase: SupabaseClient, brandId: string, items: SavedItem[]): Promise<SavedItem[] | null> {
  const current = await load(supabase, brandId);
  if (!current) return null;
  // Newest first; the oldest fall off past the cap.
  const saved = [...items, ...current.saved].slice(0, MAX_ITEMS);
  const { error } = await supabase.from("brands").update({ industry_update: { ...current.column, saved } }).eq("id", brandId);
  return error ? null : saved;
}

export async function removeSaved(supabase: SupabaseClient, brandId: string, itemId: string): Promise<SavedItem[] | null> {
  const current = await load(supabase, brandId);
  if (!current) return null;
  const saved = current.saved.filter((s) => s.id !== itemId);
  const { error } = await supabase.from("brands").update({ industry_update: { ...current.column, saved } }).eq("id", brandId);
  return error ? null : saved;
}
