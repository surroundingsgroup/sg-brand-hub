// One person's own PTO balance, in plain words: what they carried in, what
// they have earned and used since, what is booked, and what happens on their
// next anniversary. Read from the same check as the admin table.

import { PTO_POLICY } from "@/lib/pto/policy";
import type { LedgerAudit } from "@/lib/pto/ledgers";

const h = (n: number) => `${(Math.round(n * 10) / 10).toFixed(1)}`;
const date = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function PtoMyBalance({ audit, mine = true }: { audit: LedgerAudit | null; mine?: boolean }) {
  const cap = PTO_POLICY.rolloverCapHours;
  if (!audit) {
    return (
      <section className="mb-6 rounded-2xl border border-border/70 bg-panel p-5">
        <div className="text-[12.5px] font-extrabold uppercase tracking-[0.13em] text-foreground">{mine ? "Your balance" : "Balance"}</div>
        <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
          {mine ? "Your balance is not set up here yet. Ask Justin for your current hours." : "No balance is set up here for this person yet."} Requests still work as normal.
        </p>
      </section>
    );
  }
  const s = audit.since;
  const rate = audit.policyRate ?? audit.boardRate;
  const rows: { label: string; value: string; note?: string }[] = [
    {
      label: s.isOpening ? (s.carried > 0 ? `Balance on ${date(s.date)}` : `Started on ${date(audit.startDate ?? s.date)}`) : `Carried over on ${date(s.date)}, your anniversary`,
      value: h(s.carried),
      note: s.capped ? `${cap} hours is the most that carries over` : undefined,
    },
    { label: "Earned since", value: `+${h(s.earned)}`, note: `${rate.toFixed(2)} hours each pay period` },
    { label: "Used since", value: s.used ? `-${h(s.used)}` : "0.0" },
    ...(s.booked ? [{ label: "Booked ahead, approved", value: `-${h(s.booked)}` }] : []),
  ];
  return (
    <section className="mb-6 rounded-2xl border border-border/70 bg-panel p-5">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 pb-2.5">
        <div className="text-[12.5px] font-extrabold uppercase tracking-[0.13em] text-foreground">{mine ? "Your balance" : `${audit.person}: balance`}</div>
        <span className="text-[11px] text-muted-foreground">Hours</span>
      </header>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-[auto_minmax(0,1fr)] md:gap-8">
        <div>
          <div className={`text-[40px] font-bold leading-none tabular-nums ${audit.checked < 0 ? "text-red-700" : "text-foreground"}`}>{h(audit.checked)}</div>
          <div className="mt-1.5 text-[12px] text-muted-foreground">{s.booked ? "available after what is booked" : "available"}</div>
        </div>
        <dl className="space-y-1.5 text-[12.5px]">
          {rows.map((r) => (
            <div key={r.label} className="flex items-baseline justify-between gap-4">
              <dt className="text-muted-foreground">
                {r.label}
                {r.note ? <span className="ml-1.5 text-[11px]">({r.note})</span> : null}
              </dt>
              <dd className="font-medium tabular-nums text-foreground">{r.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      {audit.nextAnniversary ? (
        <p className={`mt-4 text-[12.5px] leading-relaxed ${audit.atRiskHours > 0 ? "text-amber-800" : "text-muted-foreground"}`}>
          {audit.atRiskHours > 0
            ? `On ${date(audit.nextAnniversary)}, your next anniversary, up to ${cap} hours carry over. As things stand ${h(audit.atRiskHours)} hours would not, so plan time off before then.`
            : `On ${date(audit.nextAnniversary)}, your next anniversary, up to ${cap} hours carry over. You are on track to keep all of it.`}
        </p>
      ) : null}
      {audit.checked < 0 ? <p className="mt-2 text-[12.5px] leading-relaxed text-red-700">You have used more than you have earned. New pay periods bring this back up.</p> : null}
      {audit.hasBoard && Math.abs(audit.difference) >= 0.5 ? (
        <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">
          Your PTO board in Monday shows {h(audit.boardBalance)}. This number replaces it: the board did not apply the anniversary carry-over or keep up with every change.
        </p>
      ) : null}
    </section>
  );
}
