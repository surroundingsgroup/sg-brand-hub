// Monthly allocation editor — takeover page from the Allocation tile.
//
//   /client/[id]/allocation?year=YYYY&month=MM
//
// Query params default to the current month. Server component loads
// the existing allocation (if any), the client board's Allocation
// Setup template (for seeding on first open), and hands everything to
// the client-side editor.

import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchClientBoardData, fetchAllocationSetup } from "@/lib/monday/client-board";
import { fetchAllTeamMembers } from "@/lib/monday/teams";
import { AllocationEditor, type AllocationLine } from "./allocation-editor";
import { currentPeriod } from "@/lib/allocations/period";
import { normalizeRole } from "@/lib/allocations/roles";
import type { Brand } from "@/types/brand";

export const dynamic = "force-dynamic";

type AllocationRow = {
  id: string;
  year: number;
  month: number;
  status: "draft" | "submitted";
  submitted_at: string | null;
  total_hours: number;
  notes: string | null;
};

type LineRow = {
  id: string;
  task: string;
  role: string | null;
  owner: string | null;
  hours: number;
  notes: string | null;
  sort_order: number;
};

export default async function AllocationPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { year?: string; month?: string };
}) {
  const now = new Date();
  const fallback = currentPeriod(now);
  const year = Number(searchParams.year) || fallback.year;
  const month = Number(searchParams.month) || fallback.month;

  const supabase = createSupabaseServerClient();
  const { data: brand } = await supabase
    .from("brands")
    .select("id, business_name, vertical, account_manager")
    .eq("id", params.id)
    .single();
  if (!brand) notFound();
  const b = brand as Pick<Brand, "id" | "business_name" | "vertical" | "account_manager">;

  // Pull: existing allocation (if any), its lines, the Monday setup
  // template (for seeding when there's no draft yet), AND the three
  // most recent submitted months for the month-over-month delta.
  const { data: alloc } = await supabase
    .from("monthly_allocations")
    .select("id, year, month, status, submitted_at, total_hours, notes")
    .eq("brand_id", params.id)
    .eq("year", year)
    .eq("month", month)
    .maybeSingle();
  const allocation = alloc as AllocationRow | null;

  let existingLines: LineRow[] = [];
  if (allocation) {
    const { data: lines } = await supabase
      .from("monthly_allocation_lines")
      .select("id, task, role, owner, hours, notes, sort_order")
      .eq("allocation_id", allocation.id)
      .order("sort_order", { ascending: true });
    existingLines = (lines ?? []) as LineRow[];
  }

  // Template lines from the Monday client board's "Allocation Setup".
  // Only used if there's no existing allocation yet — we seed the
  // editor and let the AM adjust.
  const clientBoard = await fetchClientBoardData(b.business_name);
  const setup = await fetchAllocationSetup(clientBoard);

  // Team roster for the Owner dropdown. If Monday is unreachable we
  // fall back to an empty list; the editor renders free-text input
  // in that case instead of trapping the AM.
  let teamMembers: Array<{ name: string }> = [];
  try {
    const members = await fetchAllTeamMembers();
    teamMembers = members.map((m) => ({ name: m.name }));
  } catch {
    teamMembers = [];
  }

  const seedLines: AllocationLine[] = allocation
    ? existingLines.map((l) => ({
        id: l.id,
        task: l.task,
        role: normalizeRole(l.role),
        owner: l.owner,
        hours: Number(l.hours),
        notes: l.notes,
      }))
    : setup.lines.map((l) => ({
        id: null,
        task: l.task,
        role: normalizeRole(l.role),
        owner: l.person || null,
        hours: Number(l.hours),
        notes: null,
      }));

  const templateTotal = setup.totalHours || 0;

  // Last 3 submitted months (excluding the one we're editing) — handy
  // for "last month was 74h, we're at 72h now" context.
  const { data: recentRows } = await supabase
    .from("monthly_allocations")
    .select("year, month, status, total_hours, submitted_at")
    .eq("brand_id", params.id)
    .eq("status", "submitted")
    .order("year", { ascending: false })
    .order("month", { ascending: false })
    .limit(4);
  const recent = (recentRows ?? [])
    .filter((r) => !(r.year === year && r.month === month))
    .slice(0, 3) as Array<{
      year: number;
      month: number;
      status: string;
      total_hours: number;
    }>;

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border/70 bg-panel">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-3">
          <Link
            href={`/client/${b.id}`}
            className="inline-flex items-center gap-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Back to {b.business_name}
          </Link>
          <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Monthly allocation
          </div>
        </div>
      </div>

      <AllocationEditor
        brandId={b.id}
        brandName={b.business_name}
        year={year}
        month={month}
        initialLines={seedLines}
        initialNotes={allocation?.notes ?? ""}
        initialStatus={allocation?.status ?? "draft"}
        submittedAt={allocation?.submitted_at ?? null}
        templateTotal={templateTotal}
        templateFound={setup.found}
        recentMonths={recent}
        teamMembers={teamMembers.map((m) => m.name)}
      />
    </div>
  );
}
