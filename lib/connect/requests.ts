// Requests left for Muse: "find X for this client". The hub cannot call Muse,
// so SocialDesk (or the team) drops a request here; Muse polls the open list on
// its schedule, fulfills each by saving items, then marks it done. If it cannot
// fulfill one well it leaves it open. Kept in brands.industry_update.requests,
// next to "saved" — no new table.

import type { SupabaseClient } from "@supabase/supabase-js";
import { SAVED_KINDS, type SavedKind } from "@/lib/connect/saved";

export type RequestStatus = "open" | "done";
export type MuseRequest = {
  id: string;
  ask: string;
  kinds: SavedKind[] | null; // kinds of items wanted; null = Muse's default mix
  vertical: string | null;
  requested_by: string;
  status: RequestStatus;
  created_at: string; // ISO
  done_at: string | null;
  note: string | null; // Muse's completion note, or why it could not fulfill
  result_count: number | null;
};

const MAX_REQUESTS = 200;
const text = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

function cleanKinds(v: unknown): SavedKind[] | null {
  if (!Array.isArray(v)) return null;
  const out = v.filter((k): k is SavedKind => (SAVED_KINDS as readonly string[]).includes(k as string));
  return out.length ? Array.from(new Set(out)) : null;
}

export function readRequests(raw: unknown): MuseRequest[] {
  const list = (raw as { requests?: unknown } | null)?.requests;
  if (!Array.isArray(list)) return [];
  return list
    .map((it): MuseRequest | null => {
      if (!it || typeof it !== "object") return null;
      const r = it as Record<string, unknown>;
      const ask = text(r.ask, 600);
      if (!ask || typeof r.id !== "string") return null;
      return {
        id: r.id,
        ask,
        kinds: cleanKinds(r.kinds),
        vertical: text(r.vertical, 60) || null,
        requested_by: text(r.requested_by, 80) || "Unknown",
        status: r.status === "done" ? "done" : "open",
        created_at: typeof r.created_at === "string" ? r.created_at : new Date().toISOString(),
        done_at: typeof r.done_at === "string" ? r.done_at : null,
        note: text(r.note, 600) || null,
        result_count: typeof r.result_count === "number" ? r.result_count : null,
      };
    })
    .filter((x): x is MuseRequest => x !== null);
}

export function makeRequest(input: unknown): MuseRequest | { error: string } {
  if (!input || typeof input !== "object") return { error: "body must be an object" };
  const r = input as Record<string, unknown>;
  const ask = text(r.ask, 600);
  if (!ask) return { error: "ask is required" };
  return {
    id: `rq_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    ask,
    kinds: cleanKinds(r.kinds),
    vertical: text(r.vertical, 60) || null,
    requested_by: text(r.requested_by, 80) || "SocialDesk",
    status: "open",
    created_at: new Date().toISOString(),
    done_at: null,
    note: null,
    result_count: null,
  };
}

async function load(supabase: SupabaseClient, brandId: string): Promise<{ column: Record<string, unknown>; requests: MuseRequest[] } | null> {
  const { data, error } = await supabase.from("brands").select("industry_update").eq("id", brandId).maybeSingle();
  if (error || !data) return null;
  const column = (data.industry_update && typeof data.industry_update === "object" ? data.industry_update : {}) as Record<string, unknown>;
  return { column, requests: readRequests(column) };
}

export async function addRequest(supabase: SupabaseClient, brandId: string, req: MuseRequest): Promise<MuseRequest[] | null> {
  const cur = await load(supabase, brandId);
  if (!cur) return null;
  const requests = [req, ...cur.requests].slice(0, MAX_REQUESTS);
  const { error } = await supabase.from("brands").update({ industry_update: { ...cur.column, requests } }).eq("id", brandId);
  return error ? null : requests;
}

export async function completeRequest(
  supabase: SupabaseClient,
  brandId: string,
  reqId: string,
  done: { note?: string | null; result_count?: number | null },
): Promise<MuseRequest | null> {
  const cur = await load(supabase, brandId);
  if (!cur) return null;
  let updated: MuseRequest | null = null;
  const requests = cur.requests.map((r) => {
    if (r.id !== reqId) return r;
    updated = {
      ...r,
      status: "done",
      done_at: new Date().toISOString(),
      note: text(done.note, 600) || null,
      result_count: typeof done.result_count === "number" ? done.result_count : r.result_count,
    };
    return updated;
  });
  if (!updated) return null;
  const { error } = await supabase.from("brands").update({ industry_update: { ...cur.column, requests } }).eq("id", brandId);
  return error ? null : updated;
}
