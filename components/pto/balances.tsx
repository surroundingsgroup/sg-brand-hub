// PTO balances for the Time off page: whoever the viewer is allowed to see
// (themselves, their team, or everyone).
//
// Everyone with a worked-out balance (opening balance, plus what the policy
// gives, minus approved time off, with the 40-hour cap). The board columns
// ("Board says", "Difference", the reasons) only show while a live PTO board
// is being compared; the individual boards were retired 2026-11-23, so today
// they stay hidden. People with no opening are worked out from their start date alone.

import { PTO_POLICY } from "@/lib/pto/policy";
import { isNotTracked, type PtoPerson } from "@/lib/pto/team";
import type { LedgerAudit } from "@/lib/pto/ledgers";
import { cn } from "@/lib/utils";

const h = (n: number) => `${(Math.round(n * 10) / 10).toFixed(1)}`;
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "-" : ""}${h(Math.abs(n))}`;
const date = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

const TH = "px-3 py-2 text-right";
const LABEL = "mb-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground";

export function PtoBalances({
  people,
  audits,
  unmatched,
  everyone,
  asOf,
  title,
}: {
  people: PtoPerson[];
  audits: LedgerAudit[]; // people with their own PTO board
  unmatched: { name: string; requests: number }[];
  everyone: boolean; // the viewer sees the whole company
  asOf: string;
  title?: string;
}) {
  const onBoard = new Set(audits.map((a) => a.email).filter(Boolean));
  const rest = people.filter((p) => !onBoard.has(p.email) && !isNotTracked(p.name));
  const withDates = rest.filter((p) => p.statement).sort((a, b) => a.name.localeCompare(b.name));
  const noDate = rest.filter((p) => !p.statement).sort((a, b) => a.name.localeCompare(b.name));
  const open = people.flatMap((p) => p.open.map((r) => ({ ...r, who: p.name })));

  const off = audits.filter((a) => a.hasBoard && Math.abs(a.difference) >= 0.1);
  const match = audits.filter((a) => a.hasBoard && Math.abs(a.difference) < 0.1);
  const lostTotal = audits.reduce((n, a) => n + a.lostToCap, 0);
  // Board columns only while there is a live board to compare with.
  const boards = everyone && audits.some((a) => a.hasBoard);

  return (
    <section className="mb-6 rounded-2xl border border-border/70 bg-panel p-5">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 pb-2.5">
        <div className="text-[12.5px] font-extrabold uppercase tracking-[0.13em] text-foreground">{title ?? (everyone ? "PTO balances, everyone" : "PTO balances")}</div>
        <span className="text-[11px] text-muted-foreground">Hours, as of {date(asOf)}</span>
      </header>

      <p className="mb-3 max-w-3xl text-[12px] leading-relaxed text-muted-foreground">
        {PTO_POLICY.baseDays} days a year to start, one more day every work anniversary, earned over {PTO_POLICY.payPeriodsPerYear} pay periods. On each anniversary anything over{" "}
        {PTO_POLICY.rolloverCapHours} hours is lost.
        {everyone ? " Only you and Justin see this for now." : ""}
      </p>

      {audits.length ? (
        <>
          <div className="overflow-x-auto md:overflow-visible">
            <table data-filter-scope="pto" className="w-full min-w-[820px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border/60 text-left text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  <th className="sticky top-12 z-10 bg-panel md:top-14 py-2 pr-3">Person</th>
                  <th className="sticky top-12 z-10 bg-panel md:top-14 px-3 py-2">Started</th>
                  <th className={cn(TH, "sticky top-12 z-10 bg-panel md:top-14")}>Per pay period</th>
                  {boards ? <th className={cn(TH, "sticky top-12 z-10 bg-panel md:top-14")}>Board says</th> : null}
                  <th className={cn(TH, "sticky top-12 z-10 bg-panel md:top-14")}>{everyone ? "Checked" : "Balance"}</th>
                  {boards ? <th className={cn(TH, "sticky top-12 z-10 bg-panel md:top-14")}>Difference</th> : null}
                  {everyone ? <th className={cn(TH, "sticky top-12 z-10 bg-panel md:top-14")}>Lost to the cap</th> : null}
                  <th className={cn(TH, "sticky top-12 z-10 bg-panel md:top-14")}>Booked ahead</th>
                  <th className="sticky top-12 z-10 bg-panel md:top-14 py-2 pl-3 text-right">At risk on anniversary</th>
                </tr>
              </thead>
              <tbody>
                {audits.map((a) => (
                  <tr key={a.board || a.person} data-filter-row data-filter-text={a.person} data-filter-board={!a.hasBoard ? "" : Math.abs(a.difference) >= 0.1 ? "differs" : "matches"} className="border-b border-border/40 last:border-0">
                    <td className="py-2 pr-3 font-semibold text-foreground">
                      {everyone && a.hasBoard ? (
                        <a href={a.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                          {a.person}
                        </a>
                      ) : (
                        a.person
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{a.startDate ? date(a.startDate) : "not on file"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {(a.policyRate ?? a.boardRate).toFixed(2)}
                      {boards && a.hasBoard && a.policyRate != null && Math.abs(a.policyRate - a.boardRate) >= 0.05 ? <span className="ml-1 text-[10.5px] text-amber-700">board {a.boardRate.toFixed(2)}</span> : null}
                    </td>
                    {boards ? <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{a.hasBoard ? h(a.boardBalance) : "no board"}</td> : null}
                    <td className={cn("px-3 py-2 text-right font-bold tabular-nums", a.checked < 0 ? "text-red-700" : "text-foreground")}>{h(a.checked)}</td>
                    {boards ? (
                      <td className={cn("px-3 py-2 text-right tabular-nums", a.hasBoard && Math.abs(a.difference) >= 0.1 ? "text-amber-700" : "text-muted-foreground")}>{!a.hasBoard ? "" : Math.abs(a.difference) >= 0.1 ? signed(a.difference) : "matches"}</td>
                    ) : null}
                    {everyone ? <td className="px-3 py-2 text-right tabular-nums">{a.lostToCap ? h(a.lostToCap) : ""}</td> : null}
                    <td className="px-3 py-2 text-right tabular-nums">{a.booked ? h(a.booked) : ""}</td>
                    <td className={cn("py-2 pl-3 text-right tabular-nums", a.atRiskHours > 0 ? "text-amber-700" : "text-muted-foreground")}>
                      {a.nextAnniversary ? (a.atRiskHours > 0 ? `${h(a.atRiskHours)} on ${date(a.nextAnniversary)}` : date(a.nextAnniversary)) : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            {boards
              ? "Board says is what each person's PTO board on Monday adds up to. Checked starts from the board's opening balance, adds what the policy gives each pay period, takes off every approved request, and applies the cap at each anniversary. Both already have booked time off taken out."
              : everyone
                ? "Each balance starts from the person's opening balance (the October 2025 load-in, or zero for a 2026 hire), adds what the policy gives each pay period, takes off every approved request, and applies the cap on each anniversary. Booked time off is already taken out. The same numbers are on the PTO Balances board on Monday, updated every morning."
                : "Each balance already has booked time off taken out."}
          </p>

          {everyone && off.length ? (
            <div className="mt-5">
              <div className={LABEL}>Why the checked number differs from the board</div>
              <div className="space-y-3">
                {off.map((a) => (
                  <div key={a.board}>
                    <div className="text-[13px] font-semibold text-foreground">
                      {a.person}
                      <span className="ml-2 font-normal text-muted-foreground">
                        board {h(a.boardBalance)}, checked {h(a.checked)}
                      </span>
                    </div>
                    <ul className="mt-0.5 space-y-0.5 text-[12.5px] leading-relaxed text-foreground">
                      {a.reasons.map((r, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="w-14 flex-shrink-0 text-right tabular-nums text-muted-foreground">{signed(r.hours)}</span>
                          <span>{r.text}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              {lostTotal > 0 ? (
                <p className="mt-3 max-w-3xl text-[11.5px] leading-relaxed text-muted-foreground">
                  The cap accounts for {h(lostTotal)} of these hours. The boards have never applied it, so nobody has been told they lost that time. Checked plus Lost to the cap is what each person would have if the cap only
                  starts from their next anniversary.
                </p>
              ) : null}
            </div>
          ) : null}

          {everyone && match.length ? (
            <p className="mt-4 text-[12.5px] text-foreground">
              <span className="text-muted-foreground">Board and check agree: </span>
              {match.map((a) => a.person).join(", ")}
            </p>
          ) : null}

          {everyone && (audits.some((a) => a.toCheck.length) || audits.some((a) => !a.startDate)) ? (
            <div className="mt-4">
              <div className={LABEL}>To look at</div>
              <ul className="space-y-1 text-[12.5px] leading-relaxed">
                {audits.some((a) => !a.startDate) ? (
                  <li>
                    <span className="font-medium text-foreground">No start date on file: </span>
                    <span className="text-muted-foreground">
                      {audits
                        .filter((a) => !a.startDate)
                        .map((a) => a.person)
                        .join(", ")}
                      . Their amount per pay period could not be checked and no anniversary cap was applied. Add the date on their profile.
                    </span>
                  </li>
                ) : null}
                {audits.flatMap((a) =>
                  a.toCheck
                    .filter((t) => !t.startsWith("No start date on file"))
                    .map((t, i) => (
                      <li key={`${a.board}-${i}`}>
                        <span className="font-medium text-foreground">{a.person}: </span>
                        <span className="text-muted-foreground">{t}</span>
                      </li>
                    ))
                )}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}

      {withDates.length ? (
        <div className={audits.length ? "mt-6" : ""}>
          {audits.length ? <div className={LABEL}>No PTO board: worked out from the start date alone</div> : null}
          <div className="overflow-x-auto md:overflow-visible">
            <table data-filter-scope="pto" className="w-full min-w-[820px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border/60 text-left text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  <th className="sticky top-12 z-10 bg-panel md:top-14 py-2 pr-3">Person</th>
                  <th className="sticky top-12 z-10 bg-panel md:top-14 px-3 py-2">Started</th>
                  <th className={cn(TH, "sticky top-12 z-10 bg-panel md:top-14")}>Year</th>
                  <th className={cn(TH, "sticky top-12 z-10 bg-panel md:top-14")}>Yearly</th>
                  <th className={cn(TH, "sticky top-12 z-10 bg-panel md:top-14")}>Per pay period</th>
                  <th className={cn(TH, "sticky top-12 z-10 bg-panel md:top-14")}>Carried in</th>
                  <th className={cn(TH, "sticky top-12 z-10 bg-panel md:top-14")}>Earned</th>
                  <th className={cn(TH, "sticky top-12 z-10 bg-panel md:top-14")}>Used</th>
                  <th className={cn(TH, "sticky top-12 z-10 bg-panel md:top-14")}>Balance</th>
                  <th className={cn(TH, "sticky top-12 z-10 bg-panel md:top-14")}>Booked</th>
                  <th className="sticky top-12 z-10 bg-panel md:top-14 py-2 pl-3 text-right">At risk on anniversary</th>
                </tr>
              </thead>
              <tbody>
                {withDates.map((p) => {
                  const s = p.statement!;
                  return (
                    <tr key={p.email} data-filter-row data-filter-text={p.name} className="border-b border-border/40 last:border-0">
                      <td className="py-2 pr-3 font-semibold text-foreground">{p.name}</td>
                      <td className="px-3 py-2 text-muted-foreground">{date(s.startDate)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{s.serviceYear}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{h(s.allotmentHours)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{s.perPeriodHours.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{h(s.carriedIn)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{h(s.accruedThisYear)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {h(s.usedThisYear)}
                        {p.estimated ? <span className="ml-1 text-[10.5px] text-muted-foreground">*</span> : null}
                      </td>
                      <td className={cn("px-3 py-2 text-right font-bold tabular-nums", s.balance < 0 ? "text-red-700" : "text-foreground")}>{h(s.balance)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{s.scheduledHours ? h(s.scheduledHours) : ""}</td>
                      <td className={cn("py-2 pl-3 text-right tabular-nums", s.atRiskHours > 0 ? "text-amber-700" : "text-muted-foreground")}>
                        {s.atRiskHours > 0 ? `${h(s.atRiskHours)} on ${date(s.nextAnniversary)}` : date(s.nextAnniversary)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {withDates.some((p) => p.estimated) ? (
            <p className="mt-2 text-[11px] text-muted-foreground">* Some of this person&apos;s requests had no hours entered, so 8 hours a working day was assumed.</p>
          ) : null}
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            With no board there is no known opening balance, so this assumes every request since the start date is on the Monday boards. Where time off was never logged, the real balance is lower.
          </p>
        </div>
      ) : null}

      {noDate.length ? (
        <div className="mt-4">
          <div className={LABEL}>No PTO board and no start date on file</div>
          <p className="text-[12.5px] text-foreground">
            {noDate.map((p) => `${p.name}${p.counted ? ` (${p.counted} approved ${p.counted === 1 ? "request" : "requests"})` : ""}`).join(", ")}
          </p>
        </div>
      ) : null}

      {open.length ? (
        <div className="mt-4">
          <div className={LABEL}>Open requests, not counted yet</div>
          <ul className="space-y-1 text-[12.5px]">
            {open.map((r) => (
              <li key={r.url}>
                <a href={r.url} target="_blank" rel="noopener noreferrer" className="font-medium text-foreground hover:underline">
                  {r.who}
                </a>
                <span className="text-muted-foreground">
                  {" "}
                  {date(r.from)}
                  {r.to !== r.from ? ` to ${date(r.to)}` : ""}, {h(r.hours)} hours, {r.unpaid ? "unpaid" : "waiting for approval"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {everyone && unmatched.length ? (
        <div className="mt-4">
          <div className={LABEL}>On the time-off boards, no profile in Surroundings</div>
          <p className="text-[12.5px] text-foreground">{unmatched.map((u) => `${u.name} (${u.requests})`).join(", ")}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">Requests since last January.</p>
        </div>
      ) : null}
    </section>
  );
}
