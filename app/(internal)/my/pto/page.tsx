// PTO — request form link + your request history + (for managers) a
// pending review queue, all sourced from the Monday PTO board live.

import Link from "next/link";
import { UserCheck, Users } from "lucide-react";
import { PageContainer } from "@/components/shell/page-container";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchAllTeamMembers } from "@/lib/monday/teams";
import {
  fetchPtoRequests,
  fetchPtoSchema,
  isPending,
  isOutToday,
  fmtPtoDate,
  type PtoRequest,
} from "@/lib/monday/pto";
import type { TeamProfile } from "@/lib/team/profile";
import { PtoForm } from "./pto-form";

export const dynamic = "force-dynamic";

export default async function PTOPage() {
  const supabase = createSupabaseServerClient();
  const [{ data: user }, pto, schema, members, profilesRes] = await Promise.all([
    supabase.auth.getUser(),
    fetchPtoRequests(),
    fetchPtoSchema(),
    fetchAllTeamMembers().catch(() => []),
    supabase.from("team_profiles").select("email, name, manager_email"),
  ]);

  const email = user.user?.email?.toLowerCase() ?? null;
  const profiles = (profilesRes.data ?? []) as Pick<
    TeamProfile,
    "email" | "name" | "manager_email"
  >[];

  // Map every signed-in team member to their Monday display name so we
  // can compare against the PTO board's "requestor" text column.
  const nameByEmail = new Map<string, string>();
  for (const m of members) {
    if (m.email) nameByEmail.set(m.email.toLowerCase(), m.name);
  }
  const myName = email ? nameByEmail.get(email) ?? null : null;

  // Who reports to me? If I'm a manager, the pending queue surfaces
  // those requests so I can walk over to Monday and approve them.
  const myReportsEmails = new Set<string>();
  for (const p of profiles) {
    if (p.manager_email?.toLowerCase() === email) {
      myReportsEmails.add(p.email.toLowerCase());
    }
  }
  const myReportsNames = new Set<string>();
  for (const em of myReportsEmails) {
    const n = nameByEmail.get(em) ?? profiles.find((p) => p.email === em)?.name;
    if (n) myReportsNames.add(n);
  }

  const items = pto.items;
  const mine = myName
    ? items.filter((r) => matchesPerson(r, myName, email))
    : [];
  const myPending = mine.filter(isPending);

  const pendingFromReports = items.filter(
    (r) => isPending(r) && r.requestor_name && myReportsNames.has(r.requestor_name)
  );

  return (
    <PageContainer>
      <header className="mb-8 border-b border-border/70 pb-6">
        <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          My Surroundings · PTO
        </div>
        <h1 className="mt-1.5 text-3xl font-semibold tracking-tight text-foreground md:text-[2.25rem]">
          Paid time off
        </h1>
        <p className="mt-2.5 max-w-prose text-[13px] leading-relaxed text-muted-foreground">
          Submit a PTO request below. Requests route to the Monday PTO board where your AM reviews and approves. Status updates sync back here.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        {/* Hub-native PTO form */}
        <PtoForm
          typeOptions={schema.typeLabels}
          defaultStatusLabel={schema.defaultStatusLabel}
        />

        {/* Your snapshot */}
        <section className="rounded-2xl border border-border/70 bg-panel p-5">
          <header className="mb-3 border-b border-border/60 pb-2.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Your snapshot
          </header>
          {!pto.ok ? (
            <p className="text-[12px] italic text-muted-foreground">
              Couldn&apos;t reach Monday. Reload in a moment.
            </p>
          ) : (
            <dl className="space-y-2.5 text-[12.5px]">
              <StatRow label="Requests this year" value={yearCount(mine)} />
              <StatRow
                label="Days taken (approved)"
                value={approvedDays(mine)}
              />
              <StatRow
                label="Pending approval"
                value={myPending.length}
                tone={myPending.length > 0 ? "warn" : undefined}
              />
            </dl>
          )}
        </section>
      </div>

      {/* Your requests */}
      <section className="mt-6 rounded-2xl border border-border/70 bg-panel p-5">
        <header className="mb-3 flex items-baseline justify-between border-b border-border/60 pb-2.5">
          <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            <UserCheck className="h-3.5 w-3.5" />
            Your requests
          </div>
          <span className="text-[11px] text-muted-foreground">
            {mine.length} total
          </span>
        </header>
        {mine.length === 0 ? (
          <p className="text-[12.5px] italic text-muted-foreground">
            No requests on file yet. Submit one above.
          </p>
        ) : (
          <ul className="divide-y divide-border/50">
            {mine
              .slice()
              .sort(sortByStart)
              .reverse()
              .slice(0, 8)
              .map((r) => (
                <RequestRow key={r.id} r={r} youAreOut={isOutToday(r)} />
              ))}
          </ul>
        )}
      </section>

      {/* Pending from my reports (manager-only) */}
      {pendingFromReports.length > 0 ? (
        <section className="mt-6 rounded-2xl border border-amber-200 bg-amber-50/60 p-5">
          <header className="mb-3 flex items-baseline justify-between border-b border-amber-200 pb-2.5">
            <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.14em] text-amber-900">
              <Users className="h-3.5 w-3.5" />
              Pending from your team
            </div>
            <span className="text-[11px] text-amber-900/80">
              {pendingFromReports.length} awaiting review
            </span>
          </header>
          <ul className="divide-y divide-amber-200/60">
            {pendingFromReports.map((r) => (
              <RequestRow key={r.id} r={r} manager />
            ))}
          </ul>
        </section>
      ) : null}

      <p className="mt-6 text-[11px] text-muted-foreground">
        Source:{" "}
        <a
          href="https://nauticalnetwork.monday.com/boards/9612850479"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-4 hover:text-foreground"
        >
          Monday PTO board
        </a>
        . Approvals happen there; status syncs back here.
      </p>
    </PageContainer>
  );
}

function StatRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "warn";
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={`font-mono text-[14px] font-semibold tabular-nums ${
          tone === "warn" ? "text-amber-700" : "text-foreground"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function RequestRow({
  r,
  youAreOut,
  manager,
}: {
  r: PtoRequest;
  youAreOut?: boolean;
  manager?: boolean;
}) {
  const statusTone =
    (r.status ?? "").toLowerCase().includes("approve")
      ? "text-emerald-700 bg-emerald-100"
      : (r.status ?? "").toLowerCase().includes("denied") ||
          (r.status ?? "").toLowerCase().includes("declined")
        ? "text-rose-700 bg-rose-100"
        : isPending(r)
          ? "text-amber-800 bg-amber-100"
          : "text-foreground/70 bg-secondary";
  const start = fmtPtoDate(r.start_date);
  const end = r.end_date && r.end_date !== r.start_date ? fmtPtoDate(r.end_date) : null;
  return (
    <li className="flex items-start justify-between gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-foreground">
            {manager && r.requestor_name
              ? r.requestor_name
              : r.kind ?? r.name ?? "PTO request"}
          </span>
          {youAreOut ? (
            <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-sky-900">
              Out now
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 text-[11.5px] text-muted-foreground">
          {start}
          {end ? ` – ${end}` : ""}
          {manager && r.requestor_name ? "" : r.kind ? ` · ${r.kind}` : ""}
        </div>
        {r.notes ? (
          <div className="mt-1 line-clamp-2 text-[11.5px] text-foreground/80">
            {r.notes}
          </div>
        ) : null}
      </div>
      <div className="flex flex-col items-end gap-1.5">
        {r.status ? (
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${statusTone}`}
          >
            {r.status}
          </span>
        ) : null}
        <Link
          href={r.monday_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10.5px] text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          Open
        </Link>
      </div>
    </li>
  );
}

function matchesPerson(r: PtoRequest, name: string, email: string | null): boolean {
  if (r.requestor_email && email && r.requestor_email.toLowerCase() === email) {
    return true;
  }
  if (r.requestor_name && name && r.requestor_name.trim() === name.trim()) {
    return true;
  }
  return false;
}

function sortByStart(a: PtoRequest, b: PtoRequest): number {
  const ad = a.start_date ?? "";
  const bd = b.start_date ?? "";
  return ad.localeCompare(bd);
}

function yearCount(items: PtoRequest[]): number {
  const y = new Date().getFullYear();
  return items.filter((r) => r.start_date && r.start_date.startsWith(String(y))).length;
}

function approvedDays(items: PtoRequest[]): number {
  let total = 0;
  for (const r of items) {
    if (!(r.status ?? "").toLowerCase().includes("approve")) continue;
    if (!r.start_date) continue;
    const start = new Date(r.start_date + "T00:00:00").getTime();
    const end = new Date((r.end_date ?? r.start_date) + "T00:00:00").getTime();
    if (isNaN(start) || isNaN(end)) continue;
    const days = Math.round((end - start) / 86400000) + 1;
    if (days > 0) total += days;
  }
  return total;
}
