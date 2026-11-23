// Invoicing, all clients: the page for whoever runs the books.
//
//   1. Retainers for the month: every client with a monthly amount, and
//      whether that month's invoice is logged, sent, overdue or paid.
//   2. Open AR: everything sent and not yet paid, overdue first.
//   3. What still has to be sent, and open travel and reimbursements.
//
// Invoices are sent from QuickBooks. Their state is kept on the Monday
// "Invoicing" board, which is what this reads. The monthly amounts come from
// each client's scope. Switch to next month to see what is coming up.

import Link from "next/link";
import { PageContainer, PageHeader } from "@/components/shell/page-container";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getViewer, seesAccount } from "@/lib/access";
import { currentPeriod, nextPeriod, periodLabel } from "@/lib/allocations/period";
import { money } from "@/lib/allocations/rate";
import { fetchInvoices, INVOICING_BOARD_URL, invoicesFor, rowOwed, STATE_LABEL, type InvoiceRow, type InvoiceState } from "@/lib/monday/invoicing";
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

const CHIP: Record<InvoiceState | "none", string> = {
  none: "border border-dashed border-border text-muted-foreground",
  open: "bg-secondary text-foreground/80",
  sent: "bg-accent-soft text-accent-foreground",
  overdue: "bg-red-100 text-red-800",
  paid: "bg-emerald-100 text-emerald-800",
  travel: "bg-secondary text-foreground/80",
};
const ORDER: (InvoiceState | "none")[] = ["none", "overdue", "open", "sent", "paid"];

const H2 = ({ children }: { children: React.ReactNode }) => <h2 className="mb-2 text-[12.5px] font-extrabold uppercase tracking-[0.13em] text-foreground">{children}</h2>;
const shortDate = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "");

function InvoiceTable({ rows, empty }: { rows: InvoiceRow[]; empty: string }) {
  if (!rows.length) return <p className="rounded-2xl border border-border/60 bg-panel px-4 py-4 text-[12.5px] text-muted-foreground">{empty}</p>;
  return (
    <div className="overflow-x-auto rounded-2xl border border-border/60 bg-panel md:overflow-visible">
      <table className="w-full min-w-[640px] border-collapse text-[13px]">
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border/40 last:border-0 hover:bg-secondary/40">
              <td className="px-4 py-2.5">
                <a href={r.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-foreground hover:underline">
                  {r.billTo || r.name}
                </a>
                {r.billTo || r.invoiceNumber ? <div className="text-[11.5px] text-muted-foreground">{[r.invoiceNumber ? `Invoice ${r.invoiceNumber}` : "", r.billTo ? r.name : ""].filter(Boolean).join(" · ")}</div> : null}
              </td>
              <td className="px-3 py-2.5 text-muted-foreground">{r.kind === "retainer" ? "Retainer" : r.kind === "upsell" ? "Retainer upsell" : r.kind === "one-time" ? "One-time project" : r.state === "travel" ? "Travel" : ""}</td>
              <td className="px-3 py-2.5 text-muted-foreground">{shortDate(r.billed)}</td>
              <td className={cn("px-3 py-2.5", r.state === "overdue" ? "text-red-700" : "text-muted-foreground")}>{r.dueDate ? `due ${shortDate(r.dueDate)}` : ""}</td>
              <td className="px-3 py-2.5 text-right font-medium tabular-nums">{money(rowOwed(r))}</td>
              <td className="px-4 py-2.5 text-right">
                <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", CHIP[r.state])}>
                  {r.state === "travel" ? (r.travelStatus ?? "Open") : STATE_LABEL[r.state]}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function InvoicingPage({ searchParams }: { searchParams: { m?: string } }) {
  const supabase = createSupabaseServerClient();
  const cur = currentPeriod();
  const next = nextPeriod(cur);
  const period = searchParams.m === "next" ? next : cur;
  const ym = `${period.year}-${String(period.month).padStart(2, "0")}`;

  const [{ data: brandRows }, invoices, viewer] = await Promise.all([
    supabase.from("brands").select("id, business_name, account_manager, engagement_type, status, monday_board_id, scope").order("business_name"),
    fetchInvoices(),
    getViewer(supabase),
  ]);
  // Billy and Justin see every client. Everyone else sees the accounts they manage, and their team's.
  const brands = ((brandRows ?? []) as BrandRow[]).filter((b) => b.status === "approved" && b.engagement_type !== "inactive" && seesAccount(viewer, b.account_manager));
  const visible = viewer.everyone ? invoices.rows : [...new Map(brands.flatMap((b) => invoicesFor(invoices.rows, b)).map((r) => [r.id, r] as const)).values()];

  // 1. Retainers for the month
  const retainers = brands
    .filter((b) => typeof b.scope?.retainer_amount === "number" && (b.scope.retainer_amount as number) > 0)
    .map((b) => {
      const mine = invoicesFor(invoices.rows, b);
      const row = mine.find((r) => r.kind === "retainer" && r.state !== "travel" && (r.billed ?? "").startsWith(ym)) ?? null;
      return { id: b.id, name: b.business_name, am: b.account_manager?.trim() || null, monthly: b.scope!.retainer_amount as number, row, state: (row?.state ?? "none") as InvoiceState | "none" };
    })
    .sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state) || a.name.localeCompare(b.name));
  const total = retainers.reduce((n, r) => n + r.monthly, 0);
  const count = (s: InvoiceState | "none") => retainers.filter((r) => r.state === s).length;
  const sum = (s: InvoiceState | "none") => retainers.filter((r) => r.state === s).reduce((n, r) => n + r.monthly, 0);

  // 2 and 3. Everything on the board
  const overdue = visible.filter((r) => r.state === "overdue");
  const sent = visible.filter((r) => r.state === "sent");
  const toSend = visible.filter((r) => r.state === "open");
  const travel = visible.filter((r) => r.state === "travel" && !/reimbursed|closed|invoiced to client/i.test(r.travelStatus ?? ""));
  const openAr = [...overdue, ...sent];
  const arTotal = openAr.reduce((n, r) => n + rowOwed(r), 0);
  const overdueTotal = overdue.reduce((n, r) => n + rowOwed(r), 0);

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
  const label = (s: InvoiceState | "none") => (s === "none" ? "Not logged" : STATE_LABEL[s]);

  return (
    <PageContainer>
      <PageHeader title="Invoicing" description="Retainers for the month, open AR, and what still has to go out. Invoices are sent from QuickBooks; their state is kept on the Monday Invoicing board, which is what this page reads." />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {tab(periodLabel(cur), "/accounts/invoicing", period === cur)}
        {tab(periodLabel(next), "/accounts/invoicing?m=next", period === next)}
        <a href={INVOICING_BOARD_URL} target="_blank" rel="noopener noreferrer" className="ml-auto text-[12.5px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
          Open the Invoicing board
        </a>
        <Link href="/accounts" className="text-[12.5px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
          Account health
        </Link>
      </div>

      {!viewer.everyone ? <p className="mb-4 text-[12.5px] text-muted-foreground">Showing the accounts you manage{viewer.names.length > 1 ? " and your team's" : ""}.</p> : null}
      {!invoices.ok ? <p className="mb-4 text-[12.5px] text-amber-700">The Invoicing board could not be read just now, so no invoice states are shown.</p> : null}

      {/* The four numbers */}
      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { k: `Retainers, ${periodLabel(period)}`, v: money(total), s: `${retainers.length} clients` },
          { k: "Not logged yet", v: money(sum("none")), s: `${count("none")} of ${retainers.length} retainer invoices`, warn: count("none") > 0 },
          { k: "Open AR", v: money(arTotal), s: `${openAr.length} sent, not paid` },
          { k: "Overdue", v: money(overdueTotal), s: overdue.length ? `${overdue.length} ${overdue.length === 1 ? "invoice" : "invoices"}` : "nothing overdue", bad: overdueTotal > 0 },
        ].map((x) => (
          <div key={x.k} className="rounded-2xl border border-border/60 bg-panel p-4">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{x.k}</div>
            <div className={cn("mt-1 text-[24px] font-bold tabular-nums", x.bad ? "text-red-700" : x.warn ? "text-amber-700" : "text-foreground")}>{x.v}</div>
            <div className="text-[11.5px] text-muted-foreground">{x.s}</div>
          </div>
        ))}
      </div>

      {/* 1. Retainers */}
      <section className="mb-8">
        <H2>Retainers, {periodLabel(period)}</H2>
        <RowFilter
          scope="retainers"
          placeholder="Search clients or account managers"
          groups={[
            {
              key: "state",
              label: "Invoice",
              options: [
                { value: "none", label: "Not logged" },
                { value: "open", label: "To be sent" },
                { value: "sent", label: "Sent" },
                { value: "overdue", label: "Overdue" },
                { value: "paid", label: "Paid" },
              ],
            },
          ]}
        />
        <div className="overflow-x-auto rounded-2xl border border-border/60 bg-panel md:overflow-visible">
          <table data-filter-scope="retainers" className="w-full min-w-[640px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-border/60 text-left text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                <th className="sticky top-12 z-10 bg-panel md:top-14 px-4 py-3">Client</th>
                <th className="sticky top-12 z-10 bg-panel md:top-14 px-3 py-3">Account manager</th>
                <th className="sticky top-12 z-10 bg-panel md:top-14 px-3 py-3 text-right">Monthly</th>
                <th className="sticky top-12 z-10 bg-panel md:top-14 px-4 py-3 text-right">{periodLabel(period).split(" ")[0]} invoice</th>
              </tr>
            </thead>
            <tbody>
              {retainers.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                    No client has a monthly amount on file yet.
                  </td>
                </tr>
              ) : null}
              {retainers.map((r) => (
                <tr key={r.id} data-filter-row data-filter-text={[r.name, r.am ?? ""].join(" ")} data-filter-state={r.state} className="border-b border-border/40 last:border-0 hover:bg-secondary/40">
                  <td className="px-4 py-2.5">
                    <Link href={`/client/${r.id}`} className="font-semibold text-foreground hover:underline">
                      {r.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">{r.am ?? ""}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{money(r.monthly)}</td>
                  <td className="px-4 py-2.5 text-right">
                    {r.row ? (
                      <a href={r.row.url} target="_blank" rel="noopener noreferrer" className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", CHIP[r.state])}>
                        {label(r.state)}
                      </a>
                    ) : (
                      <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", CHIP.none)}>Not logged</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
          A retainer counts as logged when the Invoicing board has a row for the client, marked Retainer, with an invoice date (or, before there is one, a request date) in {periodLabel(period)}.
        </p>
      </section>

      {/* 2. Open AR */}
      <section className="mb-8">
        <H2>Open AR: sent, not paid</H2>
        <InvoiceTable rows={openAr} empty="Nothing on the board is sent and waiting for payment." />
      </section>

      {/* 3. To send, travel */}
      <section className="mb-8">
        <H2>To be sent</H2>
        <InvoiceTable rows={toSend} empty="Nothing is waiting to be sent." />
      </section>
      <section>
        <H2>Travel and reimbursements, open</H2>
        <InvoiceTable rows={travel} empty="No open travel or reimbursements." />
      </section>
    </PageContainer>
  );
}
