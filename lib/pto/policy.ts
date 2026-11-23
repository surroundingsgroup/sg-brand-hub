// The PTO policy, as Billy gave it on 2026-11-23, and the math that follows
// from it. No data access here: give it a start date and the time off taken,
// and it returns the statement.
//
//   - 14 days a year to start. On every work anniversary the yearly amount
//     goes up by one day (8 hours).
//   - It is earned a little each pay period, 24 pay periods a year (the 15th
//     and the last day of each month).
//   - On each anniversary, anything unused over 40 hours is lost.
//
// Change the numbers in PTO_POLICY and everything recalculates.

export const PTO_POLICY = {
  baseDays: 14,
  addedDaysPerYear: 1,
  hoursPerDay: 8,
  payPeriodsPerYear: 24,
  rolloverCapHours: 40,
};

export type PtoUse = { date: string; hours: number }; // the day the time off starts, YYYY-MM-DD

export type PtoYear = {
  serviceYear: number; // 1 = the first year
  from: string; // the day after the last anniversary (or the start date)
  to: string; // this year's anniversary
  allotmentHours: number;
  perPeriodHours: number;
  carriedIn: number;
  accrued: number;
  used: number;
  lostAtAnniversary: number; // 0 for the year still running
  endBalance: number; // after the anniversary cap, or today's balance for the year still running
  complete: boolean;
};

export type PtoStatement = {
  startDate: string;
  asOf: string;
  serviceYear: number;
  allotmentHours: number; // this year's yearly amount
  perPeriodHours: number; // what is earned each pay period this year
  carriedIn: number;
  accruedThisYear: number;
  usedThisYear: number;
  balance: number; // available today
  scheduledHours: number; // approved time off still ahead
  balanceAfterScheduled: number;
  nextAnniversary: string;
  // What would be lost at the next anniversary if nothing else is taken or booked.
  projectedAtAnniversary: number;
  atRiskHours: number;
  lostToDate: number; // everything lost at past anniversaries
  years: PtoYear[];
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s.slice(0, 10)}T12:00:00Z`);

export function addYears(start: string, n: number): string {
  const d = day(start);
  const month = d.getUTCMonth();
  d.setUTCFullYear(d.getUTCFullYear() + n);
  // Feb 29 start: the anniversary in a normal year is Feb 28.
  if (d.getUTCMonth() !== month) d.setUTCDate(0);
  return iso(d);
}

/** The yearly amount, in hours, for a service year (1 = first). */
export function allotmentHours(serviceYear: number): number {
  return (PTO_POLICY.baseDays + PTO_POLICY.addedDaysPerYear * (serviceYear - 1)) * PTO_POLICY.hoursPerDay;
}

/** Pay dates (the 15th and the last day of each month) after `after`, up to and including `through`. */
export function payDates(after: string, through: string): string[] {
  const out: string[] = [];
  const end = day(through);
  const d = day(after);
  d.setUTCDate(1);
  while (d <= end) {
    const mid = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 15, 12));
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12));
    for (const p of [mid, last]) {
      const s = iso(p);
      if (s > after && s <= through) out.push(s);
    }
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

const round = (n: number) => Math.round(n * 100) / 100;

export function ptoStatement(startDate: string, uses: PtoUse[], asOf: string): PtoStatement {
  const start = startDate.slice(0, 10);
  const today = asOf.slice(0, 10);
  const years: PtoYear[] = [];
  let balance = 0;
  let lostToDate = 0;

  for (let n = 1; n < 80; n++) {
    const from = n === 1 ? start : addYears(start, n - 1);
    const to = addYears(start, n); // this year's anniversary
    if (from > today) break;
    const complete = to <= today;
    const through = complete ? to : today;
    const allot = allotmentHours(n);
    const perPeriod = allot / PTO_POLICY.payPeriodsPerYear;
    const carriedIn = balance;
    // A pay date on the anniversary itself belongs to the year that is ending.
    const accrued = payDates(from, through).length * perPeriod;
    // Time off counts in the year it starts in: from the anniversary on, it is the new year's.
    const used = uses
      .filter((u) => u.hours > 0 && u.date.slice(0, 10) <= today && u.date.slice(0, 10) >= from && u.date.slice(0, 10) < to)
      .reduce((s, u) => s + u.hours, 0);
    balance = carriedIn + accrued - used;
    let lost = 0;
    if (complete && balance > PTO_POLICY.rolloverCapHours) {
      lost = balance - PTO_POLICY.rolloverCapHours;
      balance = PTO_POLICY.rolloverCapHours;
      lostToDate += lost;
    }
    years.push({
      serviceYear: n,
      from,
      to,
      allotmentHours: allot,
      perPeriodHours: round(perPeriod),
      carriedIn: round(carriedIn),
      accrued: round(accrued),
      used: round(used),
      lostAtAnniversary: round(lost),
      endBalance: round(balance),
      complete,
    });
    if (!complete) break;
  }

  const current = years[years.length - 1];
  const scheduledHours = uses.filter((u) => u.hours > 0 && u.date.slice(0, 10) > today).reduce((s, u) => s + u.hours, 0);
  const scheduledBeforeAnniversary = uses
    .filter((u) => u.hours > 0 && u.date.slice(0, 10) > today && u.date.slice(0, 10) < current.to)
    .reduce((s, u) => s + u.hours, 0);
  const stillToAccrue = payDates(today, current.to).length * (current.allotmentHours / PTO_POLICY.payPeriodsPerYear);
  const projected = balance + stillToAccrue - scheduledBeforeAnniversary;

  return {
    startDate: start,
    asOf: today,
    serviceYear: current.serviceYear,
    allotmentHours: current.allotmentHours,
    perPeriodHours: current.perPeriodHours,
    carriedIn: current.carriedIn,
    accruedThisYear: current.accrued,
    usedThisYear: current.used,
    balance: round(balance),
    scheduledHours: round(scheduledHours),
    balanceAfterScheduled: round(balance - scheduledHours),
    nextAnniversary: current.to,
    projectedAtAnniversary: round(projected),
    atRiskHours: round(Math.max(0, projected - PTO_POLICY.rolloverCapHours)),
    lostToDate: round(lostToDate),
    years,
  };
}
