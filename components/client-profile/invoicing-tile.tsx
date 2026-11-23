// Invoicing card on the client page. Five things, in this order:
//   1. the retainer and whether this month's invoice has gone out
//   2. the open balance
//   3. what is overdue
//   4. one-time project invoices still open
//   5. travel and reimbursements still open
//
// Invoices are sent from QuickBooks. Their state is kept on the Monday
// "Invoicing" board (to be sent, sent, overdue, paid, travel), and that board
// is what this card reads, so it is as current as the board is.

import { Receipt } from "lucide-react";
import { Tile } from "./tile";
import { INVOICING_BOARD_URL, rowOwed, STATE_LABEL, summarizeInvoices, type InvoiceRow, type InvoiceState } from "@/lib/monday/invoicing";
import { money } from "@/lib/allocations/rate";

const CHIP: Record<InvoiceState, string> = {
  open: "bg-secondary text-foreground/80",
  sent: "bg-accent-soft text-accent-foreground",
  overdue: "bg-red-100 text-red-800",
  paid: "bg-emerald-100 text-emerald-800",
  travel: "bg-secondary text-foreground/80",
};

function Chip({ state, label }: { state: InvoiceState; label?: string }) {
  return <span className={`inline-flex flex-shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${CHIP[state]}`}>{label ?? STATE_LABEL[state]}</span>;
}

function Lines({ title, rows, empty }: { title: string; rows: InvoiceRow[]; empty: string }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{title}</div>
      {rows.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y divide-border/50">
          {rows.slice(0, 4).map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-1.5">
              <a href={r.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-[12.5px] text-foreground hover:underline">
                {r.name}
              </a>
              <span className="flex-shrink-0 text-[12.5px] font-medium tabular-nums text-foreground">{money(rowOwed(r))}</span>
              <Chip state={r.state} label={r.state === "travel" ? (r.travelStatus ?? "Open") : undefined} />
            </li>
          ))}
          {rows.length > 4 ? <li className="py-1.5 text-[11.5px] text-muted-foreground">{rows.length - 4} more on the board</li> : null}
        </ul>
      )}
    </div>
  );
}

export function InvoicingTile({
  invoices,
  monthly,
  ok,
  monthLabel,
  period,
  allHref,
}: {
  invoices: InvoiceRow[]; // this client's rows on the Invoicing board
  monthly: number | null; // the monthly amount on the contract
  ok: boolean; // false when the board could not be read
  monthLabel: string; // "November"
  period: { year: number; month: number };
  allHref?: string; // the all-clients invoicing page, for admins only
}) {
  const s = summarizeInvoices(invoices, period);
  const r = s.retainerThisMonth;

  return (
    <Tile label="Invoicing" icon={<Receipt className="h-3.5 w-3.5" />} href={allHref} hrefLabel="All invoicing">
      {!ok ? (
        <p className="text-[12.5px] text-muted-foreground">The Invoicing board could not be read just now.</p>
      ) : (
        <div className="flex flex-col gap-3.5">
          {/* 1. Retainer */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12.5px] text-foreground">
              {monthly ? (
                <>
                  <span className="font-semibold">Retainer {money(monthly)} a month</span>
                </>
              ) : (
                <span className="text-muted-foreground">No monthly retainer on file</span>
              )}
            </p>
            {monthly ? (
              r ? (
                <Chip state={r.state} label={`${monthLabel}: ${STATE_LABEL[r.state].toLowerCase()}`} />
              ) : (
                <span className="inline-flex items-center rounded-full border border-dashed border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {monthLabel}: not logged
                </span>
              )
            ) : null}
          </div>

          {/* 2 and 3. Balance and overdue */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-md border border-border/60 bg-background/70 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Open balance</div>
              <div className="text-[20px] font-semibold tabular-nums text-foreground">{money(s.openBalance)}</div>
              <div className="text-[11px] text-muted-foreground">
                {s.toSend.length + s.awaiting.length + s.overdueCount === 0
                  ? "nothing open"
                  : [s.toSend.length ? `${s.toSend.length} to send` : "", s.awaiting.length ? `${s.awaiting.length} sent` : "", s.overdueCount ? `${s.overdueCount} overdue` : ""].filter(Boolean).join(", ")}
              </div>
            </div>
            <div className="rounded-md border border-border/60 bg-background/70 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Overdue</div>
              <div className={"text-[20px] font-semibold tabular-nums " + (s.overdue > 0 ? "text-red-700" : "text-foreground")}>{money(s.overdue)}</div>
              <div className="text-[11px] text-muted-foreground">{s.overdueCount ? `${s.overdueCount} ${s.overdueCount === 1 ? "invoice" : "invoices"}` : "nothing overdue"}</div>
            </div>
          </div>

          {/* 4 and 5. One-time projects, travel */}
          <Lines title="One-time projects" rows={s.oneTimeOpen} empty="No open project invoices." />
          <Lines title="Travel and reimbursements" rows={s.travelOpen} empty="Nothing open." />

          {invoices.length === 0 ? (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Nothing is logged for this client on the{" "}
              <a href={INVOICING_BOARD_URL} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">
                Invoicing board
              </a>{" "}
              yet. Invoices sent from QuickBooks show here once they are on the board.
            </p>
          ) : null}
        </div>
      )}
    </Tile>
  );
}

/** For the "needs you" bar at the top of the client page. */
export function overdueInvoiceCount(invoices: InvoiceRow[]): number {
  return invoices.filter((r) => r.state === "overdue").length;
}
