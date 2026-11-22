// Allocation tile — current month + upcoming month, side by side.
// Each month shows status + planned hours + delta vs. the client board
// Allocation Setup template. The Plan/Edit button underneath routes
// to the editor at /client/[id]/allocation.

import Link from "next/link";
import {
  Clock,
  Check,
  AlertTriangle,
  Calendar,
  ArrowRight,
} from "lucide-react";
import { Tile } from "./tile";
import type { AllocationSetup } from "@/lib/monday/client-board";
import {
  currentPeriod,
  nextPeriod,
  daysUntilDue,
  dueDateLabel,
  periodShort,
} from "@/lib/allocations/period";

export type AllocationSnapshot = {
  year: number;
  month: number;
  status: "draft" | "submitted";
  total_hours: number;
  submitted_at: string | null;
} | null;

export type AllocationHistoryRow = {
  year: number;
  month: number;
  total_hours: number;
  status: string;
};

export function AllocationTile({
  brandId,
  current,
  upcoming,
  setup,
  history,
}: {
  brandId: string;
  current: AllocationSnapshot;
  upcoming: AllocationSnapshot;
  setup: AllocationSetup;
  history: AllocationHistoryRow[];
}) {
  const curPeriod = currentPeriod();
  const upPeriod = nextPeriod(curPeriod);
  const templateTotal = setup.found ? setup.totalHours : 0;

  return (
    <Tile label="Allocation" icon={<Clock className="h-3.5 w-3.5" />}>
      <div className="flex flex-col gap-3">
        {/* Side-by-side: current month + upcoming month */}
        <div className="grid grid-cols-1 gap-2.5 min-[420px]:grid-cols-2">
          <MonthBlock
            brandId={brandId}
            period={curPeriod}
            snapshot={current}
            templateTotal={templateTotal}
            templateFound={setup.found}
          />
          <MonthBlock
            brandId={brandId}
            period={upPeriod}
            snapshot={upcoming}
            templateTotal={templateTotal}
            templateFound={setup.found}
            upcoming
          />
        </div>

        {/* 3-month history strip */}
        {history.length > 0 ? (
          <div className="border-t border-border/60 pt-3">
            <div className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Recent months
            </div>
            <div className="grid grid-cols-3 gap-2">
              {history.map((h) => (
                <div
                  key={`${h.year}-${h.month}`}
                  className="rounded-md border border-border/60 bg-background px-2.5 py-1.5"
                >
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {periodShort({ year: h.year, month: h.month }).split(" ")[0]}
                  </div>
                  <div className="text-[14px] font-semibold tabular-nums text-foreground">
                    {Number(h.total_hours).toFixed(1)}h
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {!setup.found ? (
          <p className="text-[11px] italic text-muted-foreground">
            No Allocation Setup template on Monday for this client. Add one on the client board and the editor will pre-fill from it.
          </p>
        ) : null}
      </div>
    </Tile>
  );
}

function MonthBlock({
  brandId,
  period,
  snapshot,
  templateTotal,
  templateFound,
  upcoming = false,
}: {
  brandId: string;
  period: { year: number; month: number };
  snapshot: AllocationSnapshot;
  templateTotal: number;
  templateFound: boolean;
  upcoming?: boolean;
}) {
  const planned = snapshot?.total_hours ?? 0;
  const delta = planned - templateTotal;
  const daysToDue = daysUntilDue(period);
  const monthLabel = periodShort(period).split(" ")[0];

  const chip = snapshot?.status === "submitted" ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9.5px] font-medium text-emerald-900">
      <Check className="h-2.5 w-2.5" />
      Submitted
    </span>
  ) : daysToDue < 0 ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-1.5 py-0.5 text-[9.5px] font-medium text-rose-900">
      <AlertTriangle className="h-2.5 w-2.5" />
      Overdue
    </span>
  ) : daysToDue <= 5 ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9.5px] font-medium text-amber-900">
      Due {dueDateLabel(period)}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-1.5 py-0.5 text-[9.5px] font-medium text-foreground/70">
      <Calendar className="h-2.5 w-2.5" />
      {dueDateLabel(period)}
    </span>
  );

  const btnLabel = snapshot
    ? snapshot.status === "submitted"
      ? "Edit"
      : "Continue"
    : upcoming
      ? "Plan"
      : "Plan";

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border/60 bg-background/70 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {upcoming ? "Upcoming" : "This month"} · {monthLabel}
        </span>
        {chip}
      </div>
      <div>
        <div className="flex items-baseline gap-1">
          <span className="text-[22px] font-semibold tabular-nums text-foreground">
            {snapshot ? planned.toFixed(1) : "—"}
          </span>
          <span className="text-[11px] text-muted-foreground">hrs</span>
        </div>
        {templateFound && templateTotal > 0 ? (
          <div className="text-[10.5px] text-muted-foreground">
            vs. {templateTotal.toFixed(1)}h template
            {snapshot && Math.abs(delta) >= 0.5 ? (
              <span
                className={delta > 0 ? " text-amber-700" : " text-emerald-700"}
              >
                {" · "}
                {delta > 0 ? "+" : ""}
                {delta.toFixed(1)}h
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      <Link
        href={`/client/${brandId}/allocation?year=${period.year}&month=${period.month}`}
        className="group inline-flex items-center justify-between gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:border-foreground/30 hover:bg-secondary"
      >
        {btnLabel} {monthLabel}
        <ArrowRight className="h-3 w-3 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </Link>
    </div>
  );
}
