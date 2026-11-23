// The individual "<Name> PTO" boards on Monday: one board per person, kept as
// a ledger. Each row is hours in (Accrual), hours out (Usage) or a Roll Over
// Adj. Most were opened in October 2025 with an "Initial Load In" row, which
// is the known balance on that day.
//
// RETIRED 2026-11-23 (Billy: "you decide which board we should work off").
// Their rows were copied into ledger-snapshot.json that day and are read from
// there, so the boards can be archived without changing anyone's number. From
// then on the balance moves only by the policy (accrual by start date, 40-hour
// cap on the anniversary) and the approved requests on the Time Off Request
// board. Monday's copy of every balance is the PTO Balances board
// (./monday-board.ts), written daily.
//
// The check, per person:
//   - opening balance (the "Initial Load In" row, or 0 for a 2026 hire)
//   - what the policy gives each pay period (the 15th and the 28th)
//   - every approved request, matched to the board's Usage rows up to the snapshot
//   - the 40-hour cap at each work anniversary
// Nothing here writes to Monday.

import { addYears, allotmentHours, PTO_POLICY } from "./policy";
import { countsAsUsed, isFormerTeam, isNotTracked, normName, sameRequester, type PtoEntry } from "./team";
import SNAPSHOT from "./ledger-snapshot.json";

/** The retired boards (ids kept for the record; Sam's start date sits here too). */
export const PTO_LEDGER_BOARDS: { board: string; person: string; start?: string }[] = [
  { board: "18117844636", person: "Morgan Finger" },
  { board: "18117846712", person: "Austin Tompkins" },
  { board: "18117848444", person: "Sean O'Donnell" },
  { board: "18117851700", person: "Granger Smith" },
  { board: "18117859216", person: "Phallon Ray" },
  // Noah Rahman's board (18117861722) was archived 2026-11-23: no longer on the team full time.
  { board: "18396659889", person: "Tiffany Lewis" },
  { board: "18396660030", person: "Samuel Ray", start: "2026-01-05" },
  { board: "18401392159", person: "Kyle Daniels" },
  { board: "18411527478", person: "Kamila Bacha" },
  { board: "18412654732", person: "Nick Nunez" },
  { board: "18417418293", person: "Joaley Da Silva" },
];

export type LedgerRow = {
  id: string;
  name: string;
  group: string;
  date: string | null; // the board's "Date of Request"
  created: string; // the day the row was added
  accrual: number;
  usage: number;
  adjust: number;
};

/** `retired`: read from the frozen copy, so there is no live board to compare with. */
export type Ledger = { board: string; person: string; url: string; rows: LedgerRow[]; retired?: boolean };

/** The day the boards were copied. */
export const LEDGERS_FROZEN_ON: string = (SNAPSHOT as { takenOn: string }).takenOn;

export async function fetchLedgers(): Promise<{ ok: boolean; ledgers: Ledger[] }> {
  const ledgers = (SNAPSHOT as { ledgers: Ledger[] }).ledgers.map((l) => ({ ...l, retired: true }));
  return { ok: true, ledgers };
}

// ---------------------------------------------------------------- the check

export type LedgerAudit = {
  board: string;
  hasBoard: boolean; // false: worked out without a Monday PTO board (see auditWithoutBoard)
  url: string;
  person: string;
  email: string | null; // from the team profile; null when the person has no profile
  startDate: string | null;
  boardBalance: number; // what the board adds up to
  openingDate: string;
  openingHours: number; // the "Initial Load In", or 0 for a board started with a new hire
  boardRate: number; // hours the board adds each pay period now
  policyRate: number | null; // what the start date says it should be; null with no start date
  checked: number; // opening + policy accruals - approved time off, cap applied
  difference: number; // checked - boardBalance
  booked: number; // approved time off still ahead; already out of both numbers
  lostToCap: number;
  // Since the last cap day (or since the board opened): carried in, earned, used, and approved time still ahead. checked = carried + earned - used - booked.
  since: { date: string; carried: number; earned: number; used: number; booked: number; capped: boolean; isOpening: boolean };
  nextAnniversary: string | null;
  atRiskHours: number; // what the cap would take at the next anniversary as things stand
  // Why the two numbers differ. The hours add up to `difference`.
  reasons: { text: string; hours: number }[];
  // Things a person has to look at; they do not move the checked number.
  toCheck: string[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const hrs = (n: number) => `${Math.abs(r2(n)) % 1 === 0 ? Math.abs(r2(n)).toFixed(0) : Math.abs(r2(n)).toFixed(2)} ${Math.abs(r2(n)) === 1 ? "hour" : "hours"}`;
const longDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000);
const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

// The boards credit time on the 15th and the 28th. A slot is one of those two
// credits in a month: "2026-05-A" (the 15th) or "2026-05-B" (the 28th).
const slotOf = (iso: string) => `${iso.slice(0, 7)}-${Number(iso.slice(8, 10)) <= 21 ? "A" : "B"}`;
const slotDue = (slot: string) => `${slot.slice(0, 7)}-${slot.endsWith("A") ? "15" : "28"}`;
function nextSlot(slot: string): string {
  if (slot.endsWith("A")) return `${slot.slice(0, 7)}-B`;
  const y = Number(slot.slice(0, 4));
  const m = Number(slot.slice(5, 7));
  return `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-A`;
}

/** The service year a date falls in (1 = the first). A date on the anniversary belongs to the year that is ending. */
function serviceYearAt(start: string, date: string): number {
  for (let n = 1; n < 80; n++) if (date <= addYears(start, n)) return n;
  return 80;
}
const ratePerPeriod = (serviceYear: number) => allotmentHours(serviceYear) / PTO_POLICY.payPeriodsPerYear;

// The cap starts from here (Billy, 2026-11-23: "we just start from here"). Anniversaries before this date are
// not applied, so nobody loses hours their Monday board was showing them; from each person's next anniversary on,
// anything over 40 hours is lost.
export const CAP_FROM = "2026-11-23";

/** When the 40-hour cap is applied. The handbook says the anniversary; the balances were kept on January 1 through 2025. */
export type CapRule = "anniversary" | "jan1";

export function auditLedger(
  ledger: Ledger,
  startDate: string | null,
  entries: PtoEntry[],
  asOf: string,
  capRule: CapRule = "anniversary",
  opts: { opening?: { date: string; hours: number } } = {}
): LedgerAudit {
  const hasBoard = !!ledger.board && !ledger.retired;
  const today = asOf.slice(0, 10);
  const start = startDate?.slice(0, 10) || null;
  const reasons: { text: string; hours: number }[] = [];
  const toCheck: string[] = [];

  const pending = ledger.rows.filter((r) => /need approval/i.test(r.group));
  const rows = ledger.rows.filter((r) => !/need approval/i.test(r.group));
  if (pending.length) toCheck.push(`${pending.length} ${pending.length === 1 ? "row is" : "rows are"} waiting in the board's "needs approval" group and ${pending.length === 1 ? "is" : "are"} not counted.`);

  const boardBalance = rows.reduce((n, r) => n + r.accrual - r.usage + r.adjust, 0);

  // A date typed a year ahead (a December 2025 row dated December 2026) is read as the year it was meant for.
  const eff = (r: LedgerRow): string => {
    if (!r.date) return r.created;
    if (r.created && dayDiff(r.date, r.created) > 45) {
      const back = addYears(r.date, -1);
      if (dayDiff(back, r.created) <= 45) return back;
    }
    return r.date;
  };

  // Opening balance
  const load = rows.find((r) => r.accrual > 0 && /initial|load in/i.test(r.name)) ?? null;
  const auto = rows.filter((r) => r.accrual > 0 && r !== load && /accrual/i.test(r.name));
  const manual = rows.filter((r) => r !== load && !auto.includes(r) && (r.accrual > 0 || r.adjust !== 0) && r.usage === 0);
  // With no board, the opening is given: a known balance on a date, or zero on the start date.
  const firstSlot = opts.opening ? slotOf(opts.opening.date) : auto.map((r) => slotOf(eff(r))).sort()[0] ?? slotOf(today);
  const openingDate = opts.opening ? opts.opening.date : load ? load.created || shift(slotDue(firstSlot), -1) : shift(slotDue(firstSlot), -1);
  const openingHours = opts.opening ? opts.opening.hours : load ? load.accrual : 0;

  // Accruals: one per slot. Anything more in a slot, or anything in a slot that is not due yet, is extra.
  const bySlot = new Map<string, LedgerRow[]>();
  for (const r of auto) {
    const s = slotOf(eff(r));
    bySlot.set(s, [...(bySlot.get(s) ?? []), r]);
  }
  const dueSlots: string[] = [];
  for (let s = firstSlot, guard = 0; slotDue(s) <= today && guard < 400; s = nextSlot(s), guard++) if (slotDue(s) > openingDate) dueSlots.push(s);
  const kept: LedgerRow[] = [];
  const extra: LedgerRow[] = [];
  for (const [slot, list] of bySlot) {
    if (!dueSlots.includes(slot)) {
      extra.push(...list);
      continue;
    }
    const keep = list.find((r) => r.date) ?? list[0];
    kept.push(keep);
    extra.push(...list.filter((r) => r !== keep));
  }
  const missingSlots = dueSlots.filter((s) => !bySlot.has(s));
  const lastKept = [...kept].sort((a, b) => eff(a).localeCompare(eff(b))).pop();
  const boardRate = lastKept?.accrual ?? 0;
  const serviceYearNow = start ? serviceYearAt(start, today) : null;
  const policyRate = serviceYearNow ? r2(ratePerPeriod(serviceYearNow)) : null;

  const extraHours = extra.reduce((n, r) => n + r.accrual, 0);
  if (extra.length) {
    const amounts = [...new Set(extra.map((r) => r.accrual))].join(" and ");
    reasons.push({ text: `${extra.length} extra accrual ${extra.length === 1 ? "row" : "rows"} of ${amounts}: more than one automation on the board is adding time each pay period.`, hours: -extraHours });
  }

  // What the policy gives for each due pay period (the board's own amount when there is no start date to check against)
  const policyFor = (slot: string) => (start ? ratePerPeriod(serviceYearAt(start, slotDue(slot))) : boardRate);
  const keptBySlot = new Map(kept.map((r) => [slotOf(eff(r)), r] as const));
  let rateDiff = 0;
  let missedHours = 0;
  for (const s of dueSlots) {
    const k = keptBySlot.get(s);
    if (k) rateDiff += policyFor(s) - k.accrual;
    else missedHours += policyFor(s);
  }
  if (missingSlots.length) reasons.push({ text: `No accrual row for ${missingSlots.length} pay ${missingSlots.length === 1 ? "period" : "periods"} (${missingSlots.slice(0, 3).map((s) => longDate(slotDue(s))).join(", ")}${missingSlots.length > 3 ? ", ..." : ""}).`, hours: missedHours });
  if (Math.abs(rateDiff) >= 0.5) {
    const days = serviceYearNow ? allotmentHours(serviceYearNow) / PTO_POLICY.hoursPerDay : 0;
    reasons.push({
      text:
        boardRate === policyRate
          ? `The board has added ${boardRate} every pay period since it was opened. By the ${longDate(start!)} start date the amount was lower before the last anniversary.`
          : `The board adds ${boardRate} a pay period. A ${longDate(start!)} start date makes it ${policyRate} now (year ${serviceYearNow}, ${days} days a year).`,
      hours: rateDiff,
    });
  } else rateDiff = 0;

  // Usage: board rows against approved requests filed for time off since the board was opened.
  // Time off comes off the balance once it is approved, not on the day it is taken (Billy, 2026-11-23), so
  // booking ahead protects those hours from the anniversary cap. `counted` is the day it came off: the day it
  // was approved (when the board row was added) or the day it was taken, whichever is earlier. `date` is the
  // day it is taken.
  type Use = { date: string; counted: string; hours: number };
  const earlier = (a: string | null | undefined, b: string) => (a && a < b ? a : b);
  const uses: Use[] = [];
  const usageRows = rows.filter((r) => r.usage > 0);
  const mine = entries.filter((e) => sameRequester(e.person, ledger.person) && countsAsUsed(e) && e.from >= openingDate).sort((a, b) => a.created.localeCompare(b.created));
  const free = new Set(usageRows);
  const unmatched: PtoEntry[] = [];
  for (const e of mine) {
    const cands = [...free].filter((u) => Math.abs(u.usage - e.hours) < 0.01);
    if (!cands.length) {
      unmatched.push(e);
      continue;
    }
    const u = cands.sort((a, b) => Math.abs(dayDiff(a.created, e.created || a.created)) - Math.abs(dayDiff(b.created, e.created || b.created)))[0];
    free.delete(u);
    uses.push({ date: e.from, counted: earlier(u.created, e.from), hours: u.usage });
  }
  for (const e of unmatched) {
    const when = e.from === e.to ? longDate(e.from) : `${longDate(e.from)} to ${longDate(e.to)}`;
    const size = `${hrs(e.hours)}${e.estimated ? ", worked out from the dates" : ""}`;
    // The same request logged with different hours: a board row added within a few days of the request.
    const near = [...free].find((u) => e.created && Math.abs(dayDiff(u.created, e.created)) <= 4);
    if (near) {
      free.delete(near);
      uses.push({ date: e.from, counted: earlier(near.created, e.from), hours: e.hours });
      reasons.push({ text: `Time off ${when} is on the board as ${hrs(near.usage)}; the approved request says ${hrs(e.hours)}.`, hours: -(e.hours - near.usage) });
    } else if (e.created && e.created < openingDate) {
      toCheck.push(`Approved time off ${when} (${size}) was filed before the board was opened and is not on it. It may already be inside the opening balance.`);
    } else {
      uses.push({ date: e.from, counted: earlier(e.created, e.from), hours: e.hours });
      reasons.push({ text: `Approved time off ${when} (${size}) is not on the board.`, hours: -e.hours });
    }
  }
  // A board row left behind after the request was cancelled (set to Rejected after it was approved) does not count.
  const cancelled = entries.filter((e) => sameRequester(e.person, ledger.person) && /reject|denied|declined/i.test(e.status) && e.from >= openingDate);
  for (const u of [...free]) {
    const c = cancelled.find((e) => Math.abs(u.usage - e.hours) < 0.01 && (!u.date || !e.created || Math.abs(dayDiff(u.date, e.created)) <= 3));
    if (!c) continue;
    free.delete(u);
    cancelled.splice(cancelled.indexOf(c), 1);
    toCheck.push(`The board still takes off ${hrs(u.usage)} for time off that was later rejected (${longDate(c.from)}). Not counted; delete that row on the board.`);
  }
  for (const u of free) uses.push({ date: u.date ?? u.created, counted: earlier(u.created, u.date ?? u.created), hours: u.usage });
  if (free.size) toCheck.push(`${free.size} usage ${free.size === 1 ? "row" : "rows"} on the board (${hrs([...free].reduce((n, u) => n + u.usage, 0))}) could not be tied to an approved request. Counted as used.`);

  // Run it forward from the opening balance, capping at each anniversary
  type Ev = { date: string; hours: number; order: number; taken?: string };
  const evs: Ev[] = [
    ...dueSlots.map((s) => ({ date: slotDue(s), hours: policyFor(s), order: 0 })),
    ...manual.map((r) => ({ date: eff(r) > openingDate ? eff(r) : shift(openingDate, 1), hours: r.accrual + r.adjust, order: 0 })),
    ...uses.map((u) => ({ date: u.counted > openingDate ? u.counted : shift(openingDate, 1), hours: -u.hours, order: 2, taken: u.date })),
  ];
  // The days the cap is applied: each work anniversary (the handbook), or each January 1 (how the balances were kept through 2025).
  const capDates: string[] = [];
  if (capRule === "jan1") {
    for (let y = Number(openingDate.slice(0, 4)) + 1; `${y}-01-01` <= today; y++) capDates.push(`${y}-01-01`);
  } else if (start) {
    for (let n = 1; n < 80; n++) {
      const a = addYears(start, n);
      if (a > today) break;
      if (a > openingDate && a >= CAP_FROM) capDates.push(a);
    }
  }
  // On a cap day: that day's accrual counts first, then the cap, then time off starting that day.
  const marks: Ev[] = capDates.map((a) => ({ date: a, hours: 0, order: 1 }));
  const line = [...evs, ...marks].sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
  let bal = openingHours;
  let lostToCap = 0;
  let balToday = openingHours;
  // The statement a person reads: what they carried in at the last cap day (or the opening), earned since, used since, booked ahead.
  const since = { date: openingDate, carried: openingHours, earned: 0, used: 0, booked: 0, capped: false };
  for (const e of line) {
    if (e.order !== 1) {
      if (e.hours >= 0) {
        if (e.date <= today) since.earned += e.hours;
      } else if ((e.taken ?? e.date) <= today) since.used += -e.hours;
      else since.booked += -e.hours;
    }
    if (e.order === 1) {
      if (bal > PTO_POLICY.rolloverCapHours) {
        const lost = bal - PTO_POLICY.rolloverCapHours;
        const when = capRule === "jan1" ? `On ${longDate(e.date)}` : `On the ${longDate(e.date)} anniversary`;
        reasons.push({ text: `${when} the balance was ${hrs(bal)}. The ${PTO_POLICY.rolloverCapHours}-hour cap takes off ${hrs(lost)}; the board never applied it.`, hours: -lost });
        lostToCap += lost;
        bal = PTO_POLICY.rolloverCapHours;
        since.capped = true;
      } else since.capped = false;
      since.date = e.date;
      since.carried = bal;
      since.earned = 0;
      since.used = 0;
      since.booked = 0;
      continue;
    }
    bal += e.hours;
    if (e.date <= today) balToday = bal;
  }
  const checked = bal;
  const booked = uses.filter((u) => u.date > today).reduce((n, u) => n + u.hours, 0);

  // What the cap would take on the next cap day if nothing else changes
  const nextAnniversary: string | null = capRule === "jan1" ? `${Number(today.slice(0, 4)) + 1}-01-01` : start ? addYears(start, serviceYearAt(start, shift(today, 1))) : null;
  let atRisk = 0;
  if (!start) toCheck.push(capRule === "jan1" ? "No start date on file, so the amount per pay period could not be checked." : "No start date on file, so the amount per pay period could not be checked and no anniversary cap was applied.");
  if (nextAnniversary) {
    let ahead = 0;
    for (let s = nextSlot(dueSlots[dueSlots.length - 1] ?? slotOf(today)), guard = 0; slotDue(s) <= nextAnniversary && guard < 60; s = nextSlot(s), guard++) if (slotDue(s) > today) ahead += policyFor(s);
    const bookedBefore = uses.filter((u) => u.counted > today && u.counted < nextAnniversary!).reduce((n, u) => n + u.hours, 0);
    atRisk = Math.max(0, balToday + ahead - bookedBefore - PTO_POLICY.rolloverCapHours);
  }

  return {
    board: ledger.board,
    hasBoard,
    url: ledger.url,
    person: ledger.person,
    email: null,
    startDate: start,
    boardBalance: r2(boardBalance),
    openingDate,
    openingHours: r2(openingHours),
    boardRate,
    policyRate,
    checked: r2(checked),
    difference: r2(checked - boardBalance),
    booked: r2(booked),
    lostToCap: r2(lostToCap),
    since: { date: since.date, carried: r2(since.carried), earned: r2(since.earned), used: r2(since.used), booked: r2(since.booked), capped: since.capped, isOpening: since.date === openingDate },
    nextAnniversary,
    atRiskHours: r2(atRisk),
    // Without a board there is nothing to differ from.
    reasons: hasBoard ? reasons.map((x) => ({ text: x.text, hours: r2(x.hours) })) : [],
    toCheck,
  };
}

/** Every board, checked. Start dates come from the team profiles, matched on the person's name. */
export function auditLedgers(
  ledgers: Ledger[],
  profiles: { name: string | null; email?: string | null; start_date: string | null }[],
  entries: PtoEntry[],
  asOf: string,
  capRule: CapRule = "anniversary"
): LedgerAudit[] {
  return ledgers
    .map((l) => {
      const p = profiles.find((x) => normName(x.name ?? "") === normName(l.person));
      const fallback = PTO_LEDGER_BOARDS.find((x) => x.board === l.board)?.start ?? null;
      return { ...auditLedger(l, p?.start_date ?? fallback, entries, asOf, capRule), email: p?.email?.toLowerCase() ?? null };
    })
    .sort((a, b) => a.person.localeCompare(b.person));
}

// ---------------------------------------------------------------- no board

/**
 * People with no PTO board on Monday. Their balance is worked out from a
 * known opening balance (add a line here: the balance on a date, before any
 * time off taken after that date), or, for anyone who started after the
 * boards were set up, from zero on their start date: every request they have
 * made since is on the Time Off Request boards, so nothing is missing.
 */
export const PTO_OPENING_BALANCES: Record<string, { date: string; hours: number }> = {
  // "Full Name": { date: "2026-11-23", hours: 0 },
};
const NEW_HIRES_FROM = "2025-10-01";

export function auditWithoutBoard(
  person: { name: string | null; email?: string | null; start_date: string | null },
  entries: PtoEntry[],
  asOf: string,
  capRule: CapRule = "anniversary"
): LedgerAudit | null {
  const name = (person.name ?? "").trim();
  if (!name) return null;
  const start = person.start_date?.slice(0, 10) || null;
  const known = Object.entries(PTO_OPENING_BALANCES).find(([n]) => normName(n) === normName(name))?.[1];
  const opening = known ?? (start && start >= NEW_HIRES_FROM ? { date: start, hours: 0 } : null);
  if (!opening) return null;
  const audit = auditLedger({ board: "", person: name, url: "", rows: [] }, start, entries, asOf, capRule, { opening });
  return { ...audit, email: person.email?.toLowerCase() ?? null };
}

/** Everyone who has a balance: the PTO boards, plus people with no board whose opening is known. */
export function auditEveryone(
  ledgers: Ledger[],
  profiles: { name: string | null; email?: string | null; start_date: string | null }[],
  entries: PtoEntry[],
  asOf: string,
  capRule: CapRule = "anniversary"
): LedgerAudit[] {
  const withBoard = auditLedgers(ledgers, profiles, entries, asOf, capRule);
  const covered = new Set(withBoard.map((a) => normName(a.person)));
  const without = profiles
    .filter((p) => p.name && !covered.has(normName(p.name)) && !isFormerTeam(p.name) && !isNotTracked(p.name))
    .map((p) => auditWithoutBoard(p, entries, asOf, capRule))
    .filter((a): a is LedgerAudit => !!a);
  return [...withBoard, ...without].sort((a, b) => a.person.localeCompare(b.person));
}
