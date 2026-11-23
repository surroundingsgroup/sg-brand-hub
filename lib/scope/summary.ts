// One client's contract health, worked out once and used everywhere: the
// Scope tile on the client page, the all-accounts view (/accounts) and the
// feed the Brief Tool reads for the morning email and calendar invites.
//
// Pure: pass in the scope, the client's dated Monday projects and (for a
// shared agreement) the partner's shoot rate. No I/O.

import type { BrandScope } from "./types";
import {
  contractBalance,
  contractHealth,
  contractPace,
  contractPeriods,
  kindCountsInContract,
  periodHealth,
  type ContractBalance,
  type ContractPace,
  type ContractPeriod,
  type DatedProject,
  type Health,
  type ProjectKind,
} from "./pace";

export type Level = "green" | "yellow" | "red";
export type Light = { scope: string; level: Level; label: string; reason: string | undefined };

export type ContractSummary = {
  quota: number; // shoots owed per period (combined, for a shared pool)
  paceScope: BrandScope;
  shootsThisPeriod: number; // shoots so far this calendar month
  kinds: Record<ProjectKind, number> | null;
  pace: ContractPace | null;
  timeline: ContractPeriod[]; // the whole term, period by period
  periods: ContractPeriod[]; // only the periods that have started
  lastClosed: ContractPeriod | undefined;
  currentPeriod: ContractPeriod | null;
  balance: ContractBalance;
  balanceNote: string | null;
  lastShoot: DatedProject | null;
  nextShoot: DatedProject | null;
  daysSinceLast: number | null;
  remaining: number | null;
  periodsLeft: number | null;
  perPeriod: number | null;
  unit: string; // "month", "quarter", ...
  daysToRenewal: number | null;
  monthHealth: Health | null;
  health: Health | null;
  contractReason: string | null;
  lights: Light[];
  // The term in force today, and how many times it has auto-renewed past the
  // dates typed on the record.
  term: { start: string | null; end: string | null; renewal: string | null; rolled: number };
  // Set when the term's first periods are older than the Monday board's
  // records: how many periods, and the first period that IS counted.
  records: { unrecorded: number; from: string; countedFrom: string | null } | null;
  // Set when the term on file has ended but work has carried on: everything
  // dated after the end date. Shown, never counted against the ended term.
  afterTerm: { since: string; shoots: DatedProject[]; micro: number; edits: number } | null;
};

// ── One clock for all contract maths ─────────────────────────────────────────
// The team works on New York time. "Now" is that calendar date at noon, built
// from the date itself rather than from the machine's clock, so the server
// (which runs on UTC) and a browser in any time zone always land on the same
// answers. Without this the two disagreed for part of every evening, and the
// page had to throw away the server's HTML and draw itself again.

/** Today's calendar date in New York, as YYYY-MM-DD. Same answer on any machine. */
export function easternToday(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** A calendar date (YYYY-MM-DD) as a Date at noon. */
export function noonOn(dateIso: string): Date {
  return new Date(dateIso.slice(0, 10) + "T12:00:00");
}

/** The "now" every contract calculation should use. */
export function contractNow(): Date {
  return noonOn(easternToday());
}

// ── The term in force today ──────────────────────────────────────────────────
// What is typed on a contract is not always the term we are in:
//   • An auto-renewing agreement does not lapse when its end date passes. It
//     renews, so the dates roll forward by one term (as many times as needed).
//   • A record may hold the original start with the current end ("started Feb
//     2025, renews every 6 months, due Jan 31, 2027"). The term in force is
//     the last renewal term, not the whole two years.
// Everything downstream (pace, lights, renewal clock, calendar invites) works
// from the term this returns. Contracts that do NOT auto-renew are left
// exactly as typed, so a passed end date still shows as lapsed.
const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const plusMonths = (d: Date, n: number) => {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
};
const plusDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

export function effectiveScope(scope: BrandScope, now: Date = contractNow()): BrandScope & { rolled?: number } {
  if (!scope.start_date || !scope.end_date) return scope;
  const start = noonOn(scope.start_date);
  let end = noonOn(scope.end_date);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return scope;
  // Term length: stated, or the span from Start to the day after End.
  const dayAfterEnd = plusDays(end, 1);
  let span = (dayAfterEnd.getFullYear() - start.getFullYear()) * 12 + (dayAfterEnd.getMonth() - start.getMonth());
  if (dayAfterEnd.getDate() < start.getDate()) span -= 1;
  const stated = !!scope.renewal_months && scope.renewal_months > 0;
  const len = stated ? Math.round(scope.renewal_months as number) : span;
  if (len < 1) return scope;
  const today = new Date(now);
  today.setHours(12, 0, 0, 0);
  let rolled = 0;
  if (scope.auto_renew) {
    while (today > end && rolled < 240) {
      end = plusDays(plusMonths(plusDays(end, 1), len), -1);
      rolled++;
    }
  }
  // The term in force starts one term-length before the day after its end,
  // but never before the contract itself began.
  const termStart = plusMonths(plusDays(end, 1), -len);
  const currentStart = termStart > start ? termStart : start;
  // Nothing renewed and no separate renewal length: the dates stand as typed.
  if (!rolled && (!stated || currentStart.getTime() === start.getTime())) return scope;
  return {
    ...scope,
    start_date: isoDay(currentStart),
    end_date: isoDay(end),
    renewal_date: isoDay(plusDays(end, 1)),
    rolled,
  };
}

export function daysUntil(iso: string | undefined | null, now: Date = contractNow()): number | null {
  if (!iso) return null;
  const then = new Date(iso + "T12:00:00").getTime();
  if (isNaN(then)) return null;
  return Math.round((then - now.getTime()) / 86400000);
}

export function summarizeContract(
  typedScope: BrandScope,
  datedProjects: DatedProject[],
  pool: { partnerRate: number | null } | null = null,
  now: Date = contractNow(),
  // recordsFrom: the day the Monday All Projects board's records begin
  // (lib/monday/projects.ts). Contract periods that began before it are not
  // judged, because the board cannot say what happened in them.
  opts: { recordsFrom?: string | null } = {}
): ContractSummary {
  const recordsFrom = opts.recordsFrom ?? null;
  // Work from the term in force today (auto-renewals rolled forward).
  const scope = effectiveScope(typedScope, now);
  const daysToRenewal = daysUntil(scope.renewal_date, now);

  // Shoots = Monday projects typed "Professional Content Shoot". With a
  // shared pool, both clients' shoots count against the combined quota.
  const ownRate = scope.shoots_per_period ?? 1;
  const quota = pool ? ownRate + (pool.partnerRate ?? ownRate) : ownRate;
  const paceScope: BrandScope = pool ? { ...scope, shoots_per_period: quota } : scope;
  const shootDates = datedProjects.filter((p) => p.kind === "shoot").map((p) => p.date);
  const monthStart = new Date(now);
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const shootsThisPeriod = shootDates.filter((iso) => {
    // A date with no time is a calendar day, not midnight UTC.
    const d = iso.length <= 10 ? noonOn(iso) : new Date(iso);
    return !isNaN(d.getTime()) && d >= monthStart && d <= endOfToday;
  }).length;
  const kinds = kindCountsInContract(scope, datedProjects, now);

  // Macro view: shoots owed vs done since the contract started.
  const pace = contractPace(paceScope, shootDates, now, { recordsFrom });
  // The whole term, one entry per contract period (past, current, and the
  // ones still to come when the contract has an end date).
  const timeline = contractPeriods(paceScope, datedProjects, now, { includeFuture: true, recordsFrom }) ?? [];
  // The shoot log lists only what has started.
  const periods = timeline.filter((per) => !per.future);
  // "Due by the end of Oct" — the last period that has fully passed.
  const lastClosed = [...periods].reverse().find((per) => !per.inProgress);
  // Make-ups: which short periods the extra shoots have covered.
  const balance = contractBalance(timeline);
  const names = (idx: number[]) => {
    const list = idx.map((i) => timeline.find((per) => per.index === i)?.short ?? "").filter(Boolean);
    return list.length <= 1 ? (list[0] ?? "") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
  };
  const shortIdx = Object.entries(balance.byIndex)
    .filter(([, b]) => b.madeUp + b.missed > 0)
    .map(([i]) => Number(i));
  const coverIdx = [...new Set(Object.values(balance.byIndex).flatMap((b) => b.coveredBy))].sort((a, b) => a - b);
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const bankNote = balance.banked > 0 ? `${plural(balance.banked, "extra shoot")} still in the bank` : "";
  const balanceNote =
    balance.shortTotal === 0
      ? balance.banked > 0
        ? `${plural(balance.banked, "extra shoot")} in the bank, beyond what the contract has called for so far.`
        : null
      : balance.missedTotal === 0
        ? `${names(shortIdx)} ${shortIdx.length === 1 ? "was" : "were"} short by ${balance.shortTotal}. Extra shoots in ${names(coverIdx)} made that up${bankNote ? `, with ${bankNote}` : ""}.`
        : balance.madeUpTotal > 0
          ? `${names(shortIdx)} ${shortIdx.length === 1 ? "was" : "were"} short by ${balance.shortTotal}. Extra shoots in ${names(coverIdx)} made up ${balance.madeUpTotal}; ${balance.missedTotal} still owed.`
          : `${names(shortIdx)} ${shortIdx.length === 1 ? "was" : "were"} short by ${balance.shortTotal}, not made up yet.`;

  // Last / next shoot: what actually happened and what is booked, whether or
  // not it falls inside the term on file. (A shoot after a lapsed term is
  // still the last shoot.)
  const asDay = (iso: string) => (iso.length <= 10 ? noonOn(iso) : new Date(iso));
  const allShoots = datedProjects
    .filter((p) => p.kind === "shoot" && !isNaN(asDay(p.date).getTime()))
    .sort((a, b) => asDay(a.date).getTime() - asDay(b.date).getTime());
  const happened = allShoots.filter((p) => asDay(p.date) <= endOfToday);
  const lastShoot = happened.length ? happened[happened.length - 1] : null;
  const nextShoot = allShoots.find((p) => asDay(p.date) > endOfToday) ?? null;

  // Work dated after the term on file ended (the term has lapsed, the work
  // has not). Listed so the page never contradicts the board.
  const termEnd = scope.end_date ? noonOn(scope.end_date) : null;
  const lapsed = !!termEnd && !isNaN(termEnd.getTime()) && endOfToday > new Date(termEnd.getTime() + 86400000 / 2);
  const afterEnd = lapsed
    ? datedProjects.filter((p) => {
        const d = asDay(p.date);
        return !isNaN(d.getTime()) && d.getTime() > termEnd!.getTime() + 86400000 / 2 && d <= endOfToday;
      })
    : [];
  const afterTerm =
    lapsed && afterEnd.length
      ? {
          since: scope.end_date as string,
          shoots: afterEnd.filter((p) => p.kind === "shoot").sort((a, b) => asDay(a.date).getTime() - asDay(b.date).getTime()),
          micro: afterEnd.filter((p) => p.kind === "micro").length,
          edits: afterEnd.filter((p) => p.kind === "edit").length,
        }
      : null;

  // Which part of the term the board can speak to.
  const firstCounted = timeline.find((per) => !per.noRecord) ?? null;
  const records =
    pace && pace.unrecorded > 0 && recordsFrom
      ? {
          unrecorded: pace.unrecorded,
          from: recordsFrom,
          // "Feb 2026": the month the first counted period begins.
          countedFrom: firstCounted
            ? noonOn(firstCounted.start).toLocaleDateString("en-US", { month: "short", year: "numeric" })
            : null,
        }
      : null;
  const currentPeriod = periods.find((per) => per.inProgress) ?? null;
  const daysSinceLast = lastShoot ? Math.max(0, -(daysUntil(lastShoot.date.slice(0, 10), now) ?? 0)) : null;
  const remaining = pace && pace.total != null ? Math.max(0, pace.total - pace.done) : null;
  const periodsLeft =
    pace && pace.periodCount != null && pace.status !== "complete" && pace.inProgressQuota > 0
      ? Math.max(1, pace.periodCount - pace.periodIndex + 1)
      : null;
  const unit = pace ? pace.unitLabel.toLowerCase() : "period";
  const perPeriod = remaining != null && periodsLeft ? remaining / periodsLeft : null;
  // Two lights: this period, then the full contract.
  const monthHealth = pace && pace.status !== "complete" ? periodHealth(currentPeriod) : null;
  const health = pace ? contractHealth(pace, { renewalOverdue: daysToRenewal != null && daysToRenewal < 0 }) : null;
  // The contract line carries the make-up story when there is one; otherwise the running total.
  const contractReason =
    !pace || !health
      ? null
      : (health.reason ??
        balanceNote ??
        `${pace.done}${pace.total != null ? ` of ${pace.total}` : ""} shoots done${
          pace.expectedToDate > 0
            ? `, ${pace.expectedToDate} were due by ${
                lastClosed ? noonOn(lastClosed.end).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : `the end of last ${unit}`
              }`
            : ""
        }.`);
  const lights = [
    monthHealth ? { scope: `This ${unit}`, ...monthHealth } : null,
    health ? { scope: "Full contract", level: health.level, label: health.label, reason: contractReason ?? undefined } : null,
  ].filter((x): x is Light => !!x);

  return {
    quota,
    paceScope,
    shootsThisPeriod,
    kinds,
    pace,
    timeline,
    periods,
    lastClosed,
    currentPeriod,
    balance,
    balanceNote,
    lastShoot,
    nextShoot,
    daysSinceLast,
    remaining,
    periodsLeft,
    perPeriod,
    unit,
    daysToRenewal,
    monthHealth,
    health,
    contractReason,
    lights,
    term: {
      start: scope.start_date ?? null,
      end: scope.end_date ?? null,
      renewal: scope.renewal_date ?? null,
      rolled: (scope as { rolled?: number }).rolled ?? 0,
    },
    records,
    afterTerm,
  };
}

// ── The one-line version, for lists and alerts ───────────────────────────────

export type RenewalStage = "overdue" | "this_week" | "this_month" | "soon" | "later" | "none";

export function renewalStage(days: number | null): RenewalStage {
  if (days == null) return "none";
  if (days < 0) return "overdue";
  if (days <= 14) return "this_week";
  if (days <= 30) return "this_month";
  if (days <= 90) return "soon";
  return "later";
}

const RANK: Record<Level, number> = { red: 0, yellow: 1, green: 2 };

/** The worst of the lights plus the renewal clock: what colour the row gets. */
export function overallLevel(s: ContractSummary): Level | null {
  const levels: Level[] = s.lights.map((l) => l.level);
  const stage = renewalStage(s.daysToRenewal);
  if (stage === "overdue") levels.push("red");
  else if (stage === "this_week" || stage === "this_month") levels.push("yellow");
  if (!levels.length) return null;
  return levels.sort((a, b) => RANK[a] - RANK[b])[0];
}
