// Company paid holidays (Employee Handbook 6.3). Time off never needs to
// cover these: they are paid anyway. Used by the request form (hours fill in
// from working days) and by the server check on the hours asked for.
//
// New Year's Eve, New Year's Day, Memorial Day, Juneteenth, Independence Day,
// Labor Day, Thanksgiving Day, the day after Thanksgiving, Christmas Eve and
// Christmas Day. The handbook names no rule for a holiday on a weekend, so a
// weekend holiday simply falls on a day that is not worked anyway.

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** The nth weekday (0 = Sunday) of a month; n = -1 for the last one. */
function nthWeekday(y: number, m: number, weekday: number, n: number): string {
  if (n > 0) {
    const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    return iso(y, m, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7);
  }
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = new Date(Date.UTC(y, m - 1, lastDay)).getUTCDay();
  return iso(y, m, lastDay - ((last - weekday + 7) % 7));
}

const cache = new Map<number, Map<string, string>>();

/** Every company holiday in a year, date to name. */
export function holidaysIn(year: number): Map<string, string> {
  const hit = cache.get(year);
  if (hit) return hit;
  const thanksgiving = nthWeekday(year, 11, 4, 4);
  const dayAfter = new Date(Date.parse(`${thanksgiving}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const map = new Map<string, string>([
    [iso(year, 1, 1), "New Year's Day"],
    [nthWeekday(year, 5, 1, -1), "Memorial Day"],
    [iso(year, 6, 19), "Juneteenth"],
    [iso(year, 7, 4), "Independence Day"],
    [nthWeekday(year, 9, 1, 1), "Labor Day"],
    [thanksgiving, "Thanksgiving"],
    [dayAfter, "the day after Thanksgiving"],
    [iso(year, 12, 24), "Christmas Eve"],
    [iso(year, 12, 25), "Christmas Day"],
    [iso(year, 12, 31), "New Year's Eve"],
  ]);
  cache.set(year, map);
  return map;
}

export const holidayOn = (day: string): string | null => holidaysIn(Number(day.slice(0, 4))).get(day) ?? null;

/** Working days from start to end, both included: weekdays that are not company holidays. Also lists the holidays skipped. */
export function workingDays(start: string, end: string): { days: number; holidays: { date: string; name: string }[] } {
  let days = 0;
  const holidays: { date: string; name: string }[] = [];
  if (!start) return { days, holidays };
  const last = new Date(`${end || start}T12:00:00Z`);
  for (const d = new Date(`${start}T12:00:00Z`); d <= last; d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const day = d.toISOString().slice(0, 10);
    const name = holidayOn(day);
    if (name) holidays.push({ date: day, name });
    else days++;
  }
  return { days, holidays };
}
