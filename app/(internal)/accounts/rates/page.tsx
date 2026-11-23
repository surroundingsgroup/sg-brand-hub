// Hours and rates: every client's monthly amount against the hours allocated
// to it, for this month or next.
//
//   Real rate  = monthly amount / allocated hours
//   At target  = allocated hours x the target rate ($150 today, one setting
//                for the whole company in lib/allocations/rate.ts)
//
// Hours come from the allocation saved in Surroundings when there is one, and
// from the Monday Allocation board otherwise. The monthly amount is the one on
// the client's scope (Commercials).

import Link from "next/link";
import { PageContainer, PageHeader } from "@/components/shell/page-container";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getViewer, seesAccount } from "@/lib/access";
import { boardHoursFor, fetchBoardAllocations } from "@/lib/allocations/board-hours";
import { currentPeriod, nextPeriod, periodLabel } from "@/lib/allocations/period";
import { money, rateMath, rateTone, signedMoney, TARGET_BILL_RATE, type RateMath } from "@/lib/allocations/rate";
import type { BrandScope } from "@/lib/scope/types";
import { cn } from "@/lib/utils";
import { RowFilter } from "@/components/shell/row-filter";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type BrandRow = {
  id: string;
  business_name: string;
  account_manager: string | null;
  engagement_type: string | null;
  status: string | null;
  monday_board_id: string | number | null;
  scope: BrandScope | null;
};

type Line = { id: string; name: string; am: string | null; math: RateMath; source: "saved" | "board" | null };

const TONE = { good: "text-emerald-700", watch: "text-amber-700", low: "text-red-700" } as const;

export default async function RatesPage({ searchParams }: { searchParams: { m?: string } }) {
  const supabase = createSupabaseServerClient();
  const cur = currentPeriod();
  const next = nextPeriod(cur);
  const period = searchParams.m === "next" ? next : cur;

  const [{ data: brandRows }, { data: saved }, board, viewer] = await Promise.all([
    supabase.from("brands").select("id, business_name, account_manager, engagement_type, status, monday_board_id, scope").order("business_name"),
    supabase.from("monthly_allocations").select("brand_id, total_hours").eq("year", period.year).eq("month", period.month),
    fetchBoardAllocations(),
    getViewer(supabase),
  ]);
  const savedHours = new Map((saved ?? []).map((r) => [r.brand_id as string, Number(r.total_hours)]));
  // Billy and Justin see every client. Everyone else sees the accounts they manage, and their team's.
  const brands = ((brandRows ?? []) as BrandRow[]).filter((b) => b.status === "approved" && b.engagement_type !== "inactive" && seesAccount(viewer, b.account_manager));

  const lines: Line[] = [];
  for (const b of brands) {
    const monthly = typeof b.scope?.retainer_amount === "number" ? b.scope.retainer_amount : null;
    const fromSaved = savedHours.get(b.id);
    const fromBoard = boardHoursFor(board.rows, b, period.year, period.month);
    const hours = fromSaved != null && fromSaved > 0 ? fromSaved : fromBoard;
    if (!monthly && !(hours && hours > 0)) continue;
    lines.push({
      id: b.id,
      name: b.business_name,
      am: b.account_manager?.trim() || null,
      math: rateMath(monthly, hours),
      source: fromSaved != null && fromSaved > 0 ? "saved" : fromBoard != null ? "board" : null,
    });
  }

  // Lowest real rate first: those are the accounts getting more hours than they pay for.
  const full = lines.filter((l) => l.math.realRate != null).sort((a, b) => (a.math.realRate as number) - (b.math.realRate as number));
  const noAmount = lines.filter((l) => l.math.monthly == null && l.math.hours != null).sort((a, b) => (b.math.hours as number) - (a.math.hours as number));
  const noHours = lines.filter((l) => l.math.monthly != null && l.math.hours == null).sort((a, b) => a.name.localeCompare(b.name));

  const totalMonthly = full.reduce((n, l) => n + (l.math.monthly as number), 0);
  const totalHours = full.reduce((n, l) => n + (l.math.hours as number), 0);
  const total = rateMath(totalMonthly, totalHours);

  const tab = (label: string, href: string, on: boolean) => (
    <Link
      key={href}
      href={href}
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-3 py-1 text-[12.5px] font-medium transition-colors",
        on ? "border-foreground bg-foreground text-background" : "border-border bg-panel text-foreground hover:bg-secondary"
      )}
    >
      {label}
    </Link>
  );

  return (
    <PageContainer>
      <PageHeader
        title="Hours and rates"
        description={`What each client pays a month against the hours allocated to it. Real rate is the monthly amount divided by the hours. The target is $${TARGET_BILL_RATE} an hour.`}
      />
      {!viewer.everyone ? <p className="mb-4 text-[12.5px] text-muted-foreground">Showing the accounts you manage{viewer.names.length > 1 ? " and your team's" : ""}.</p> : null}

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {tab(periodLabel(cur), "/accounts/rates", period === cur)}
        {tab(periodLabel(next), "/accounts/rates?m=next", period === next)}
        <Link href="/accounts" className="ml-auto text-[12.5px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
          Back to Account health
        </Link>
      </div>

      {!board.ok ? <p className="mb-4 text-[12.5px] text-amber-700">The Monday Allocation board could not be read just now, so only allocations saved in Surroundings are counted.</p> : null}

      <RowFilter
        scope="rates"
        placeholder="Search clients or account managers"
        groups={[{ key: "rate", label: "Real rate", options: [{ value: "good", label: "At target or more" }, { value: "watch", label: "Within 20%" }, { value: "low", label: "Further under" }] }]}
      />
      <div className="overflow-x-auto rounded-2xl border border-border/60 bg-panel shadow-[0_1px_2px_rgba(16,10,0,0.04),0_8px_24px_-16px_rgba(16,10,0,0.08)] md:overflow-visible">
        <table data-filter-scope="rates" className="w-full min-w-[720px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border/60 text-left text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              <th className="sticky top-12 z-10 bg-panel md:top-14 px-4 py-3">Client</th>
              <th className="sticky top-12 z-10 bg-panel md:top-14 px-3 py-3">Account manager</th>
              <th className="sticky top-12 z-10 bg-panel md:top-14 px-3 py-3 text-right">Monthly</th>
              <th className="sticky top-12 z-10 bg-panel md:top-14 px-3 py-3 text-right">Allocated hours</th>
              <th className="sticky top-12 z-10 bg-panel md:top-14 px-3 py-3 text-right">Real rate</th>
              <th className="sticky top-12 z-10 bg-panel md:top-14 px-3 py-3 text-right">Hours at ${TARGET_BILL_RATE}</th>
              <th className="sticky top-12 z-10 bg-panel md:top-14 px-4 py-3 text-right">Over or under</th>
            </tr>
          </thead>
          <tbody>
            {full.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
                  No client has both a monthly amount and allocated hours for {periodLabel(period)} yet.
                </td>
              </tr>
            ) : null}
            {full.map((l) => {
              const tone = rateTone(l.math.realRate);
              return (
                <tr key={l.id} data-filter-row data-filter-text={[l.name, l.am ?? ""].join(" ")} data-filter-rate={tone ?? ""} className="border-b border-border/40 last:border-0 hover:bg-secondary/40">
                  <td className="px-4 py-2.5">
                    <Link href={`/client/${l.id}`} className="font-semibold text-foreground hover:underline">
                      {l.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">{l.am ?? ""}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{money(l.math.monthly as number)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{(l.math.hours as number).toFixed(1)}</td>
                  <td className={cn("px-3 py-2.5 text-right font-semibold tabular-nums", tone ? TONE[tone] : "")}>${(l.math.realRate as number).toFixed(2)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{money(l.math.atTarget as number)}</td>
                  <td className={cn("px-4 py-2.5 text-right tabular-nums", (l.math.gap as number) < 0 ? "text-red-700" : "text-emerald-700")}>{signedMoney(l.math.gap as number)}</td>
                </tr>
              );
            })}
          </tbody>
          {full.length ? (
            <tfoot>
              <tr className="border-t border-border/70 font-semibold">
                <td className="px-4 py-3" colSpan={2}>
                  Total, {full.length} {full.length === 1 ? "client" : "clients"}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{money(totalMonthly)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{totalHours.toFixed(1)}</td>
                <td className={cn("px-3 py-3 text-right tabular-nums", rateTone(total.realRate) ? TONE[rateTone(total.realRate) as keyof typeof TONE] : "")}>
                  {total.realRate != null ? `$${total.realRate.toFixed(2)}` : ""}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{total.atTarget != null ? money(total.atTarget) : ""}</td>
                <td className={cn("px-4 py-3 text-right tabular-nums", (total.gap ?? 0) < 0 ? "text-red-700" : "text-emerald-700")}>{total.gap != null ? signedMoney(total.gap) : ""}</td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
        Over or under is the monthly amount minus the hours at ${TARGET_BILL_RATE}. A minus means more hours are allocated than the client pays for at the target rate.
      </p>

      {noAmount.length ? (
        <section className="mt-8">
          <h2 className="mb-2 text-[12.5px] font-extrabold uppercase tracking-[0.13em] text-foreground">Hours allocated, no monthly amount on file</h2>
          <ul className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
            {noAmount.map((l) => (
              <li key={l.id} className="flex items-baseline justify-between gap-3 border-b border-border/40 py-1.5">
                <Link href={`/client/${l.id}`} className="truncate font-medium text-foreground hover:underline">
                  {l.name}
                </Link>
                <span className="flex-shrink-0 tabular-nums text-muted-foreground">
                  {(l.math.hours as number).toFixed(1)} hrs, {money(l.math.atTarget as number)} at target
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] text-muted-foreground">Add the amount on the client page under Scope, in Commercials.</p>
        </section>
      ) : null}

      {noHours.length ? (
        <section className="mt-8">
          <h2 className="mb-2 text-[12.5px] font-extrabold uppercase tracking-[0.13em] text-foreground">Monthly amount on file, no hours allocated for {periodLabel(period)}</h2>
          <ul className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
            {noHours.map((l) => (
              <li key={l.id} className="flex items-baseline justify-between gap-3 border-b border-border/40 py-1.5">
                <Link href={`/client/${l.id}`} className="truncate font-medium text-foreground hover:underline">
                  {l.name}
                </Link>
                <span className="flex-shrink-0 tabular-nums text-muted-foreground">
                  {money(l.math.monthly as number)}, buys {(l.math.budgetHours as number).toFixed(1)} hrs
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </PageContainer>
  );
}
