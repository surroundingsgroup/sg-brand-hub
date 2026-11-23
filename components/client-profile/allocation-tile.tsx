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
import { money, rateMath, rateTone, TARGET_BILL_RATE } from "@/lib/allocations/rate";

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
  expected = true,
  monthly = null,
  boardHours,
}: {
  brandId: string;
  current: AllocationSnapshot;
  upcoming: AllocationSnapshot;
  setup: AllocationSetup;
  history: AllocationHistoryRow[];
  // Whether this client is one we plan hours for each month (a retainer, or
  // one with a template on its board). Others are never called "Overdue".
  expected?: boolean;
  // The monthly amount on the contract, and the hours on the Monday Allocation
  // board for each month (used when no allocation is saved here yet). Together
  // they give the real hourly rate and what the hours are worth at the target.
  monthly?: number | null;
  boardHours?: { current: number | null; upcoming: number | null };
}) {
  const curPeriod = currentPeriod();
  const upPeriod = nextPeriod(curPeriod);
  const templateTotal = setup.found ? setup.totalHours : 0;

  return (
    <Tile label="Allocation" icon={<Clock className="h-3.5 w-3.5" />}>
      <div className="flex flex-col gap-3">
        {/* What the retainer buys at the target rate */}
        {monthly ? (
          <p className="text-[12.5px] leading-relaxed text-foreground">
            <span className="font-semibold">{money(monthly)} a month</span>
            <span className="text-muted-foreground">
              {" "}
              buys {(monthly / TARGET_BILL_RATE).toFixed(1)} hours at the ${TARGET_BILL_RATE} target rate.
            </span>
          </p>
        ) : expected ? (
          <p className="text-[12px] text-muted-foreground">No monthly amount on file yet. Add it under Scope, in Commercials, to see the real hourly rate.</p>
        ) : null}

        {/* Side-by-side: current month + upcoming month */}
        <div className="grid grid-cols-1 gap-2.5 min-[420px]:grid-cols-2">
          <MonthBlock
            brandId={brandId}
            period={curPeriod}
            snapshot={current}
            templateTotal={templateTotal}
            templateFound={setup.found}
            expected={expected}
            monthly={monthly}
            boardHours={boardHours?.current ?? null}
          />
          <MonthBlock
            brandId={brandId}
            period={upPeriod}
            snapshot={upcoming}
            templateTotal={templateTotal}
            templateFound={setup.found}
            upcoming
            monthly={monthly}
            boardHours={boardHours?.upcoming ?? null}
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
  expected = true,
  monthly = null,
  boardHours = null,
}: {
  brandId: string;
  period: { year: number; month: number };
  snapshot: AllocationSnapshot;
  templateTotal: number;
  templateFound: boolean;
  expected?: boolean;
  upcoming?: boolean;
  monthly?: number | null;
  boardHours?: number | null;
}) {
  // Hours saved here win; otherwise the hours on the Monday Allocation board.
  const fromBoard = !snapshot && boardHours != null && boardHours > 0;
  const hours = snapshot ? Number(snapshot.total_hours) : fromBoard ? boardHours : null;
  const math = rateMath(monthly, hours);
  const tone = rateTone(math.realRate);
  const planned = snapshot?.total_hours ?? 0;
  const delta = planned - templateTotal;
  const daysToDue = daysUntilDue(period);
  const monthLabel = periodShort(period).split(" ")[0];

  const chip = snapshot?.status === "submitted" ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9.5px] font-medium text-emerald-900">
      <Check className="h-2.5 w-2.5" />
      Submitted
    </span>
  ) : daysToDue < 0 && !expected ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-1.5 py-0.5 text-[9.5px] font-medium text-foreground/70">
      Not planned
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
            {hours != null ? hours.toFixed(1) : "—"}
          </span>
          <span className="text-[11px] text-muted-foreground">hrs{fromBoard ? " on the Allocation board" : ""}</span>
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
      {math.realRate != null && math.atTarget != null && math.gap != null ? (
        <div className="space-y-2 border-t border-border/60 pt-2">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Real effective rate</div>
            <div
              className={
                "text-[15px] font-bold tabular-nums " + (tone === "good" ? "text-emerald-700" : tone === "watch" ? "text-amber-700" : "text-red-700")
              }
            >
              ${math.realRate.toFixed(2)} <span className="text-[11px] font-medium text-muted-foreground">an hour</span>
            </div>
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Should bill at ${math.target} an hour</div>
            <div className="text-[15px] font-bold tabular-nums text-foreground">{money(math.atTarget)}</div>
            <div className={"text-[11px] " + (math.gap < 0 ? "text-red-700" : "text-emerald-700")}>
              {math.gap < 0
                ? `${money(-math.gap)} more than the ${money(math.monthly as number)} they pay`
                : math.gap > 0
                  ? `${money(math.gap)} less than the ${money(math.monthly as number)} they pay`
                  : `the same as the ${money(math.monthly as number)} they pay`}
            </div>
          </div>
        </div>
      ) : null}
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
