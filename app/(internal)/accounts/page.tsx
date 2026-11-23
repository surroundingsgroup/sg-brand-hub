// Account health — every client with a scope on file, on one page.
//
// For account managers and leadership: which accounts are on pace, which need
// a shoot booked, and which renewals are coming up. Same numbers as the Scope
// tile on each client page (lib/scope/summary.ts); internal only, no pricing.
//
// Server-rendered; rows open with <details>, the AM filter is plain links.

import Link from "next/link";
import { ArrowRight, ChevronDown } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/shell/page-container";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { findAmByEmail } from "@/lib/monday/teams";
import { loadAccountHealth, sortByUrgency, type AccountLight, type AccountRow } from "@/lib/scope/accounts";
import type { Level } from "@/lib/scope/summary";
import { cn } from "@/lib/utils";
import { RowFilter } from "@/components/shell/row-filter";

export const dynamic = "force-dynamic";
// One Monday read per client on a cold load.
export const maxDuration = 60;

const DOT: Record<Level, string> = {
  green: "bg-emerald-500",
  yellow: "bg-amber-400",
  red: "bg-red-500",
};
const TEXT: Record<Level, string> = {
  green: "text-emerald-700",
  yellow: "text-amber-700",
  red: "text-red-600",
};

function fmtDate(iso: string | null, withYear = false): string | null {
  if (!iso) return null;
  const d = new Date(iso.length <= 10 ? `${iso}T12:00:00` : iso);
  if (isNaN(d.getTime())) return null;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(withYear || !sameYear ? { year: "numeric" } : {}),
  });
}

function inDays(n: number | null): string | null {
  if (n == null) return null;
  if (n < 0) return `${Math.abs(n)} day${n === -1 ? "" : "s"} ago`;
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n < 60) return `in ${n} days`;
  return `in ${Math.round(n / 30)} months`;
}

function Dot({ level }: { level: Level | null }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full", level ? DOT[level] : "border border-border bg-transparent")}
    />
  );
}

function Verdict({ light, fallback }: { light: AccountLight | null; fallback: string }) {
  if (!light) return <span className="text-muted-foreground">{fallback}</span>;
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-medium", TEXT[light.level])}>
      <Dot level={light.level} />
      {light.label}
    </span>
  );
}

function renewalText(r: AccountRow): { text: string; tone: string } {
  if (!r.renewalDate) return { text: r.startDate ? "Rolling, no end date" : "No dates on file", tone: "text-muted-foreground" };
  const when = fmtDate(r.renewalDate, true);
  if (r.renewalStage === "overdue") return { text: `Term ended ${fmtDate(r.endDate ?? r.renewalDate, true)}`, tone: "text-red-600 font-medium" };
  const soon = r.renewalStage === "this_week" || r.renewalStage === "this_month";
  return { text: `${when} · ${inDays(r.daysToRenewal)}`, tone: soon ? "text-amber-700 font-medium" : "text-foreground" };
}

function AccountLine({ r }: { r: AccountRow }) {
  const renewal = renewalText(r);
  const renewalTag = r.renewalStage === "overdue" ? "ended" : r.daysToRenewal != null && r.daysToRenewal >= 0 && r.daysToRenewal <= 90 ? "soon" : "later";
  return (
    <li data-filter-row data-filter-text={[r.name, r.am ?? "", r.pooledWith ?? ""].join(" ")} data-filter-level={r.level ?? "none"} data-filter-renewal={renewalTag}>
      <details className="group/row">
        <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-secondary/50 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)_auto] [&::-webkit-details-marker]:hidden">
          <div className="flex min-w-0 items-center gap-2.5">
            <Dot level={r.level} />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">{r.name}</div>
              <div className="truncate text-xs text-muted-foreground">
                {r.am ?? "No account manager"}
                {r.pooledWith ? ` · shared with ${r.pooledWith}` : ""}
              </div>
            </div>
          </div>
          <div className="hidden text-xs md:block">
            <Verdict light={r.month} fallback={r.contract ? "Term over" : "No shoot quota"} />
          </div>
          <div className="hidden text-xs md:block">
            <Verdict light={r.contract} fallback="No shoot quota" />
          </div>
          <div className={cn("hidden truncate text-xs md:block", renewal.tone)}>{renewal.text}</div>
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open/row:rotate-180" />
          {/* Phone: the two verdicts and the renewal on a second line */}
          <div className="col-span-2 flex flex-wrap items-center gap-x-4 gap-y-1 pl-5 text-xs md:hidden">
            {r.month ? <Verdict light={r.month} fallback="" /> : null}
            {r.contract ? <Verdict light={r.contract} fallback="" /> : null}
            <span className={renewal.tone}>{renewal.text}</span>
          </div>
        </summary>
        <div className="border-t border-border bg-secondary/20 px-4 py-3 text-xs">
          <dl className="grid gap-x-8 gap-y-2 md:grid-cols-2">
            {r.month ? (
              <div>
                <dt className="font-medium text-foreground">This {r.unit}</dt>
                <dd className="text-muted-foreground">{r.month.reason ?? r.month.label}</dd>
              </div>
            ) : null}
            {r.contract ? (
              <div>
                <dt className="font-medium text-foreground">Full contract</dt>
                <dd className="text-muted-foreground">
                  {r.contract.reason ?? r.contract.label}
                  {r.done != null && r.total != null && !/of\s+\d+/.test(r.contract.reason ?? "") ? ` ${r.done} of ${r.total} shoots done.` : ""}
                </dd>
              </div>
            ) : (
              <div>
                <dt className="font-medium text-foreground">Shoots</dt>
                <dd className="text-muted-foreground">No shoot quota entered, so there is nothing to pace. Dates and renewal still apply.</dd>
              </div>
            )}
            <div>
              <dt className="font-medium text-foreground">Next shoot</dt>
              <dd className="text-muted-foreground">
                {r.nextShoot ? `${fmtDate(r.nextShoot)}${r.nextShootName ? ` · ${r.nextShootName}` : ""}` : "None scheduled"}
                {r.lastShoot ? ` · last one ${fmtDate(r.lastShoot)}` : ""}
              </dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">Term</dt>
              <dd className="text-muted-foreground">
                {r.startDate ? `${fmtDate(r.startDate, true)} to ${r.endDate ? fmtDate(r.endDate, true) : "open"}` : "No dates on file"}
                {r.autoRenew === true ? " · auto-renews" : r.autoRenew === false ? " · does not auto-renew" : ""}
                {r.owedPerPeriod ? ` · ${r.owedPerPeriod} shoot${r.owedPerPeriod === 1 ? "" : "s"} per ${r.unit}` : ""}
              </dd>
            </div>
          </dl>
          {!r.projectsOk ? (
            <p className="mt-2 text-amber-700">Monday could not be read for this client just now, so shoot counts may be missing.</p>
          ) : null}
          <Link
            href={`/client/${r.id}`}
            className="mt-3 inline-flex items-center gap-1 font-medium text-foreground transition-colors hover:text-accent-foreground"
          >
            Open {r.name}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </details>
    </li>
  );
}

export default async function AccountsPage({ searchParams }: { searchParams: { am?: string } }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const health = await loadAccountHealth(supabase);
  const all = sortByUrgency(health.rows);

  // Account managers who have at least one account here, busiest first.
  const amCounts = new Map<string, number>();
  for (const r of all) amCounts.set(r.am ?? "Unassigned", (amCounts.get(r.am ?? "Unassigned") ?? 0) + 1);
  const ams = [...amCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  // ?am=mine resolves to the signed-in person; ?am=<name> picks one AM.
  let selected = searchParams.am?.trim() || "";
  if (selected === "mine") {
    let mine: string | null = null;
    try {
      mine = user?.email ? ((await findAmByEmail(user.email))?.name ?? null) : null;
    } catch {
      mine = null;
    }
    selected = mine && amCounts.has(mine) ? mine : "";
  }
  const rows = selected ? all.filter((r) => (r.am ?? "Unassigned") === selected) : all;

  const red = rows.filter((r) => r.level === "red").length;
  const yellow = rows.filter((r) => r.level === "yellow").length;
  const renewals = rows
    .filter((r) => r.daysToRenewal != null && r.daysToRenewal >= 0 && r.daysToRenewal <= 90)
    .sort((a, b) => (a.daysToRenewal ?? 0) - (b.daysToRenewal ?? 0));
  const lapsed = rows
    .filter((r) => r.renewalStage === "overdue")
    .sort((a, b) => (b.daysToRenewal ?? 0) - (a.daysToRenewal ?? 0));
  const missing = selected ? health.missingScope.filter((m) => (m.am ?? "Unassigned") === selected) : health.missingScope;

  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const summary = [
    plural(rows.length, "account", "accounts"),
    red ? `${red} need${red === 1 ? "s" : ""} attention` : null,
    yellow ? `${yellow} to keep an eye on` : null,
    renewals.length ? `${plural(renewals.length, "renewal", "renewals")} in the next 90 days` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const chip = (label: string, href: string, active: boolean, count?: number) => (
    <Link
      key={label}
      href={href}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        active ? "border-foreground bg-foreground text-background" : "border-border bg-panel text-foreground hover:bg-secondary"
      )}
    >
      {label}
      {count != null ? <span className={active ? "text-background/70" : "text-muted-foreground"}>{count}</span> : null}
    </Link>
  );

  return (
    <PageContainer>
      <PageHeader
        title="Account health"
        description="Every client with a scope on file. This month first, then the full contract, then the renewal."
      />

      <div className="mb-3 flex flex-wrap gap-2">
        <Link
          href="/accounts/rates"
          className="inline-flex items-center gap-1.5 rounded-lg border border-foreground/25 bg-panel px-3 py-1.5 text-[12.5px] font-semibold text-foreground transition-colors hover:border-foreground hover:bg-foreground hover:text-background"
        >
          Hours and rates: monthly amount against allocated hours
        </Link>
        <Link
          href="/accounts/invoicing"
          className="inline-flex items-center gap-1.5 rounded-lg border border-foreground/25 bg-panel px-3 py-1.5 text-[12.5px] font-semibold text-foreground transition-colors hover:border-foreground hover:bg-foreground hover:text-background"
        >
          Invoicing: retainers this month, open AR, overdue
        </Link>
        <Link
          href="/accounts/pto"
          className="inline-flex items-center gap-1.5 rounded-lg border border-foreground/25 bg-panel px-3 py-1.5 text-[12.5px] font-semibold text-foreground transition-colors hover:border-foreground hover:bg-foreground hover:text-background"
        >
          Time off: everyone's balances
        </Link>
      </div>

      <div className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
        {chip("All", "/accounts", !selected, all.length)}
        {ams.map(([name, n]) => chip(name, `/accounts?am=${encodeURIComponent(name)}`, selected === name, n))}
      </div>

      <p className="mb-6 text-sm text-muted-foreground">{summary}</p>

      {renewals.length > 0 || lapsed.length > 0 ? (
        <section className="mb-8">
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Renewals</h2>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-panel">
            {[...renewals, ...lapsed].map((r) => (
              <li key={r.id}>
                <Link
                  href={`/client/${r.id}`}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-4 py-2.5 text-sm transition-colors hover:bg-secondary/50 md:grid-cols-[150px_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]"
                >
                  <span className={cn("order-2 text-xs md:order-none md:text-sm", r.renewalStage === "overdue" ? "font-medium text-red-600" : "text-foreground")}>
                    {r.renewalStage === "overdue" ? `Ended ${fmtDate(r.endDate ?? r.renewalDate, true)}` : fmtDate(r.renewalDate, true)}
                  </span>
                  <span className="min-w-0 truncate font-medium text-foreground">{r.name}</span>
                  <span className="hidden truncate text-xs text-muted-foreground md:block">{r.am ?? "No account manager"}</span>
                  <span className="hidden truncate text-xs text-muted-foreground md:block">
                    {r.renewalStage === "overdue"
                      ? "No renewal on file"
                      : `${inDays(r.daysToRenewal)}${r.autoRenew === true ? " · auto-renews" : r.autoRenew === false ? " · needs a new agreement" : ""}`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <RowFilter
          scope="accounts"
          placeholder="Search clients or account managers"
          groups={[
            { key: "level", label: "Health", options: [{ value: "red", label: "Needs attention" }, { value: "yellow", label: "Keep an eye on" }, { value: "green", label: "On track" }] },
            { key: "renewal", label: "Renewal", options: [{ value: "soon", label: "Next 90 days" }, { value: "ended", label: "Term ended" }] },
          ]}
        />
        <div className="sticky top-14 z-20 hidden grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)_auto] gap-x-4 border-b border-border bg-canvas px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground md:grid">
          <span>Account</span>
          <span>This period</span>
          <span>Full contract</span>
          <span>Renewal</span>
          <span className="w-4" />
        </div>
        {rows.length ? (
          <ul data-filter-scope="accounts" className="divide-y divide-border rounded-lg border border-border bg-panel">
            {rows.map((r) => (
              <AccountLine key={r.id} r={r} />
            ))}
            <li data-filter-empty hidden className="px-4 py-8 text-center text-sm text-muted-foreground">
              No accounts match.
            </li>
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            No accounts with a scope on file{selected ? ` for ${selected}` : ""} yet.
          </p>
        )}
      </section>

      <p className="mt-8 text-xs text-muted-foreground">
        Contract Start, Contract Due, Retention Due and Auto Renew on the Monday All Accounts board are copied from the
        scopes here, on every save and each weekday morning. Change them in Surroundings, not on the board.
      </p>

      {missing.length > 0 ? (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-muted-foreground transition-colors hover:text-foreground">
            {plural(missing.length, "client is", "clients are")} marked Retainer with no scope entered yet
          </summary>
          <ul className="mt-3 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2 lg:grid-cols-3">
            {missing.map((m) => (
              <li key={m.id} className="truncate">
                <Link href={`/client/${m.id}`} className="font-medium text-foreground hover:underline">
                  {m.name}
                </Link>
                <span className="text-muted-foreground"> · {m.am ?? "no AM"}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </PageContainer>
  );
}
