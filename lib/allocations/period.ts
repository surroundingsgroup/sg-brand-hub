// Shared period-and-due-date math for monthly allocations.
//
// Rule: an allocation for month M is DUE on day 28 of the previous
// month. So November allocation is due October 28. Hard-coded for now;
// make it configurable per-brand if the team ever wants exceptions.
//
// "Active period" = which month we show in the tile headline. We show
// the current month by default. Once the current month is submitted
// AND we're inside the final 7 days of the current month, we flip the
// headline to NEXT month so AMs don't see a stale "all done" state
// while there's unsubmitted work incoming.

export type Period = { year: number; month: number };

export function currentPeriod(now = new Date()): Period {
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

export function nextPeriod(p: Period): Period {
  if (p.month === 12) return { year: p.year + 1, month: 1 };
  return { year: p.year, month: p.month + 1 };
}

export function prevPeriod(p: Period): Period {
  if (p.month === 1) return { year: p.year - 1, month: 12 };
  return { year: p.year, month: p.month - 1 };
}

export function periodLabel(p: Period): string {
  const d = new Date(p.year, p.month - 1, 1);
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function periodShort(p: Period): string {
  const d = new Date(p.year, p.month - 1, 1);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

/** YYYY-MM-DD for the due date of a given period's allocation. */
export function dueDate(p: Period): Date {
  const prev = prevPeriod(p);
  return new Date(prev.year, prev.month - 1, 28);
}

export function daysUntilDue(p: Period, now = new Date()): number {
  const due = dueDate(p);
  // Date-only day math, not time-of-day: round from midnight to midnight.
  const dueMid = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  const nowMid = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((dueMid - nowMid) / 86400000);
}

export function dueDateLabel(p: Period): string {
  const d = dueDate(p);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
