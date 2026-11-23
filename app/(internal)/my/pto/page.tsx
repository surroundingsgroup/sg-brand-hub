// Time off: the request form, your own requests, and (for a manager) the
// requests waiting on you. Everything is read from and written to the Monday
// "Time Off Request" board, where approvals happen.
//
// Balances are not shown to the team yet (PTO_OPEN_TO_TEAM). Billy and Justin
// see everyone's under Account health, at /accounts/pto.

import Link from "next/link";
import { UserCheck, Users } from "lucide-react";
import { PageContainer } from "@/components/shell/page-container";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/access";
import { fetchPtoRequests, fetchPtoTypes, fmtPtoDate, isApproved, isOutToday, isPending, isRejected, PTO_BOARD_URL, teamFor, type PtoRequest } from "@/lib/monday/pto";
import { PtoForm } from "./pto-form";
import { PtoDecide } from "@/components/my/pto-decide";
import { PtoBalances } from "@/components/pto/balances";
import { PtoMyBalance } from "@/components/pto/my-balance";
import { fetchPtoEntries, isFormerTeam, isNotTracked, PTO_OPEN_TO_TEAM, sameRequester, type ProfileRow } from "@/lib/pto/team";
import { auditEveryone, fetchLedgers, type LedgerAudit } from "@/lib/pto/ledgers";

export const dynamic = "force-dynamic";

export default async function PTOPage({ searchParams }: { searchParams: { as?: string } }) {
  const supabase = createSupabaseServerClient();
  const [viewer, pto, types, profilesRes] = await Promise.all([
    getViewer(supabase),
    fetchPtoRequests(),
    fetchPtoTypes(),
    supabase.from("team_profiles").select("email, name, manager_email, start_date"),
  ]);
  const profiles = (profilesRes.data ?? []) as unknown as ProfileRow[];
  // Billy and Justin can open the page as someone else sees it: /my/pto?as=Morgan Finger. Requests are off in that view.
  const asName = viewer.everyone ? searchParams.as?.trim() : undefined;
  const preview = asName ? profiles.find((p) => p.name && sameRequester(asName, p.name)) ?? null : null;
  const email = preview ? preview.email.toLowerCase() : viewer.email;
  const me = email ? profiles.find((p) => p.email.toLowerCase() === email) : undefined;
  const myName = me?.name?.trim() || null;
  const managerName = me?.manager_email ? profiles.find((p) => p.email.toLowerCase() === me.manager_email!.toLowerCase())?.name ?? null : null;
  const { approver, team: myTeam } = teamFor(managerName, myName);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const year = today.slice(0, 4);

  // Requests are filed under the person's name.
  const mine = myName ? pto.items.filter((r) => sameRequester(r.name, myName)) : [];
  const myPending = mine.filter(isPending);
  const thisYear = mine.filter((r) => (r.start_date ?? "").startsWith(year));
  const approvedHours = thisYear.filter(isApproved).reduce((n, r) => n + (r.hours ?? 0), 0);

  // Waiting on me: I am the approver on it, or it is from someone who reports to me. Nothing that ended over a month ago.
  const reportRows = email ? profiles.filter((p) => p.manager_email?.toLowerCase() === email && p.name) : [];
  const reports = reportRows.map((p) => p.name as string);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const waitingOnMe = myName
    ? pto.items.filter(
        (r) =>
          isPending(r) &&
          !sameRequester(r.name, myName) &&
          (r.end_date ?? r.start_date ?? "9999") >= monthAgo &&
          ((!!r.approver && sameRequester(r.approver, myName)) || reports.some((n) => sameRequester(r.name, n)))
      )
    : [];

  // Who is out: approved and waiting requests that have not ended yet, for the next three months. The form uses the
  // same list to say who is already off on the dates being picked, so time off does not pile up on the same days.
  const horizon = new Date(Date.now() + 92 * 86400000).toISOString().slice(0, 10);
  const titleCase = (s: string) => s.replace(/\b([a-z])/g, (c) => c.toUpperCase());
  const upcoming = pto.items
    .filter((r) => r.start_date && (r.end_date ?? r.start_date) >= today && (isApproved(r) || isPending(r)) && !isFormerTeam(r.name))
    .map((r) => ({
      id: r.id,
      name: r.requestor_name && sameRequester(r.name, r.requestor_name) ? r.requestor_name : titleCase(r.name),
      team: r.team,
      from: r.start_date as string,
      to: r.end_date ?? (r.start_date as string),
      approved: isApproved(r),
      mine: !!myName && sameRequester(r.name, myName),
    }))
    .sort((a, b) => a.from.localeCompare(b.from));
  const whoIsOut = upcoming.filter((r) => r.from <= horizon);
  // Handbook 6.2: PTO cannot be used in the first 90 days.
  const startDate = me?.start_date?.slice(0, 10) || null;
  const eligibleFrom = startDate ? new Date(Date.parse(`${startDate}T12:00:00Z`) + 90 * 86400000).toISOString().slice(0, 10) : null;

  // Balances: your own, and your team's if you manage people. Everyone's is under Account health, for admins.
  let myAudit: LedgerAudit | null = null;
  let teamAudits: LedgerAudit[] = [];
  let balancesOk = false;
  if (email && (PTO_OPEN_TO_TEAM || preview)) {
    const [usage, ledgers] = await Promise.all([fetchPtoEntries(), fetchLedgers()]);
    if (usage.ok && ledgers.ok) {
      balancesOk = true;
      const all = auditEveryone(ledgers.ledgers, profiles, usage.entries, today);
      myAudit = all.find((a) => a.email === email) ?? null;
      const reportEmails = new Set(reportRows.map((p) => p.email.toLowerCase()));
      teamAudits = all.filter((a) => a.email && reportEmails.has(a.email));
    }
  }
  // An admin with no PTO board of their own does not need the "not set up" card.
  const showMine = balancesOk && !isNotTracked(myName) && (!!myAudit || !!preview || !viewer.everyone);

  return (
    <PageContainer>
      <header className="mb-8 border-b border-border/70 pb-6">
        <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">My Surroundings · Time off</div>
        <h1 className="mt-1.5 text-3xl font-semibold tracking-tight text-foreground md:text-[2.25rem]">Time off</h1>
        <p className="mt-2.5 max-w-prose text-[13px] leading-relaxed text-muted-foreground">
          Ask for time off here. Your request goes to {approver} to approve, and the answer shows up below.
        </p>
        {viewer.everyone ? (
          <Link href="/accounts/pto" className="mt-3 inline-flex text-[12.5px] font-medium text-foreground underline underline-offset-4 hover:opacity-70">
            Everyone&apos;s balances and the board check
          </Link>
        ) : null}
      </header>

      {preview ? (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-[12.5px] text-amber-900">
          <span>
            You are looking at this page as <span className="font-semibold">{preview.name}</span> sees it. Requests are switched off in this view.
          </span>
          <Link href="/my/pto" className="font-medium underline underline-offset-4">
            Back to my own
          </Link>
        </div>
      ) : null}

      {showMine ? <PtoMyBalance audit={myAudit} /> : null}
      {teamAudits.length ? <PtoBalances title="Your team" people={[]} audits={teamAudits} unmatched={[]} everyone={false} asOf={today} /> : null}

      <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        {preview ? (
          <div className="rounded-2xl border border-dashed border-border bg-panel p-6 text-[12.5px] leading-relaxed text-muted-foreground">
            The request form sits here. It would file as {preview.name}, go to {approver}, and show who is already off on the dates picked.
          </div>
        ) : (
          <PtoForm
            typeOptions={types}
            name={myName}
            approver={approver}
            myTeam={myTeam}
            others={upcoming.filter((r) => !r.mine)}
            eligibleFrom={eligibleFrom && eligibleFrom > today ? eligibleFrom : null}
            balance={balancesOk && myAudit ? myAudit.checked : null}
          />
        )}

        <section className="rounded-2xl border border-border/70 bg-panel p-5">
          <header className="mb-3 border-b border-border/60 pb-2.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Your {year}</header>
          {!pto.ok ? (
            <p className="text-[12px] text-muted-foreground">Couldn&apos;t reach Monday. Reload in a moment.</p>
          ) : (
            <dl className="space-y-2.5 text-[12.5px]">
              <StatRow label="Requests" value={thisYear.length} />
              <StatRow label="Hours approved" value={approvedHours} />
              <StatRow label="Waiting for approval" value={myPending.length} tone={myPending.length > 0 ? "warn" : undefined} />
            </dl>
          )}
        </section>
      </div>

      <section className="mt-6 rounded-2xl border border-border/70 bg-panel p-5">
        <header className="mb-3 flex items-baseline justify-between border-b border-border/60 pb-2.5">
          <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            <UserCheck className="h-3.5 w-3.5" />
            Your requests
          </div>
          <span className="text-[11px] text-muted-foreground">{mine.length} total</span>
        </header>
        {mine.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">No requests yet.</p>
        ) : (
          <ul className="divide-y divide-border/50">
            {mine
              .slice()
              .sort((a, b) => (b.start_date ?? "").localeCompare(a.start_date ?? ""))
              .slice(0, 10)
              .map((r) => (
                <RequestRow key={r.id} r={r} out={isOutToday(r, today)} />
              ))}
          </ul>
        )}
      </section>

      <section className="mt-6 rounded-2xl border border-border/70 bg-panel p-5">
        <header className="mb-3 flex items-baseline justify-between border-b border-border/60 pb-2.5">
          <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            Who is out
          </div>
          <span className="text-[11px] text-muted-foreground">The next three months</span>
        </header>
        {whoIsOut.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">Nobody has time off booked in the next three months.</p>
        ) : (
          <ul className="divide-y divide-border/50">
            {whoIsOut.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <span className="text-[13px] font-medium text-foreground">{r.name}</span>
                  {r.team ? <span className="ml-2 text-[11.5px] text-muted-foreground">{r.team}</span> : null}
                </div>
                <div className="flex flex-shrink-0 items-center gap-2 text-[12px] text-muted-foreground">
                  <span className="tabular-nums">
                    {fmtPtoDate(r.from)}
                    {r.to !== r.from ? ` to ${fmtPtoDate(r.to)}` : ""}
                  </span>
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${r.approved ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{r.approved ? "Approved" : "Waiting"}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {waitingOnMe.length > 0 ? (
        <section className="mt-6 rounded-2xl border border-amber-200 bg-amber-50/60 p-5">
          <header className="mb-3 flex items-baseline justify-between border-b border-amber-200 pb-2.5">
            <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.14em] text-amber-900">
              <Users className="h-3.5 w-3.5" />
              Waiting on you
            </div>
            <span className="text-[11px] text-amber-900/80">Approve here or in Monday</span>
          </header>
          <ul className="divide-y divide-amber-200/60">
            {waitingOnMe.map((r) => (
              <RequestRow key={r.id} r={r} showName decide={!preview} />
            ))}
          </ul>
        </section>
      ) : null}

      <p className="mt-6 text-[11px] text-muted-foreground">
        Requests live on the{" "}
        <a href={PTO_BOARD_URL} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-foreground">
          Monday Time Off Request board
        </a>
        . Approvals happen there.
      </p>
    </PageContainer>
  );
}

function StatRow({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`text-[14px] font-semibold tabular-nums ${tone === "warn" ? "text-amber-700" : "text-foreground"}`}>{value}</span>
    </div>
  );
}

function RequestRow({ r, out, showName, decide }: { r: PtoRequest; out?: boolean; showName?: boolean; decide?: boolean }) {
  const tone = isApproved(r) ? "text-emerald-800 bg-emerald-100" : isRejected(r) ? "text-red-800 bg-red-100" : isPending(r) ? "text-amber-800 bg-amber-100" : "text-foreground/70 bg-secondary";
  const start = fmtPtoDate(r.start_date);
  const end = r.end_date && r.end_date !== r.start_date ? fmtPtoDate(r.end_date) : null;
  const dates = start ? `${start}${end ? ` to ${end}` : ""}` : "No dates on the request";
  const detail = [/half/i.test(r.kind ?? "") ? "Half day" : null, r.hours != null ? `${r.hours} hours` : null].filter(Boolean).join(" · ");
  return (
    <li className="flex items-start justify-between gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-foreground">{showName ? r.name : dates}</span>
          {out ? <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-sky-900">Out now</span> : null}
        </div>
        <div className="mt-0.5 text-[11.5px] text-muted-foreground">{[showName ? dates : null, detail].filter(Boolean).join(" · ")}</div>
      </div>
      <div className="flex flex-col items-end gap-1.5">
        {decide && isPending(r) ? <PtoDecide itemId={r.id} /> : <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${tone}`}>{r.status ?? "New request"}</span>}
        <Link href={r.monday_url} target="_blank" rel="noopener noreferrer" className="text-[10.5px] text-muted-foreground underline underline-offset-4 hover:text-foreground">
          Open in Monday
        </Link>
      </div>
    </li>
  );
}
