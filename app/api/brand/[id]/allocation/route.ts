// Monthly allocation — read + upsert endpoint for a single
// (brand, year, month) tuple.
//
// GET  ?year=YYYY&month=MM  → the allocation row + its lines, or 404
// POST                      → upsert the row and replace its lines
//
// The editor page at /client/[id]/allocation handles the "no row yet"
// seed-from-template logic server-side, so this route stays dumb.

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LineInput = {
  task?: string;
  role?: string | null;
  owner?: string | null;
  hours?: number | string;
  notes?: string | null;
  sort_order?: number;
};

type PostBody = {
  year: number;
  month: number;
  status?: "draft" | "submitted";
  notes?: string | null;
  lines: LineInput[];
};

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const year = Number(req.nextUrl.searchParams.get("year"));
  const month = Number(req.nextUrl.searchParams.get("month"));
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "Invalid year/month." }, { status: 400 });
  }

  const { data: alloc, error } = await supabase
    .from("monthly_allocations")
    .select(
      "id, year, month, status, submitted_at, total_hours, notes, created_at, updated_at"
    )
    .eq("brand_id", params.id)
    .eq("year", year)
    .eq("month", month)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!alloc) {
    return NextResponse.json({ allocation: null, lines: [] });
  }

  const { data: lines, error: linesErr } = await supabase
    .from("monthly_allocation_lines")
    .select("id, task, role, owner, hours, notes, sort_order")
    .eq("allocation_id", alloc.id)
    .order("sort_order", { ascending: true });
  if (linesErr) {
    return NextResponse.json({ error: linesErr.message }, { status: 500 });
  }

  return NextResponse.json({ allocation: alloc, lines: lines ?? [] });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const year = Number(body.year);
  const month = Number(body.month);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "Invalid year/month." }, { status: 400 });
  }

  const status = body.status === "submitted" ? "submitted" : "draft";

  // Normalize lines — drop empties, coerce hours to a non-negative number.
  const lines = Array.isArray(body.lines) ? body.lines : [];
  const cleaned = lines
    .map((l, idx): {
      task: string;
      role: string | null;
      owner: string | null;
      hours: number;
      notes: string | null;
      sort_order: number;
    } | null => {
      const task = (l.task ?? "").toString().trim();
      if (!task) return null;
      const hoursRaw = Number(l.hours);
      const hours = Number.isFinite(hoursRaw) && hoursRaw >= 0 ? hoursRaw : 0;
      return {
        task: task.slice(0, 200),
        role: (l.role ?? "")?.toString().trim().slice(0, 60) || null,
        owner: (l.owner ?? "")?.toString().trim().slice(0, 80) || null,
        hours,
        notes: (l.notes ?? "")?.toString().trim().slice(0, 500) || null,
        sort_order: Number.isInteger(l.sort_order) ? (l.sort_order as number) : idx,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const totalHours = cleaned.reduce((sum, l) => sum + l.hours, 0);

  // Upsert the allocation row by (brand, year, month).
  const upsert = {
    brand_id: params.id,
    year,
    month,
    status,
    submitted_at: status === "submitted" ? new Date().toISOString() : null,
    submitted_by: status === "submitted" ? user.user.id : null,
    total_hours: Number(totalHours.toFixed(2)),
    notes: (body.notes ?? "")?.toString().trim().slice(0, 1000) || null,
    created_by: user.user.id,
  };

  const { data: existing } = await supabase
    .from("monthly_allocations")
    .select("id, created_by")
    .eq("brand_id", params.id)
    .eq("year", year)
    .eq("month", month)
    .maybeSingle();

  let allocId: string;
  if (existing) {
    const patch = { ...upsert } as Partial<typeof upsert>;
    // Don't overwrite original creator.
    delete patch.created_by;
    const { error } = await supabase
      .from("monthly_allocations")
      .update(patch)
      .eq("id", existing.id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    allocId = existing.id;
  } else {
    const { data: inserted, error } = await supabase
      .from("monthly_allocations")
      .insert(upsert)
      .select("id")
      .single();
    if (error || !inserted) {
      return NextResponse.json({ error: error?.message ?? "insert failed" }, { status: 500 });
    }
    allocId = inserted.id;
  }

  // Replace lines wholesale — simpler than diffing and the AM is
  // always editing in a single write anyway.
  const { error: delErr } = await supabase
    .from("monthly_allocation_lines")
    .delete()
    .eq("allocation_id", allocId);
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }
  if (cleaned.length > 0) {
    const { error: insErr } = await supabase
      .from("monthly_allocation_lines")
      .insert(cleaned.map((l) => ({ ...l, allocation_id: allocId })));
    if (insErr) {
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    id: allocId,
    status,
    total_hours: upsert.total_hours,
  });
}
