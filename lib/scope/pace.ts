// Contract-to-date pace: are we fulfilling the shoots the contract owes?
//
// The Scope tile already shows the MICRO view (this month's shoots vs quota).
// This is the MACRO view: since the contract started, how many shoots were
// owed for the periods that have fully passed, how many actually happened,
// and how that sits against the full term.
//
// Example: monthly cadence, 1 shoot/period, 7 full months elapsed, 5 shoots
// done → expectedToDate 7, done 5, delta -2 → "behind by 2".
//
// Pure functions, no I/O — the page passes in the client's shoot dates.

import type { BrandScope, ShootCadence } from "./types";

// Cadences with a fixed rhythm. per-event / ad-hoc have no owed-per-period
// number, so there is nothing to pace against.
const MONTHS_PER_PERIOD: Partial<Record<ShootCadence, number>> = {
  monthly: 1,
  "bi-monthly": 2,
  quarterly: 3,
};
const DAYS_PER_PERIOD: Partial<Record<ShootCadence, number>> = {
  weekly: 7,
  "bi-weekly": 14,
};
const UNIT_LABEL: Partial<Record<ShootCadence, string>> = {
  weekly: "Week",
  "bi-weekly": "Period",
  monthly: "Month",
  "bi-monthly": "Period",
  quarterly: "Quarter",
};

export type PaceStatus = "not_started" | "behind" | "on_track" | "ahead" | "complete";

export type ContractPace = {
  done: number; // shoots since contract start (through today, or term end)
  expectedToDate: number; // owed for periods that have fully passed
  inProgressQuota: number; // owed for the current, unfinished period
  total: number | null; // owed over the full term (null = open-ended)
  periodIndex: number; // 1-based number of the current period
  periodCount: number | null; // periods in the full term (null = open-ended)
  unitLabel: string; // "Month", "Quarter", ...
  delta: number; // done - expectedToDate (negative = behind)
  status: PaceStatus;
};

function day(iso: string): Date | null {
  // Accepts "YYYY-MM-DD" or a full ISO timestamp; normalizes to local noon so
  // date math never slips a day across DST or timezone edges.
  const d = new Date(iso.length <= 10 ? iso + "T12:00:00" : iso);
  if (isNaN(d.getTime())) return null;
  d.setHours(12, 0, 0, 0);
  return d;
}

function addMonths(d: Date, n: number): Date {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}

// Whole calendar months from a → b (0 if b is before a).
function fullMonthsBetween(a: Date, b: Date): number {
  let m = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() < a.getDate()) m -= 1;
  return Math.max(0, m);
}

function daysBetween(a: Date, b: Date): number {
  return Math.max(0, Math.floor((b.getTime() - a.getTime()) / 86400000));
}

export function contractPace(
  scope: BrandScope | null | undefined,
  shootDates: string[],
  now: Date = new Date()
): ContractPace | null {
  if (!scope?.start_date || !scope.shoot_cadence) return null;
  const rate = scope.shoots_per_period ?? 0;
  if (rate <= 0) return null;
  const monthsPer = MONTHS_PER_PERIOD[scope.shoot_cadence];
  const daysPer = DAYS_PER_PERIOD[scope.shoot_cadence];
  if (!monthsPer && !daysPer) return null; // per-event / ad-hoc

  const start = day(scope.start_date);
  if (!start) return null;
  const today = new Date(now);
  today.setHours(12, 0, 0, 0);

  // Term end is inclusive on the form; work with the day after it.
  const endInclusive = scope.end_date ? day(scope.end_date) : null;
  const endExclusive = endInclusive ? new Date(endInclusive.getTime() + 86400000) : null;

  const periodsBetween = (a: Date, b: Date, roundUp: boolean): number => {
    if (monthsPer) {
      const months = fullMonthsBetween(a, b);
      const leftover = addMonths(a, months) < b;
      const total = roundUp && leftover ? months + 1 : months;
      return roundUp ? Math.ceil(total / monthsPer) : Math.floor(total / monthsPer);
    }
    const days = daysBetween(a, b);
    return roundUp ? Math.ceil(days / daysPer!) : Math.floor(days / daysPer!);
  };

  const periodCount = endExclusive ? Math.max(1, periodsBetween(start, endExclusive, true)) : null;
  const total = periodCount != null ? periodCount * rate : null;
  const unitLabel = UNIT_LABEL[scope.shoot_cadence] ?? "Period";

  if (today < start) {
    return {
      done: 0,
      expectedToDate: 0,
      inProgressQuota: 0,
      total,
      periodIndex: 0,
      periodCount,
      unitLabel,
      delta: 0,
      status: "not_started",
    };
  }

  const termOver = !!endExclusive && today >= endExclusive;
  const asOf = termOver ? endExclusive! : today;

  let completed = periodsBetween(start, asOf, false);
  if (periodCount != null) completed = Math.min(completed, periodCount);
  const expectedToDate = completed * rate;
  const inProgressQuota = termOver ? 0 : rate;
  const periodIndex = termOver ? (periodCount ?? completed) : completed + 1;

  // Shoots that have actually happened inside the contract window.
  const windowEnd = termOver ? endExclusive! : new Date(today.getTime() + 86400000 / 2); // through end of today
  const done = shootDates.filter((iso) => {
    const d = day(iso);
    return !!d && d >= start && d < windowEnd;
  }).length;

  const delta = done - expectedToDate;
  let status: PaceStatus;
  if (termOver) status = total != null && done >= total ? "complete" : "behind";
  else if (delta < 0) status = "behind";
  else if (done > expectedToDate + inProgressQuota) status = "ahead";
  else status = "on_track";

  return { done, expectedToDate, inProgressQuota, total, periodIndex, periodCount, unitLabel, delta, status };
}

// ── What counts as a shoot ───────────────────────────────────────────────────
// Source of truth is the Monday 🚦 All Projects board: Client + Project Type +
// Shoot Date. A contracted shoot day is a "Professional Content Shoot" — or
// one of the older package types that were used for the same thing before the
// Project Type list was simplified (confirmed by Billy 2026-11-22).
// "Micro Content Shoot" and "Edit Request" are tracked separately; every other
// Project Type (video assets, graphics, other old packages...) is "other" and
// is shown but not counted toward the shoot quota.
export type ProjectKind = "shoot" | "micro" | "edit" | "other";

const SHOOT_TYPES = new Set([
  "professional content shoot",
  // older names for a professional content shoot
  "professional showcase package",
  "social media content session",
  "event coverage package",
  "custom package",
]);

export function projectKind(projectType: string | null | undefined): ProjectKind {
  const t = (projectType ?? "").trim().toLowerCase();
  if (SHOOT_TYPES.has(t)) return "shoot";
  if (t === "micro content shoot") return "micro";
  if (t === "edit request") return "edit";
  return "other";
}

export type DatedProject = {
  date: string;
  kind: ProjectKind;
  name?: string; // Monday project name
  url?: string; // link to the project on Monday
  client?: string; // which client it belongs to (matters for a shared pool)
};

// Dated projects of each kind that fall inside the contract so far
// (start date → today, or → term end once the term is over).
export function kindCountsInContract(
  scope: BrandScope | null | undefined,
  projects: DatedProject[],
  now: Date = new Date()
): Record<ProjectKind, number> | null {
  if (!scope?.start_date) return null;
  const start = day(scope.start_date);
  if (!start) return null;
  const today = new Date(now);
  today.setHours(12, 0, 0, 0);
  const endInclusive = scope.end_date ? day(scope.end_date) : null;
  const endExclusive = endInclusive ? new Date(endInclusive.getTime() + 86400000) : null;
  const windowEnd =
    endExclusive && today >= endExclusive ? endExclusive : new Date(today.getTime() + 86400000 / 2);
  const out: Record<ProjectKind, number> = { shoot: 0, micro: 0, edit: 0, other: 0 };
  for (const p of projects) {
    const d = day(p.date);
    if (d && d >= start && d < windowEnd) out[p.kind] += 1;
  }
  return out;
}

// ── Shoot log: the contract broken into its periods ──────────────────────────
// One row per period since the contract started (through the current one),
// with what was owed and the actual projects that happened in it. This is the
// list behind the "Contract to date" numbers.
export type ContractPeriod = {
  index: number; // 1-based
  label: string; // "April 2026", or a date range when periods aren't calendar months
  short: string; // column caption for the contract calendar: "Apr", or "4/6" for weekly periods
  owed: number;
  inProgress: boolean; // the current, unfinished period
  future: boolean; // hasn't started yet (only present with includeFuture)
  scheduled: DatedProject[]; // shoots on Monday with a date still ahead of today
  shoots: DatedProject[];
  micro: DatedProject[];
  edits: DatedProject[];
};

export function contractPeriods(
  scope: BrandScope | null | undefined,
  projects: DatedProject[],
  now: Date = new Date(),
  // includeFuture: also return the periods still to come, up to the end of the
  // term (needs an end date) — the full contract laid out, for the calendar.
  opts: { includeFuture?: boolean } = {}
): ContractPeriod[] | null {
  if (!scope?.start_date || !scope.shoot_cadence) return null;
  const rate = scope.shoots_per_period ?? 0;
  if (rate <= 0) return null;
  const monthsPer = MONTHS_PER_PERIOD[scope.shoot_cadence];
  const daysPer = DAYS_PER_PERIOD[scope.shoot_cadence];
  if (!monthsPer && !daysPer) return null;
  const start = day(scope.start_date);
  if (!start) return null;

  const today = new Date(now);
  today.setHours(12, 0, 0, 0);
  if (today < start) return [];
  const endInclusive = scope.end_date ? day(scope.end_date) : null;
  const endExclusive = endInclusive ? new Date(endInclusive.getTime() + 86400000) : null;
  const termOver = !!endExclusive && today >= endExclusive;
  // Only things that have already happened count (through the end of today).
  const happenedBefore = termOver ? endExclusive! : new Date(today.getTime() + 86400000 / 2);

  const periodStart = (i: number): Date =>
    monthsPer ? addMonths(start, i * monthsPer) : new Date(start.getTime() + i * daysPer! * 86400000);
  const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) => d.toLocaleDateString("en-US", opts);

  const dated = projects
    .map((p) => ({ p, d: day(p.date) }))
    .filter((x): x is { p: DatedProject; d: Date } => !!x.d)
    .sort((a, b) => a.d.getTime() - b.d.getTime());
  const sorted = dated.filter((x) => x.d < happenedBefore);
  // Booked but not shot yet: a shoot with a date after today.
  const upcoming = dated.filter((x) => x.d >= happenedBefore && x.p.kind === "shoot");

  const out: ContractPeriod[] = [];
  for (let i = 0; i < 600; i++) {
    const ps = periodStart(i);
    const future = ps >= happenedBefore;
    if (future && !(opts.includeFuture && endExclusive)) break;
    let pe = periodStart(i + 1);
    if (endExclusive && pe > endExclusive) pe = endExclusive;
    const inRange = sorted.filter((x) => x.d >= ps && x.d < pe).map((x) => x.p);
    const calendarMonth = monthsPer === 1 && start.getDate() === 1;
    const lastDay = new Date(pe.getTime() - 86400000);
    out.push({
      index: i + 1,
      label: calendarMonth
        ? fmt(ps, { month: "long", year: "numeric" })
        : `${fmt(ps, { month: "short", day: "numeric" })} – ${fmt(lastDay, { month: "short", day: "numeric", year: "numeric" })}`,
      short: monthsPer ? fmt(ps, { month: "short" }) : `${ps.getMonth() + 1}/${ps.getDate()}`,
      owed: rate,
      inProgress: !future && !termOver && pe > today,
      future,
      shoots: inRange.filter((x) => x.kind === "shoot"),
      micro: inRange.filter((x) => x.kind === "micro"),
      edits: inRange.filter((x) => x.kind === "edit"),
      scheduled: upcoming.filter((x) => x.d >= ps && x.d < pe).map((x) => x.p),
    });
    if (endExclusive && pe >= endExclusive) break;
  }
  return out;
}

// ── Contract health: one light, one reason ───────────────────────────────────
// Same language as the shoot weather: green / yellow / red, with the reason in
// plain words. Judged on the contract to date (shoots roll over between
// periods), plus whether the next shoot is actually on the calendar.
//   red    — behind by 2 or more, the term ended short, or renewal has passed
//   yellow — behind by 1, or this period still has an open shoot and nothing
//            is scheduled
//   green  — everything else
export type ContractHealth = { level: "green" | "yellow" | "red"; label: string; reason: string };

export function contractHealth(
  pace: ContractPace,
  opts: { current?: ContractPeriod | null; hasUpcomingShoot: boolean; renewalOverdue?: boolean }
): ContractHealth {
  if (pace.status === "complete") {
    return { level: "green", label: "Contract fulfilled", reason: "Every contracted shoot is done." };
  }
  const booked = opts.hasUpcomingShoot ? "The next shoot is booked." : "Nothing is scheduled.";
  if (opts.renewalOverdue) {
    return { level: "red", label: "At risk", reason: "The renewal date has passed." };
  }
  // Term over (nothing in progress) and still short.
  if (pace.status === "behind" && pace.inProgressQuota === 0) {
    return {
      level: "red",
      label: "At risk",
      reason: `The term ended with ${pace.done}${pace.total != null ? ` of ${pace.total}` : ""} shoots done.`,
    };
  }
  const behind = Math.max(0, -pace.delta);
  if (behind >= 2) return { level: "red", label: "Behind", reason: `Behind by ${behind}. ${booked}` };
  if (behind === 1) return { level: "yellow", label: "Keep an eye on it", reason: `Behind by 1. ${booked}` };
  const cur = opts.current;
  const periodOpen = !!cur && cur.shoots.length + cur.scheduled.length < cur.owed;
  if (!opts.hasUpcomingShoot && periodOpen) {
    return { level: "yellow", label: "Keep an eye on it", reason: "On pace, but nothing is scheduled." };
  }
  const ahead = pace.done - pace.expectedToDate - pace.inProgressQuota;
  return {
    level: "green",
    label: "On track",
    reason: ahead > 0 ? `Ahead by ${ahead}.` : opts.hasUpcomingShoot ? "On pace, and the next shoot is booked." : "On pace.",
  };
}

// ── Make-ups: extra shoots covering short periods ────────────────────────────
// Shoots roll over, so an extra shoot in one period covers a missed one in
// another. Walking the periods in order, each extra shoot goes to the oldest
// uncovered miss; a miss draws on any extras already banked before it. What is
// left over at the end is either still owed (missed) or still banked (extra).
// Only periods that have fully passed can be "short" — the current one is
// still in play.
export type PeriodBalance = {
  madeUp: number; // missed shoots here that an extra shoot elsewhere has covered
  missed: number; // missed shoots here that nothing has covered yet
  extra: number; // shoots here beyond the period's quota
  coveredBy: number[]; // period indexes whose extra shoots covered this one
};

export type ContractBalance = {
  byIndex: Record<number, PeriodBalance>;
  shortTotal: number; // missed shoots across passed periods, before make-ups
  madeUpTotal: number;
  missedTotal: number; // still owed
  banked: number; // extra shoots not needed to cover anything yet
};

export function contractBalance(periods: ContractPeriod[]): ContractBalance {
  const byIndex: Record<number, PeriodBalance> = {};
  const openMisses: { index: number; left: number }[] = [];
  const openExtras: { index: number; left: number }[] = [];
  let shortTotal = 0;
  let madeUpTotal = 0;

  const cover = (missIndex: number, extraIndex: number, n: number) => {
    byIndex[missIndex].madeUp += n;
    byIndex[missIndex].missed -= n;
    if (!byIndex[missIndex].coveredBy.includes(extraIndex)) byIndex[missIndex].coveredBy.push(extraIndex);
    madeUpTotal += n;
  };

  for (const per of periods) {
    if (per.future) continue;
    const done = per.shoots.length;
    const extra = Math.max(0, done - per.owed);
    const short = per.inProgress ? 0 : Math.max(0, per.owed - done);
    byIndex[per.index] = { madeUp: 0, missed: short, extra, coveredBy: [] };
    shortTotal += short;

    // A short period first draws on extras banked earlier.
    let need = short;
    while (need > 0 && openExtras.length) {
      const src = openExtras[0];
      const n = Math.min(need, src.left);
      cover(per.index, src.index, n);
      src.left -= n;
      need -= n;
      if (src.left === 0) openExtras.shift();
    }
    if (need > 0) openMisses.push({ index: per.index, left: need });

    // Extra shoots here go to the oldest uncovered miss.
    let spare = extra;
    while (spare > 0 && openMisses.length) {
      const miss = openMisses[0];
      const n = Math.min(spare, miss.left);
      cover(miss.index, per.index, n);
      miss.left -= n;
      spare -= n;
      if (miss.left === 0) openMisses.shift();
    }
    if (spare > 0) openExtras.push({ index: per.index, left: spare });
  }

  return {
    byIndex,
    shortTotal,
    madeUpTotal,
    missedTotal: openMisses.reduce((n, m) => n + m.left, 0),
    banked: openExtras.reduce((n, e) => n + e.left, 0),
  };
}
