"use client";
// Scope & Contract Health tile.
//
// Collapsed (default): compact readout — services, cadence, next renewal,
// retainer, delivered-vs-owed meters inferred from the client profile's
// Monday + SocialDesk tiles.
//
// Expanded (edit): a sectioned form that writes to brands.scope via the
// server action. Form state lives locally; save button is disabled until
// something changes to make accidental PATCHes obvious.
//
// Contracts themselves live on the Monday "All Accounts" board (access-
// controlled), NOT here — this tile captures the working scope the whole
// team needs, not the signed agreement.
//
// The tile takes the already-fetched Monday + SocialDesk data from the
// parent so there's one network round-trip per profile load, not three.

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { BarChart3, ChevronDown, FileText, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { Tile, TileEmpty } from "./tile";
import { dismissScopeDraft, saveBrandScope } from "@/app/(internal)/client/[id]/scope-actions";
import {
  BILLING_LABELS,
  BILLING_FREQUENCIES,
  CADENCE_LABELS,
  CONTRACT_TERMS,
  SERVICE_LABELS,
  SERVICE_TYPES,
  SHOOT_CADENCES,
  SMM_CHANNELS,
  TERM_LABELS,
  computeTermDates,
  type BillingFrequency,
  type BrandScope,
  type ContractTerm,
  type DeliverableLine,
  type ScopeChannel,
  type ScopeDraft,
  type ServiceType,
  type ShootCadence,
} from "@/lib/scope/types";
import { type ContractBalance, type ContractPeriod, type DatedProject } from "@/lib/scope/pace";
import { daysUntil, easternToday, effectiveScope, noonOn, summarizeContract } from "@/lib/scope/summary";
import type { SocialMonth } from "@/lib/socialdesk/fetch";


function Meter({ label, done, quota }: { label: string; done: number; quota: number }) {
  const pct = quota > 0 ? Math.min(100, Math.round((done / quota) * 100)) : 0;
  const barColor =
    done >= quota ? "bg-emerald-500" : done / quota >= 0.66 ? "bg-accent" : "bg-amber-400";
  return (
    <div className="flex items-center gap-3 text-[11px]">
      <div className="w-24 flex-shrink-0 text-muted-foreground">{label}</div>
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="w-14 flex-shrink-0 text-right tabular-nums text-muted-foreground">
        {done}/{quota}
      </div>
    </div>
  );
}

// How many periods of each cadence make a year, for the yearly tally.
const PERIODS_PER_YEAR: Partial<Record<ShootCadence, number>> = {
  weekly: 52,
  "bi-weekly": 26,
  monthly: 12,
  "bi-monthly": 6,
  quarterly: 4,
};

// ── Social posts over the contract ────────────────────────────────────────────
// The SocialDesk tile already shows this month and next. This is the long
// view: across the full calendar months of the term that have passed, how
// many posts were approved on each contracted channel, against the monthly
// minimum times those months. Months before SocialDesk has anything for the
// client are left out (no record), the same way the shoot count treats the
// Monday board.
type SocialToDate = {
  months: number;
  fromLabel: string;
  throughLabel: string;
  rows: { channel: string; inFeed: { done: number; owed: number } | null; stories: { done: number; owed: number } | null }[];
};

function socialToDate(scope: BrandScope, history: SocialMonth[], todayIso: string): SocialToDate | null {
  const channels = (scope.channels ?? []).filter((c) => c.inFeed != null || c.stories != null);
  if (!channels.length || !scope.start_date) return null;
  const ym = (iso: string) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;
  // First full calendar month of the term, last one that has fully passed.
  const first = ym(scope.start_date) + (Number(scope.start_date.slice(8, 10)) > 1 ? 1 : 0);
  let last = ym(todayIso) - 1;
  if (scope.end_date) {
    const end = new Date(scope.end_date.slice(0, 10) + "T12:00:00");
    const endsOnLastDay = new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate() === end.getDate();
    last = Math.min(last, ym(scope.end_date) - (endsOnLastDay ? 0 : 1));
  }
  // SocialDesk's own first month for this client.
  const withPosts = history.filter((m) => m.built > 0).map((m) => m.year * 12 + m.month - 1);
  const from = withPosts.length ? Math.max(first, Math.min(...withPosts)) : first;
  const label = (k: number) => new Date(Math.floor(k / 12), k % 12, 15).toLocaleDateString("en-US", { month: "short", year: "numeric" });
  const months = Math.max(0, last - from + 1);
  const inRange = history.filter((m) => {
    const k = m.year * 12 + m.month - 1;
    return k >= from && k <= last;
  });
  const sum = (channel: string, key: "inFeed" | "stories") => inRange.reduce((n, m) => n + (m.by_channel[channel]?.[key] ?? 0), 0);
  return {
    months,
    fromLabel: label(from),
    throughLabel: label(Math.max(from, last)),
    rows: channels.map((c) => ({
      channel: c.name,
      inFeed: c.inFeed != null ? { done: sum(c.name, "inFeed"), owed: c.inFeed * months } : null,
      stories: c.stories != null ? { done: sum(c.name, "stories"), owed: c.stories * months } : null,
    })),
  };
}

// ── Shoot log helpers ─────────────────────────────────────────────────────────
function shortDate(iso: string): string {
  const d = new Date(iso.length <= 10 ? iso + "T12:00:00" : iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// "Apr 29, 2026": an agreement's upload date, where the year matters.
function fullDate(iso: string): string {
  const d = new Date(iso.length <= 10 ? iso + "T12:00:00" : iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// Monday project names lead with the client ("Solana | IDS Event"); drop that
// first segment since the log is already on the client's page. The lead is
// often the short form of the client's name ("Solana" for "Solana Outdoor
// Living"), so a leading segment the full name starts with counts too.
function projectLabel(p: DatedProject): string {
  const parts = (p.name ?? "").split("|").map((s) => s.trim()).filter(Boolean);
  const lead = (parts[0] ?? "").toLowerCase();
  const client = (p.client ?? "").trim().toLowerCase();
  if (parts.length > 1 && client && lead.length >= 3 && (lead === client || client.startsWith(lead + " "))) {
    parts.shift();
  }
  return parts.join(" · ") || "(untitled project)";
}

function LogLine({ p, tag, showClient }: { p: DatedProject; tag?: string; showClient: boolean }) {
  return (
    <div className="flex items-baseline gap-2 text-[11px] text-muted-foreground">
      <span className="w-12 flex-shrink-0 tabular-nums">{shortDate(p.date)}</span>
      <span className="min-w-0 flex-1">
        {tag ? (
          <span className="mr-1.5 rounded bg-secondary px-1 py-px text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
            {tag}
          </span>
        ) : null}
        {p.url ? (
          <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-foreground underline-offset-2 hover:underline">
            {projectLabel(p)}
          </a>
        ) : (
          <span className="text-foreground">{projectLabel(p)}</span>
        )}
        {showClient && p.client ? <span> · {p.client}</span> : null}
      </span>
    </div>
  );
}

// ── Contract calendar ─────────────────────────────────────────────────────────
// The whole term laid out one column per period (a month, usually). Each
// square is one shoot: green = done, dark green = an extra shoot beyond that
// period's quota, blue = booked on Monday for a date still ahead, grey
// outline = still to come. A shoot missed in a past period is a green outline
// once an extra shoot elsewhere has made it up, and a red outline only while
// it is still owed.
const CALENDAR_MAX_COLUMNS = 12;
const CALENDAR_MAX_SLOTS = 6;

function ContractCalendar({ periods, balance }: { periods: ContractPeriod[]; balance: ContractBalance }) {
  // Long terms (weekly cadence, open-ended contracts): a 12-column window
  // around the current period.
  let shown = periods;
  if (periods.length > CALENDAR_MAX_COLUMNS) {
    const current = Math.max(0, periods.findIndex((p) => p.inProgress));
    const from = Math.min(Math.max(0, current - 8), periods.length - CALENDAR_MAX_COLUMNS);
    shown = periods.slice(from, from + CALENDAR_MAX_COLUMNS);
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-end gap-1" role="img" aria-label="Shoots done and owed in each period of the contract">
        {shown.map((per) => {
          const done = per.shoots.length;
          const booked = per.scheduled.length;
          const slots = Math.min(Math.max(per.owed, done + booked), CALENDAR_MAX_SLOTS);
          const hidden = Math.max(per.owed, done + booked) - slots;
          const bal = balance.byIndex[per.index];
          const madeUp = bal?.madeUp ?? 0;
          const missing = per.future
            ? "border border-border"
            : per.noRecord
              ? "border border-dashed border-border bg-secondary/40"
              : per.inProgress
              ? "border border-dashed border-amber-500 bg-amber-50"
              : "border border-destructive/60 bg-destructive/10";
          // Slot i, bottom to top: quota shoots, extra shoots, booked, then
          // what was missed (made up first, still-owed last).
          const slotClass = (i: number) =>
            i < Math.min(done, per.owed)
              ? "bg-emerald-500"
              : i < done
                ? "bg-emerald-700"
                : i < done + booked
                  ? "border border-sky-500 bg-sky-200"
                  : i < done + booked + madeUp
                    ? "border border-emerald-500 bg-emerald-50"
                    : missing;
          return (
            <div
              key={per.index}
              title={
                per.noRecord
                  ? `${per.label}: before the Monday board's records begin`
                  : `${per.label}: ${done} of ${per.owed}${booked ? `, ${booked} booked` : ""}${madeUp ? `, ${madeUp} made up later` : ""}`
              }
              className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-md px-0.5 pb-1 pt-1.5 ${per.inProgress ? "bg-foreground/[0.06]" : ""}`}
            >
              <div className="flex w-full flex-col-reverse items-center gap-[3px]">
                {Array.from({ length: slots }, (_, i) => (
                  <span
                    key={i}
                    className={`block h-2.5 w-full max-w-[18px] rounded-[3px] ${slotClass(i)}`}
                  />
                ))}
                {hidden > 0 ? <span className="text-[8px] leading-none text-muted-foreground">+{hidden}</span> : null}
              </div>
              <span
                className={`max-w-full truncate text-[9px] leading-none ${
                  per.inProgress ? "font-semibold text-foreground" : per.future ? "text-muted-foreground/60" : "text-muted-foreground"
                }`}
              >
                {per.short}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="block h-2 w-2.5 rounded-[2px] bg-emerald-500" />
          Shoot done
        </span>
        {periods.some((per) => per.scheduled.length > 0) ? (
          <span className="inline-flex items-center gap-1">
            <span className="block h-2 w-2.5 rounded-[2px] border border-sky-500 bg-sky-200" />
            Booked
          </span>
        ) : null}
        {periods.some((per) => per.shoots.length > per.owed) ? (
          <span className="inline-flex items-center gap-1">
            <span className="block h-2 w-2.5 rounded-[2px] bg-emerald-700" />
            Extra shoot
          </span>
        ) : null}
        {balance.madeUpTotal > 0 ? (
          <span className="inline-flex items-center gap-1">
            <span className="block h-2 w-2.5 rounded-[2px] border border-emerald-500 bg-emerald-50" />
            Made up
          </span>
        ) : null}
        {balance.missedTotal > 0 ? (
          <span className="inline-flex items-center gap-1">
            <span className="block h-2 w-2.5 rounded-[2px] border border-destructive/60 bg-destructive/10" />
            Owed, not done
          </span>
        ) : null}
        {periods.some((per) => per.noRecord) ? (
          <span className="inline-flex items-center gap-1">
            <span className="block h-2 w-2.5 rounded-[2px] border border-dashed border-border bg-secondary/40" />
            No record on the board
          </span>
        ) : null}
        {periods.some((per) => per.future) ? (
          <span className="inline-flex items-center gap-1">
            <span className="block h-2 w-2.5 rounded-[2px] border border-border" />
            Still to come
          </span>
        ) : null}
        {shown.length < periods.length ? <span>· showing {shown.length} of {periods.length} periods</span> : null}
      </div>
    </div>
  );
}

// ── Shoots, month by month ────────────────────────────────────────────────────
// Billy, 2026-11-22: lay the contract out a month at a time, show each shoot
// in the month it happened, shade the months that make up a quarter (or
// whatever the contract's period is) as one block, and let a long contract
// scroll sideways from its start to today.
//
// One column per CALENDAR month, starting with the month the contract began,
// and each shoot sits in the month it actually happened (his words: "based on
// the shoots that are done during that month"). One box per shoot: green
// when done, blue when booked. Each shaded block is one period's worth of
// months with the shoots in it counted underneath ("2 of 2"). For a contract
// that starts mid-month the blocks are the nearest whole months, so a shoot
// in the first or last days of a period can sit one block over from where
// the pace lights count it. Months after a lapsed term carry on in their own
// plain block, so work that is still happening is never missing.
const MONTHS_IN_PERIOD: Partial<Record<ShootCadence, number>> = { monthly: 1, "bi-monthly": 2, quarterly: 3 };

function plusMonthsIso(iso: string, n: number): string {
  const d = new Date(iso.slice(0, 10) + "T12:00:00");
  d.setMonth(d.getMonth() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// One slot in a month: a shoot that happened or is booked, or a shoot the
// contract called for that has no date (owed, made up, still to come).
type Slot =
  | { kind: "done" | "extra" | "booked"; p: DatedProject }
  | { kind: "missed" | "madeup" | "due" | "later" | "none" };
type MonthCol = { start: string; label: string; year: string | null; current: boolean; slots: Slot[] };
type Block = { key: string; months: MonthCol[]; caption: string | null; captionTone: string; title: string; current: boolean };

const SLOT_BOX = "flex h-[15px] w-full max-w-[26px] items-center justify-center rounded-[4px] text-[9px] font-semibold leading-none tabular-nums";
const SLOT_STYLE: Record<Slot["kind"], string> = {
  done: "bg-emerald-500 text-white",
  extra: "bg-emerald-700 text-white",
  booked: "border border-sky-500 bg-sky-100 text-sky-900",
  missed: "border border-destructive/60 bg-destructive/10",
  madeup: "border border-emerald-500 bg-emerald-100",
  due: "border border-dashed border-amber-500 bg-amber-50",
  later: "border border-border",
  none: "border border-dashed border-border bg-secondary/40",
};
const SLOT_LEGEND: [Slot["kind"], string][] = [
  ["done", "Shoot done (the number is the day)"],
  ["extra", "Extra shoot"],
  ["booked", "Booked"],
  ["madeup", "Cleared by an extra shoot"],
  ["missed", "Owed, not done"],
  ["due", "Due this period"],
  ["later", "Still to come"],
  ["none", "No record on the board"],
];

function ShootTimeline({
  periods,
  balance,
  shoots,
  monthsPer,
  todayIso,
  unit,
  afterSince,
}: {
  periods: ContractPeriod[];
  balance: ContractBalance;
  shoots: DatedProject[]; // every dated shoot for the client (and pool partner)
  monthsPer: number;
  todayIso: string;
  unit: string; // "quarter", "month", ...
  afterSince: string | null; // the term's end date, when the term has lapsed
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const firstMonth = periods[0] ? `${periods[0].start.slice(0, 7)}-01` : `${todayIso.slice(0, 7)}-01`;
  const thisMonth = `${todayIso.slice(0, 7)}-01`;
  const inMonth = (start: string) => {
    const end = plusMonthsIso(start, 1);
    return shoots
      .filter((p) => p.date.slice(0, 10) >= start && p.date.slice(0, 10) < end)
      .sort((a, b) => a.date.localeCompare(b.date));
  };
  const col = (start: string, first: boolean, slots: Slot[]): MonthCol => {
    const d = new Date(start + "T12:00:00");
    return {
      start,
      label: d.toLocaleDateString("en-US", { month: "short" }),
      year: first || d.getMonth() === 0 ? `'${String(d.getFullYear()).slice(2)}` : null,
      current: start === thisMonth,
      slots,
    };
  };

  const blocks: Block[] = periods.map((per, i) => {
    const starts = Array.from({ length: monthsPer }, (_, k) => plusMonthsIso(firstMonth, i * monthsPer + k));
    const perMonth = starts.map((st) => inMonth(st));
    const done = perMonth.flat().filter((p) => p.date.slice(0, 10) <= todayIso);
    const booked = perMonth.flat().filter((p) => p.date.slice(0, 10) > todayIso);
    // Shoots beyond what this period called for are extras (they can clear a short period elsewhere).
    const extras = new Set(done.slice(per.owed));
    const isCurrent = starts.includes(thisMonth);
    const isFuture = starts[0] > thisMonth;
    const noRecord = per.noRecord && done.length === 0;
    // Slots the contract called for that no dated shoot fills.
    const open = Math.max(0, per.owed - done.length - booked.length);
    const cleared = !isCurrent && !isFuture && !noRecord ? Math.min(open, balance.byIndex[per.index]?.madeUp ?? 0) : 0;
    const openKinds: Slot["kind"][] = Array.from({ length: open }, (_, n) =>
      noRecord ? "none" : isFuture ? "later" : isCurrent ? "due" : n < cleared ? "madeup" : "missed"
    );
    const slots: Slot[][] = perMonth.map((list) =>
      list.map((p): Slot => ({ kind: p.date.slice(0, 10) > todayIso ? "booked" : extras.has(p) ? "extra" : "done", p }))
    );
    // An undated slot goes in the emptiest month of the period, left to right.
    for (const kind of openKinds) {
      let target = 0;
      for (let m = 1; m < slots.length; m++) if (slots[m].length < slots[target].length) target = m;
      slots[target].push({ kind } as Slot);
    }
    const short = !isCurrent && !isFuture && !noRecord && open - cleared > 0;
    return {
      key: `p${per.index}`,
      months: starts.map((st, k) => col(st, i === 0 && k === 0, slots[k])),
      caption: noRecord ? "no record" : `${done.length} of ${per.owed}`,
      captionTone: noRecord || isFuture ? "text-muted-foreground/70" : short ? "text-destructive" : isCurrent ? "text-amber-700" : "text-emerald-700",
      title: noRecord ? "Before the Monday board's records begin" : `${done.length} of ${per.owed} shoots`,
      current: isCurrent,
    };
  });

  // Months after a lapsed term, through the month we are in (or the last
  // booked shoot), in one plain block.
  if (afterSince && periods.length) {
    let start = plusMonthsIso(firstMonth, periods.length * monthsPer);
    const lastShootMonth = shoots.reduce((m, p) => (p.date.slice(0, 7) > m ? p.date.slice(0, 7) : m), todayIso.slice(0, 7));
    const months: MonthCol[] = [];
    for (let guard = 0; guard < 36 && start.slice(0, 7) <= lastShootMonth; guard++) {
      months.push(col(start, false, inMonth(start).map((p): Slot => ({ kind: p.date.slice(0, 10) > todayIso ? "booked" : "done", p }))));
      start = plusMonthsIso(start, 1);
    }
    if (months.length) {
      const n = months.reduce((sum, m) => sum + m.slots.filter((x) => x.kind === "done").length, 0);
      blocks.push({
        key: "after",
        months,
        caption: `after the agreement · ${n} shoot${n === 1 ? "" : "s"}`,
        captionTone: "text-muted-foreground",
        title: "After the agreement on file ended",
        current: months.some((m) => m.current),
      });
    }
  }

  // A long contract scrolls; start with the current month in view.
  useEffect(() => {
    const box = scroller.current;
    const now = box?.querySelector<HTMLElement>("[data-current-month]");
    if (box && now) box.scrollLeft = Math.max(0, now.offsetLeft - box.clientWidth * 0.6);
  }, []);

  const grouped = monthsPer > 1; // shaded blocks only when a period is more than one month
  const monthCount = blocks.reduce((n, b) => n + b.months.length, 0);
  const present = new Set(blocks.flatMap((b) => b.months.flatMap((m) => m.slots.map((x) => x.kind))));

  const month = (m: MonthCol) => (
    <div
      key={m.start}
      {...(m.current ? { "data-current-month": "" } : {})}
      className={`flex min-w-0 flex-1 flex-col items-center justify-end gap-1 rounded-md px-0.5 pb-1 pt-1 ${m.current ? "bg-foreground/[0.07]" : ""}`}
    >
      <div className="flex min-h-[15px] w-full flex-col-reverse items-center gap-[3px]">
        {m.slots.slice(0, 6).map((x, i) => {
          const cls = `${SLOT_BOX} ${SLOT_STYLE[x.kind]}`;
          if (!("p" in x)) return <span key={i} className={cls} />;
          const tip = `${shortDate(x.p.date)}${x.kind === "booked" ? " (booked)" : ""} · ${projectLabel(x.p)}`;
          const dayOfMonth = Number(x.p.date.slice(8, 10));
          return x.p.url ? (
            <a key={i} href={x.p.url} target="_blank" rel="noopener noreferrer" title={tip} className={`${cls} transition-opacity hover:opacity-70`}>
              {dayOfMonth}
            </a>
          ) : (
            <span key={i} title={tip} className={cls}>
              {dayOfMonth}
            </span>
          );
        })}
        {m.slots.length > 6 ? <span className="text-[8px] leading-none text-muted-foreground">+{m.slots.length - 6}</span> : null}
      </div>
      <span className={`whitespace-nowrap text-[9px] leading-none ${m.current ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
        {m.label}
        {m.year ? <span className="text-muted-foreground/70"> {m.year}</span> : null}
      </span>
    </div>
  );

  return (
    <div className="flex flex-col gap-1.5">
      <div ref={scroller} className="overflow-x-auto pb-1" role="img" aria-label="Shoots in each month of the contract">
        <div className={`flex items-stretch ${grouped ? "gap-1.5" : "gap-0.5"}`} style={{ minWidth: `${monthCount * 3.1}rem` }}>
          {blocks.map((b) =>
            grouped || b.key === "after" ? (
              // A quarter (or other multi-month period): its months shaded as one block.
              <div
                key={b.key}
                title={b.title}
                className={`flex flex-col rounded-lg border px-1 pb-1 pt-1.5 ${
                  b.key === "after" ? "border-dashed border-border bg-transparent" : b.current ? "border-foreground/25 bg-secondary/50" : "border-border/70 bg-secondary/30"
                }`}
                style={{ flex: `${b.months.length} 1 0` }}
              >
                <div className="flex flex-1 items-stretch">{b.months.map(month)}</div>
                {b.caption ? <div className={`mt-0.5 truncate text-center text-[9px] font-medium leading-none ${b.captionTone}`}>{b.caption}</div> : null}
              </div>
            ) : (
              // Monthly contracts: just the months, no boxes around them.
              <div key={b.key} title={b.title} className="flex" style={{ flex: "1 1 0" }}>
                {b.months.map(month)}
              </div>
            )
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        {SLOT_LEGEND.filter(([kind]) => present.has(kind)).map(([kind, label]) => (
          <span key={kind} className="inline-flex items-center gap-1">
            <span className={`block h-2 w-2.5 rounded-[2px] ${SLOT_STYLE[kind].replace(/text-\S+/g, "")}`} />
            {label}
          </span>
        ))}
        {grouped ? <span>· each shaded block is one {unit}</span> : null}
      </div>
    </div>
  );
}

// ── Status line ───────────────────────────────────────────────────────────────
// One quiet line per light: dot, what it covers, the verdict. The reason is a
// tap away, so the box stays calm at a glance.
const STATUS_TONE = {
  red: { dot: "bg-destructive", text: "text-destructive" },
  yellow: { dot: "bg-amber-400", text: "text-amber-700" },
  green: { dot: "bg-emerald-500", text: "text-emerald-700" },
} as const;

function StatusRow({
  scope,
  level,
  label,
  reason,
}: {
  scope: string;
  level: "green" | "yellow" | "red";
  label: string;
  reason?: string;
}) {
  const [open, setOpen] = useState(false);
  const tone = STATUS_TONE[level];
  return (
    <div>
      <button
        type="button"
        onClick={() => reason && setOpen((v) => !v)}
        aria-expanded={reason ? open : undefined}
        className="flex w-full items-center gap-2 px-2.5 py-3 text-left text-xs md:py-2"
      >
        <span className={`h-2 w-2 flex-shrink-0 rounded-full ${tone.dot}`} />
        <span className="flex-shrink-0 text-muted-foreground">{scope}</span>
        <span className={`min-w-0 flex-1 truncate text-right font-semibold ${tone.text}`}>{label}</span>
        {reason ? (
          <ChevronDown
            className={`h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          />
        ) : null}
      </button>
      {open && reason ? <div className="px-2.5 pb-2.5 pl-[26px] text-[11px] leading-snug text-muted-foreground">{reason}</div> : null}
    </div>
  );
}

// ── Drop-down row ─────────────────────────────────────────────────────────────
// One line when closed (label + the start of the text), the full content when
// opened. Keeps long contract language out of the way until someone wants it.
function Expandable({
  label,
  preview,
  tone = "muted",
  children,
}: {
  label: string;
  preview?: string;
  tone?: "accent" | "muted";
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={`rounded-md border border-dashed ${
        tone === "accent" ? "border-accent/40 bg-accent-soft/40" : "border-border bg-secondary/20"
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2.5 py-2.5 text-left text-xs md:py-2"
      >
        <span className="flex-shrink-0 font-medium text-foreground">{label}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{open ? "" : preview}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? <div className="px-2.5 pb-2.5 text-xs leading-relaxed text-foreground">{children}</div> : null}
    </div>
  );
}

// ── Small form primitives ─────────────────────────────────────────────────────
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-medium text-foreground">
        {label}
        {hint ? <span className="ml-1 font-normal text-muted-foreground">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

const inputCls = "rounded-md border border-input bg-panel px-2 py-1.5 text-sm";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</div>;
}

// Repeatable {label, qty} line editor for Deliverables / Post-production.
function DeliverableEditor({
  lines,
  onChange,
  addLabel,
  placeholder,
}: {
  lines: DeliverableLine[] | undefined;
  onChange: (next: DeliverableLine[]) => void;
  addLabel: string;
  placeholder: string;
}) {
  const list = lines ?? [];
  const update = (i: number, patch: Partial<DeliverableLine>) => {
    const copy = [...list];
    copy[i] = { ...copy[i], ...patch };
    onChange(copy);
  };
  return (
    <div className="flex flex-col gap-1.5">
      {list.map((line, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="text"
            value={line.qty ?? ""}
            onChange={(e) => update(i, { qty: e.target.value || undefined })}
            placeholder="Qty"
            className={`${inputCls} w-16 flex-shrink-0 text-center`}
          />
          <input
            type="text"
            value={line.label}
            onChange={(e) => update(i, { label: e.target.value })}
            placeholder={placeholder}
            className={`${inputCls} flex-1`}
          />
          <button
            type="button"
            onClick={() => onChange(list.filter((_, j) => j !== i))}
            className="flex-shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-destructive"
            aria-label="Remove line"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...list, { label: "" }])}
        className="inline-flex w-fit items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        <Plus className="h-3 w-3" />
        {addLabel}
      </button>
    </div>
  );
}

export function ScopeTile({
  brandId,
  initialScope,
  socialHistory = [],
  socialConnected = false,
  recordsFrom = null,
  datedProjects = [],
  pool = null,
  poolOptions = [],
  today,
}: {
  brandId: string;
  initialScope: BrandScope | null;
  // Posts approved each month since the contract term began, from SocialDesk.
  socialHistory?: SocialMonth[];
  socialConnected?: boolean;
  // The day the Monday All Projects board's records begin (YYYY-MM-DD).
  // Contract periods that began before it are shown as "no record".
  recordsFrom?: string | null;
  // Every dated project for this client from the Monday All Projects board,
  // classified by Project Type (and including the pool partner's when linked).
  datedProjects?: DatedProject[];
  // Set when this scope shares a shoot pool with another client.
  pool?: { name: string; partnerRate: number | null } | null;
  // Other clients, for the "Shared shoot pool with" picker.
  poolOptions?: { id: string; name: string }[];
  // Today's date in New York (YYYY-MM-DD), handed down by the server so the
  // page it sends and the page the browser builds count from the same day.
  today?: string;
}) {
  const now = useMemo(() => noonOn(today ?? easternToday()), [today]);
  const [editing, setEditing] = useState(false);
  const [scope, setScope] = useState<BrandScope>(initialScope ?? {});
  const [draft, setDraft] = useState<BrandScope>(scope);
  const [pending, startTransition] = useTransition();
  const [showLog, setShowLog] = useState(false);
  // After a save: what happened on the Monday All Accounts board.
  const [boardNote, setBoardNote] = useState<{ ok: boolean; text: string } | null>(null);
  // A first pass at the scope read from the signed agreement on the client's
  // All Accounts row (lib/scope/agreement.ts). It only fills the form: nothing
  // is saved until the account manager presses Save.
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [fromAgreement, setFromAgreement] = useState<ScopeDraft | null>(null);
  // A draft the morning check left on this client, not yet confirmed.
  const waiting = scope.pending_draft ?? null;

  const dirty = JSON.stringify(draft) !== JSON.stringify(scope);
  const services = scope.services ?? [];
  const empty =
    services.length === 0 &&
    !scope.shoot_cadence &&
    (scope.channels ?? []).length === 0 &&
    !scope.retainer_amount;

  function save() {
    // Drop empty deliverable/post-production lines before persisting.
    const clean: BrandScope = {
      ...draft,
      deliverables: (draft.deliverables ?? []).filter((l) => l.label.trim()),
      post_production: (draft.post_production ?? []).filter((l) => l.label.trim()),
    };
    if (!clean.deliverables?.length) delete clean.deliverables;
    if (!clean.post_production?.length) delete clean.post_production;
    startTransition(async () => {
      const result = await saveBrandScope(brandId, clean);
      if (result.ok) {
        // A waiting draft stays waiting unless this save was made from it.
        const { pending_draft: _p, ...saved } = clean;
        void _p;
        const next: BrandScope = waiting && !result.draftCleared ? { ...saved, pending_draft: waiting } : saved;
        setScope(next);
        setDraft(next);
        setEditing(false);
        setFromAgreement(null);
        setReadError(null);
        setBoardNote(result.board ?? null);
      }
    });
  }

  function cancel() {
    setDraft(scope);
    setEditing(false);
    setFromAgreement(null);
    setReadError(null);
  }

  // Put a drafted scope into the form. The agreement replaces the contract
  // fields outright; what it never carries (the shared shoot pool, the fee,
  // the app's own links) stays as it was.
  function applyAgreement(d: ScopeDraft) {
    setDraft((prev) => {
      const keep: BrandScope = {};
      if (prev.pool_with) keep.pool_with = prev.pool_with;
      if (prev.retainer_amount != null) keep.retainer_amount = prev.retainer_amount;
      if (prev.billing_frequency) keep.billing_frequency = prev.billing_frequency;
      if (prev.monday_account_item_id) keep.monday_account_item_id = prev.monday_account_item_id;
      if (prev.socialdesk_client) keep.socialdesk_client = prev.socialdesk_client;
      // Notes somebody typed are kept under the new ones; an earlier
      // "Entered from the agreement" line is about the old file, so it goes.
      const earlier = prev.notes?.trim();
      const typedNotes = earlier && !/^(Entered|Drafted) /.test(earlier) ? earlier : "";
      const notes = [d.scope.notes, typedNotes].filter(Boolean).join("\n\n");
      return { ...keep, ...d.scope, ...(notes ? { notes } : {}), agreement_asset_id: d.asset_id };
    });
    setFromAgreement(d);
    setReadError(null);
    setEditing(true);
  }

  async function readAgreement() {
    setReading(true);
    setReadError(null);
    const failed = "The agreement could not be read just now. Try again in a minute.";
    try {
      const res = await fetch("/api/scope-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; draft?: ScopeDraft; error?: string } | null;
      if (json?.ok && json.draft) applyAgreement(json.draft);
      else setReadError(json?.error ?? failed);
    } catch {
      setReadError(failed);
    } finally {
      setReading(false);
    }
  }

  function dismissWaiting() {
    startTransition(async () => {
      const result = await dismissScopeDraft(brandId);
      if (result.ok) {
        setScope((prev) => {
          const { pending_draft: _p, ...rest } = prev;
          void _p;
          return rest;
        });
      }
    });
  }

  // ── Readout mode ────────────────────────────────────────────────────────────
  if (!editing) {
    // Renewal clock runs on the term in force (auto-renewals rolled forward).
    const daysToRenewal = daysUntil(effectiveScope(scope, now).renewal_date, now);
    const renewalBadge =
      daysToRenewal == null
        ? null
        : daysToRenewal < 0
          ? { text: "Renewal overdue", className: "bg-destructive/10 text-destructive" }
          : daysToRenewal <= 14
            ? { text: `Renewal in ${daysToRenewal}d`, className: "bg-amber-100 text-amber-900" }
            : daysToRenewal <= 60
              ? { text: `Renewal in ${daysToRenewal}d`, className: "bg-accent-soft text-accent-foreground" }
              : { text: `Renewal in ${daysToRenewal}d`, className: "bg-secondary text-muted-foreground" };

    const delivCount = (scope.deliverables ?? []).length + (scope.post_production ?? []).length;

    // All the contract maths lives in lib/scope/summary.ts so the all-accounts
    // view and the morning alerts read exactly the same numbers as this tile.
    const {
      quota,
      shootsThisPeriod,
      kinds,
      pace,
      timeline,
      periods,
      lastClosed,
      balance,
      lastShoot,
      nextShoot,
      daysSinceLast,
      remaining,
      periodsLeft,
      unit,
      perPeriod,
      monthHealth,
      health,
      lights,
      records,
      afterTerm,
      currentPeriod,
    } = summarizeContract(scope, datedProjects, pool, now, { recordsFrom });
    const social = socialToDate(effectiveScope(scope, now), socialHistory, today ?? easternToday());
    // The year at a glance: every shoot on the board this calendar year with
    // its date, against what the cadence adds up to over a year. Quarters and
    // months get filled in as the year goes, so this is the plain read.
    const todayIso = today ?? easternToday();
    // The term in force (auto-renewals rolled forward) and whether it has run out.
    const termView = effectiveScope(scope, now);
    const termLapsed = !!termView.end_date && termView.end_date.slice(0, 10) < todayIso;
    const thisYear = todayIso.slice(0, 4);
    const yearShoots = datedProjects
      .filter((p) => p.kind === "shoot" && p.date.slice(0, 4) === thisYear)
      .sort((a, b) => a.date.localeCompare(b.date));
    const perYear = scope.shoot_cadence && PERIODS_PER_YEAR[scope.shoot_cadence] ? quota * (PERIODS_PER_YEAR[scope.shoot_cadence] as number) : null;
    const yearDone = yearShoots.filter((p) => p.date.slice(0, 10) <= todayIso).length;
    // "Jun and Aug": period captions for a list of period numbers.
    const names = (idx: number[]) => {
      const list = idx.map((i) => timeline.find((per) => per.index === i)?.short ?? "").filter(Boolean);
      return list.length <= 1 ? (list[0] ?? "") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
    };
    const extras = kinds
      ? [
          kinds.micro ? `${kinds.micro} micro shoot${kinds.micro === 1 ? "" : "s"}` : null,
          kinds.edit ? `${kinds.edit} edit request${kinds.edit === 1 ? "" : "s"}` : null,
          kinds.other
            ? `${kinds.other} other dated project${kinds.other === 1 ? "" : "s"} (other project types, not counted)`
            : null,
        ].filter(Boolean)
      : [];

    return (
      <Tile label="Scope & contract health" icon={<BarChart3 className="h-3.5 w-3.5" />} spans={2}>
        <div className="flex flex-col gap-3">
          {boardNote ? (
            <div className={`text-[11px] ${boardNote.ok ? "text-emerald-700" : "text-amber-700"}`} role="status">
              Saved. {boardNote.text}
            </div>
          ) : null}
          {waiting ? (
            <div className="flex flex-col gap-2 rounded-md border border-border bg-secondary/40 p-2.5 md:flex-row md:items-center md:justify-between md:gap-4">
              <div className="min-w-0 text-xs">
                <div className="font-medium text-foreground">A new agreement is on file. The scope is drafted and waiting for you.</div>
                <div className="text-muted-foreground">
                  Read from &ldquo;{waiting.file}&rdquo;
                  {waiting.uploaded_at ? `, uploaded ${fullDate(waiting.uploaded_at)}` : ""}. Nothing changes until you review it and save.
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => applyAgreement(waiting)}
                  disabled={pending}
                  className="tap-target inline-flex items-center gap-1 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  Review draft
                </button>
                <button
                  type="button"
                  onClick={dismissWaiting}
                  disabled={pending}
                  className="tap-target inline-flex items-center rounded-md border border-border bg-panel px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
                >
                  Not needed
                </button>
              </div>
            </div>
          ) : null}
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              {services.map((s) => (
                <span key={s} className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-foreground">
                  {SERVICE_LABELS[s]}
                </span>
              ))}
              {scope.shoot_cadence ? (
                <span>
                  <span className="font-medium text-foreground">
                    {quota}× {CADENCE_LABELS[scope.shoot_cadence]}
                  </span>{" "}
                  shoots{pool ? ` (shared with ${pool.name})` : ""}
                </span>
              ) : null}
              {scope.term ? <span>· {TERM_LABELS[scope.term]}</span> : null}
              {renewalBadge ? (
                <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ${renewalBadge.className}`}>
                  {renewalBadge.text}
                </span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => {
                setDraft(scope);
                setEditing(true);
              }}
              className="tap-target inline-flex flex-shrink-0 items-center gap-1 rounded-md border border-border bg-panel px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary md:px-2 md:py-1"
            >
              <Pencil className="h-3 w-3" />
              Edit
            </button>
          </div>

          {empty ? (
            <div className="flex flex-col items-start gap-2">
              <TileEmpty>
                No scope set yet. Click Edit to capture services, term, production, deliverables and renewal dates, or
                let the signed agreement fill it in for you to check.
              </TileEmpty>
              {waiting ? null : (
                <button
                  type="button"
                  onClick={readAgreement}
                  disabled={reading}
                  className="tap-target inline-flex items-center gap-1.5 rounded-md border border-border bg-panel px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-60"
                >
                  <FileText className="h-3 w-3" />
                  {reading ? "Reading the agreement, about a minute…" : "Draft from the agreement"}
                </button>
              )}
              {readError ? (
                <div className="text-[11px] text-amber-700" role="alert">
                  {readError}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {scope.shoot_cadence && !(pace && pace.status !== "not_started") ? (
                <Meter label="Shoots this month" done={shootsThisPeriod} quota={quota} />
              ) : null}
              {pace && health && pace.status !== "not_started" ? (
                <div className="flex flex-col gap-2 rounded-md border border-border bg-secondary/20 p-2.5">
                  <div className="text-[11px] font-medium text-foreground">
                    Contract to date
                    {pool ? <span className="font-normal text-muted-foreground"> · shared pool with {pool.name}</span> : null}
                  </div>
                  {/* Two lights, one line each: this month, then the full contract. Tap for the reason. */}
                  <div className="divide-y divide-border rounded-md border border-border bg-panel">
                    {lights.map((l) => (
                      <StatusRow key={l.scope} scope={l.scope} level={l.level} label={l.label} reason={l.reason} />
                    ))}
                  </div>
                  {/* Where it stands, in a sentence, with real dates. */}
                  <p className="text-[12px] leading-relaxed text-muted-foreground">
                    {termLapsed ? (
                      <>
                        The agreement on file ended <span className="font-medium text-foreground">{fullDate(termView.end_date as string)}</span> and
                        no renewal is on file.{" "}
                        {afterTerm && afterTerm.shoots.length > 0 ? (
                          <>
                            <span className="font-medium text-foreground">
                              {afterTerm.shoots.length} shoot{afterTerm.shoots.length === 1 ? " has" : "s have"}
                            </span>{" "}
                            happened since.{" "}
                          </>
                        ) : null}
                        {records ? (
                          <>
                            For the part the Monday board covers (from {records.countedFrom}),{" "}
                            <span className="font-medium text-foreground">
                              {pace.done} of {pace.total}
                            </span>{" "}
                            shoots were done.
                          </>
                        ) : (
                          <>
                            While it ran,{" "}
                            <span className="font-medium text-foreground">
                              {pace.done}
                              {pace.total != null ? ` of ${pace.total}` : ""}
                            </span>{" "}
                            shoots were done.
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        <span className="font-medium text-foreground">
                          {pace.done}
                          {pace.total != null ? ` of ${pace.total}` : ""} shoots done
                        </span>
                        {pace.total != null && termView.start_date && termView.end_date
                          ? ` on this agreement, which runs ${fullDate(termView.start_date)} to ${fullDate(termView.end_date)}.`
                          : termView.start_date
                            ? ` since ${fullDate(termView.start_date)}.`
                            : "."}{" "}
                        {pace.expectedToDate > 0 && lastClosed
                          ? `${pace.expectedToDate} ${pace.expectedToDate === 1 ? "was" : "were"} due by ${shortDate(lastClosed.end)}.`
                          : currentPeriod
                            ? `Nothing is due until ${shortDate(currentPeriod.end)}.`
                            : ""}
                        {records ? ` Counted from ${records.countedFrom}, where the Monday board's records begin.` : ""}
                      </>
                    )}
                  </p>
                  {timeline.length ? (
                    scope.shoot_cadence && MONTHS_IN_PERIOD[scope.shoot_cadence] ? (
                      <ShootTimeline
                        periods={timeline}
                        balance={balance}
                        shoots={datedProjects.filter((p) => p.kind === "shoot")}
                        monthsPer={MONTHS_IN_PERIOD[scope.shoot_cadence] as number}
                        todayIso={todayIso}
                        unit={pace.unitLabel.toLowerCase()}
                        afterSince={afterTerm ? afterTerm.since : null}
                      />
                    ) : (
                      <ContractCalendar periods={timeline} balance={balance} />
                    )
                  ) : null}
                  {/* The few facts worth a glance */}
                  <dl className="flex flex-col gap-1 border-t border-border pt-2 text-[11px]">
                    {perYear ? (
                      <div className="flex items-baseline justify-between gap-3">
                        <dt className="flex-shrink-0 text-muted-foreground">Shoots in {thisYear}</dt>
                        <dd className="min-w-0 truncate text-right text-foreground">
                          {yearDone}
                          <span className="text-muted-foreground"> · the agreement adds up to {perYear} a year</span>
                        </dd>
                      </div>
                    ) : null}
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="flex-shrink-0 text-muted-foreground">Last shoot</dt>
                      <dd className="min-w-0 truncate text-right text-foreground">
                        {lastShoot ? (
                          <>
                            {shortDate(lastShoot.date)}
                            {daysSinceLast != null ? (
                              <span className="text-muted-foreground">
                                {" · "}
                                {daysSinceLast === 0 ? "today" : `${daysSinceLast} day${daysSinceLast === 1 ? "" : "s"} ago`}
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-muted-foreground">None yet</span>
                        )}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="flex-shrink-0 text-muted-foreground">Next shoot</dt>
                      <dd className="min-w-0 truncate text-right text-foreground">
                        {nextShoot ? (
                          <>
                            {shortDate(nextShoot.date)}
                            <span className="text-muted-foreground"> · {projectLabel(nextShoot)}</span>
                          </>
                        ) : (
                          <span className={monthHealth?.level === "yellow" ? "font-medium text-amber-700" : "text-muted-foreground"}>
                            None scheduled
                          </span>
                        )}
                      </dd>
                    </div>
                    {!termLapsed && remaining != null ? (
                      <div className="flex items-baseline justify-between gap-3">
                        <dt className="flex-shrink-0 text-muted-foreground">Left on this agreement</dt>
                        <dd className="min-w-0 text-right text-foreground">
                          {remaining === 0 ? (
                            "All shoots done"
                          ) : (
                            <>
                              {remaining}
                              {termView.end_date ? <span className="text-muted-foreground"> · by {fullDate(termView.end_date)}</span> : null}
                            </>
                          )}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                  {/* The fine print, a tap away */}
                  {records || afterTerm || extras.length ? (
                    <details className="group/how text-[11px] text-muted-foreground">
                      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 font-medium text-foreground/80 [&::-webkit-details-marker]:hidden">
                        How this is counted
                        <ChevronDown className="h-3 w-3 transition-transform group-open/how:rotate-180" />
                      </summary>
                      <div className="mt-1.5 flex flex-col gap-1.5">
                        <div>
                          Shoots are the dated projects on the Monday All Projects board. {pace.unitLabel} {pace.periodIndex}
                          {pace.periodCount ? ` of ${pace.periodCount}` : ""} of the agreement.
                        </div>
                        {records ? (
                          <div>
                            The Monday board has no projects before {fullDate(records.from)}, so the {records.unrecorded} earlier{" "}
                            {pace.unitLabel.toLowerCase()}
                            {records.unrecorded === 1 ? " is" : "s are"} not judged either way.
                          </div>
                        ) : null}
                        {afterTerm ? (
                          <div>
                            Since the agreement ended: {afterTerm.shoots.length} shoot{afterTerm.shoots.length === 1 ? "" : "s"}
                            {afterTerm.micro ? `, ${afterTerm.micro} micro shoot${afterTerm.micro === 1 ? "" : "s"}` : ""}
                            {afterTerm.edits ? `, ${afterTerm.edits} edit request${afterTerm.edits === 1 ? "" : "s"}` : ""}. These are shown but not
                            counted against the ended agreement.
                          </div>
                        ) : null}
                        {extras.length ? <div>Also during the agreement: {extras.join(" · ")}.</div> : null}
                      </div>
                    </details>
                  ) : null}
                  {periods.length ? (
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => setShowLog((v) => !v)}
                        className="tap-target inline-flex w-fit items-center py-1 text-[12px] font-medium text-foreground underline underline-offset-2 md:py-0 md:text-[11px]"
                      >
                        {showLog
                          ? "Hide shoot log"
                          : `View shoot log (${pace.done + (afterTerm?.shoots.length ?? 0)} shoot${pace.done + (afterTerm?.shoots.length ?? 0) === 1 ? "" : "s"})`}
                      </button>
                      {showLog ? (
                        <div className="divide-y divide-border rounded-md border border-border bg-panel">
                          {periods.map((per) => {
                            const short = per.shoots.length < per.owed;
                            const bal = balance.byIndex[per.index];
                            const covered = short && !per.inProgress && !!bal && bal.missed === 0;
                            const tone = per.noRecord
                              ? "text-muted-foreground"
                              : !short || covered
                              ? "text-emerald-700"
                              : per.inProgress
                                ? "text-amber-700"
                                : "text-destructive";
                            return (
                              <div key={per.index} className="flex flex-col gap-1 px-3 py-2">
                                <div className="flex items-center justify-between gap-2 text-[11px]">
                                  <span className="font-medium text-foreground">
                                    {per.label}
                                    {per.inProgress ? (
                                      <span className="font-normal text-muted-foreground"> · in progress</span>
                                    ) : null}
                                  </span>
                                  <span className={`font-medium tabular-nums ${tone}`}>
                                    {per.noRecord ? "no record" : `${per.shoots.length} / ${per.owed}`}
                                    {covered && bal && !per.noRecord ? <span className="font-normal"> · made up in {names(bal.coveredBy)}</span> : null}
                                  </span>
                                </div>
                                {per.shoots.length === 0 ? (
                                  <div className="text-[11px] italic text-muted-foreground">
                                    {per.noRecord ? "Before the Monday board's records begin" : "No shoots"}
                                  </div>
                                ) : null}
                                {per.shoots.map((p, i) => (
                                  <LogLine key={`s${i}`} p={p} showClient={!!pool} />
                                ))}
                                {per.scheduled.map((p, i) => (
                                  <LogLine key={`b${i}`} p={p} tag="Booked" showClient={!!pool} />
                                ))}
                                {per.micro.map((p, i) => (
                                  <LogLine key={`m${i}`} p={p} tag="Micro" showClient={!!pool} />
                                ))}
                                {per.edits.map((p, i) => (
                                  <LogLine key={`e${i}`} p={p} tag="Edit" showClient={!!pool} />
                                ))}
                              </div>
                            );
                          })}
                          {afterTerm && afterTerm.shoots.length > 0 ? (
                            <div className="flex flex-col gap-1 px-3 py-2">
                              <div className="flex items-center justify-between gap-2 text-[11px]">
                                <span className="font-medium text-foreground">After the term on file ended</span>
                                <span className="font-medium tabular-nums text-muted-foreground">{afterTerm.shoots.length}</span>
                              </div>
                              {afterTerm.shoots.map((p, i) => (
                                <LogLine key={`a${i}`} p={p} showClient={!!pool} />
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {/* Social, over the contract: this month and next live in the
                  SocialDesk tile above, so this is the long view only. */}
              {social ? (
                <div className="flex flex-col gap-2 rounded-md border border-border bg-secondary/20 p-2.5">
                  <div className="text-[11px] font-medium text-foreground">Social posts, contract to date</div>
                  {!socialConnected ? (
                    <div className="text-[11px] text-muted-foreground">SocialDesk could not be read just now.</div>
                  ) : social.months === 0 ? (
                    <div className="text-[11px] text-muted-foreground">
                      Counting starts once the first full month of the term has passed.
                    </div>
                  ) : (
                    <>
                      <div className="-mt-1 text-[11px] text-muted-foreground">
                        Posts approved from {social.fromLabel} through {social.throughLabel} ({social.months} full month
                        {social.months === 1 ? "" : "s"}), against what the contract calls for over the same months.
                      </div>
                      {social.rows.map((r) => (
                        <div key={r.channel} className="flex flex-col gap-1">
                          <div className="text-[11px] font-medium text-foreground">{r.channel}</div>
                          {r.inFeed ? <Meter label="In-feed" done={r.inFeed.done} quota={r.inFeed.owed} /> : null}
                          {r.stories ? <Meter label="Stories" done={r.stories.done} quota={r.stories.owed} /> : null}
                        </div>
                      ))}
                    </>
                  )}
                  <div className="border-t border-border pt-2 text-[11px] text-muted-foreground">
                    Monthly social reporting: coming soon.
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {delivCount > 0 ? (
            <Expandable
              label={`Deliverables (${delivCount})`}
              preview={[...(scope.deliverables ?? []), ...(scope.post_production ?? [])].map((l) => l.label).join(", ")}
            >
              <div className="flex flex-col gap-2">
                {(
                  [
                    ["Each shoot / period", scope.deliverables ?? []],
                    ["Post-production", scope.post_production ?? []],
                  ] as [string, DeliverableLine[]][]
                )
                  .filter(([, lines]) => lines.length > 0)
                  .map(([heading, lines]) => (
                    <div key={heading}>
                      <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{heading}</div>
                      <ul className="flex flex-col gap-0.5">
                        {lines.map((l, i) => (
                          <li key={i} className="flex items-baseline justify-between gap-3">
                            <span>{l.label}</span>
                            {l.qty ? <span className="flex-shrink-0 tabular-nums text-muted-foreground">{l.qty}</span> : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
              </div>
            </Expandable>
          ) : null}

          {scope.guarantees ? (
            <Expandable label="Guarantee" preview={scope.guarantees} tone="accent">
              <div className="whitespace-pre-line">{scope.guarantees}</div>
            </Expandable>
          ) : null}

          {scope.notes ? (
            <Expandable label="Internal notes" preview={scope.notes}>
              <div className="whitespace-pre-line text-muted-foreground">{scope.notes}</div>
            </Expandable>
          ) : null}
        </div>
      </Tile>
    );
  }

  // ── Edit mode ─────────────────────────────────────────────────────────────────
  function updateChannel(name: string, patch: Partial<ScopeChannel>) {
    setDraft((prev) => {
      const list = prev.channels ?? [];
      const idx = list.findIndex((c) => c.name === name);
      const next: ScopeChannel = { ...(idx >= 0 ? list[idx] : { name }), ...patch };
      const copy = [...list];
      if (idx >= 0) copy[idx] = next;
      else copy.push(next);
      return { ...prev, channels: copy };
    });
  }

  function toggleService(s: ServiceType) {
    setDraft((prev) => {
      const set = new Set(prev.services ?? []);
      if (set.has(s)) set.delete(s);
      else set.add(s);
      return { ...prev, services: [...set] };
    });
  }

  // Term drives End + Renewal; both stay editable afterwards.
  function setTerm(term: ContractTerm) {
    setDraft((prev) => {
      const { end, renewal } = computeTermDates(prev.start_date, term);
      return {
        ...prev,
        term,
        ...(end ? { end_date: end } : {}),
        ...(renewal ? { renewal_date: renewal } : {}),
      };
    });
  }
  function setStart(start: string) {
    setDraft((prev) => {
      const { end, renewal } = computeTermDates(start, prev.term);
      return {
        ...prev,
        start_date: start || undefined,
        ...(end ? { end_date: end } : {}),
        ...(renewal ? { renewal_date: renewal } : {}),
      };
    });
  }

  const smmOn = (draft.services ?? []).includes("social_media");

  return (
    <Tile label="Scope & contract health" icon={<BarChart3 className="h-3.5 w-3.5" />} spans={2}>
      <div className="flex flex-col gap-5">
        {/* First pass from the signed agreement */}
        <div className="flex flex-col gap-2 rounded-md border border-border bg-secondary/20 p-2.5">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-4">
            <div className="min-w-0 text-[11px] text-muted-foreground">
              {fromAgreement ? (
                <>
                  Filled in from <span className="font-medium text-foreground">&ldquo;{fromAgreement.file}&rdquo;</span>
                  {fromAgreement.uploaded_at ? `, uploaded ${fullDate(fromAgreement.uploaded_at)}` : ""}. Check it against the
                  agreement, change anything that is off, then save. Nothing is saved until you do.
                </>
              ) : (
                <>
                  Signed agreement on this client&apos;s All Accounts row? It can fill this form in for you to check. Fees are
                  never read in.
                </>
              )}
            </div>
            <button
              type="button"
              onClick={readAgreement}
              disabled={reading || pending}
              className="tap-target inline-flex flex-shrink-0 items-center gap-1.5 rounded-md border border-border bg-panel px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-60"
            >
              <FileText className="h-3 w-3" />
              {reading ? "Reading, about a minute…" : fromAgreement ? "Read it again" : "Draft from the agreement"}
            </button>
          </div>
          {readError ? (
            <div className="text-[11px] text-amber-700" role="alert">
              {readError}
            </div>
          ) : null}
          {fromAgreement ? (
            fromAgreement.check.length ? (
              <div className="flex flex-col gap-1">
                <div className="text-[11px] font-medium text-foreground">Check before saving</div>
                <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
                  {fromAgreement.check.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="text-[11px] text-muted-foreground">Nothing was flagged. Still worth a read-through before saving.</div>
            )
          ) : null}
        </div>

        {/* Services */}
        <div className="flex flex-col gap-2">
          <SectionLabel>Services</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {SERVICE_TYPES.map((s) => {
              const on = (draft.services ?? []).includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleService(s)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    on
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-panel text-muted-foreground hover:bg-secondary"
                  }`}
                >
                  {SERVICE_LABELS[s]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Term & dates */}
        <div className="flex flex-col gap-2">
          <SectionLabel>Term &amp; dates</SectionLabel>
          <p className="-mt-1 text-[11px] text-muted-foreground">
            These are copied to this client&apos;s row on the Monday All Accounts board when you save (Contract Start,
            Contract Due, Retention Due 60 days before, and Auto Renew). Change them here, not on the board.
          </p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Start date">
              <input
                type="date"
                value={draft.start_date ?? ""}
                onChange={(e) => setStart(e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Term" hint="(sets End + Renewal)">
              <select
                value={draft.term ?? ""}
                onChange={(e) => setTerm((e.target.value || undefined) as ContractTerm)}
                className={inputCls}
              >
                <option value="">(not set)</option>
                {CONTRACT_TERMS.map((t) => (
                  <option key={t} value={t}>
                    {TERM_LABELS[t]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="End date">
              <input
                type="date"
                value={draft.end_date ?? ""}
                onChange={(e) => setDraft({ ...draft, end_date: e.target.value || undefined })}
                className={inputCls}
              />
            </Field>
            <Field label="Renewal date">
              <input
                type="date"
                value={draft.renewal_date ?? ""}
                onChange={(e) => setDraft({ ...draft, renewal_date: e.target.value || undefined })}
                className={inputCls}
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-xs text-foreground">
            <input
              type="checkbox"
              checked={!!draft.auto_renew}
              onChange={(e) => setDraft({ ...draft, auto_renew: e.target.checked || undefined })}
              className="h-3.5 w-3.5"
            />
            Auto-renews
          </label>
        </div>

        {/* Social Media Management — only when that service is selected */}
        {smmOn ? (
          <div className="flex flex-col gap-2">
            <SectionLabel>Social Media Management</SectionLabel>
            <div className="text-[11px] text-muted-foreground">Monthly minimums per channel (leave blank if not run)</div>
            <div className="divide-y divide-border rounded-md border border-border bg-secondary/20">
              {SMM_CHANNELS.map((name) => {
                const existing = (draft.channels ?? []).find((c) => c.name === name) ?? { name };
                return (
                  <div key={name} className="grid grid-cols-2 items-center gap-2 px-3 py-2 text-xs md:grid-cols-3">
                    <div className="col-span-2 font-medium text-foreground md:col-span-1 md:font-normal">{name}</div>
                    <label className="flex items-center gap-2">
                      <span className="w-12 text-muted-foreground">In-Feed</span>
                      <input
                        type="number"
                        min={0}
                        value={existing.inFeed ?? ""}
                        onChange={(e) =>
                          updateChannel(name, { inFeed: e.target.value ? Number(e.target.value) : undefined })
                        }
                        className="w-16 rounded-md border border-input bg-panel px-2 py-1 text-sm"
                      />
                    </label>
                    <label className="flex items-center gap-2">
                      <span className="w-12 text-muted-foreground">Stories</span>
                      <input
                        type="number"
                        min={0}
                        value={existing.stories ?? ""}
                        onChange={(e) =>
                          updateChannel(name, { stories: e.target.value ? Number(e.target.value) : undefined })
                        }
                        className="w-16 rounded-md border border-input bg-panel px-2 py-1 text-sm"
                      />
                    </label>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* Production */}
        <div className="flex flex-col gap-2">
          <SectionLabel>Production</SectionLabel>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field label="Shoot cadence">
              <select
                value={draft.shoot_cadence ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, shoot_cadence: (e.target.value || undefined) as ShootCadence | undefined })
                }
                className={inputCls}
              >
                <option value="">(not set)</option>
                {SHOOT_CADENCES.map((c) => (
                  <option key={c} value={c}>
                    {CADENCE_LABELS[c]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Shoots / period">
              <input
                type="number"
                min={0}
                value={draft.shoots_per_period ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, shoots_per_period: e.target.value ? Number(e.target.value) : undefined })
                }
                className={inputCls}
              />
            </Field>
            <Field label="Shoot-day hours">
              <input
                type="number"
                min={0}
                step={0.5}
                value={draft.shoot_day_hours ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, shoot_day_hours: e.target.value ? Number(e.target.value) : undefined })
                }
                className={inputCls}
              />
            </Field>
          </div>
          <Field label="Shared shoot pool with" hint="(optional — counts both clients' shoots against one combined quota)">
            <select
              value={draft.pool_with ?? ""}
              onChange={(e) => setDraft({ ...draft, pool_with: e.target.value || undefined })}
              className={inputCls}
            >
              <option value="">(none — this client only)</option>
              {poolOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {/* Deliverables */}
        <div className="flex flex-col gap-2">
          <SectionLabel>Deliverables</SectionLabel>
          <div className="text-[11px] text-muted-foreground">Contracted outputs — e.g. &ldquo;1 Main Video 30-60s&rdquo;, &ldquo;15-30 Edited Photos&rdquo;</div>
          <DeliverableEditor
            lines={draft.deliverables}
            onChange={(next) => setDraft({ ...draft, deliverables: next })}
            addLabel="Add deliverable"
            placeholder="e.g. Social Reels 20-45s"
          />
        </div>

        {/* Post-production deliverables */}
        <div className="flex flex-col gap-2">
          <SectionLabel>Post-production deliverables</SectionLabel>
          <div className="text-[11px] text-muted-foreground">Editing / repurposing — e.g. &ldquo;3 Reels re-edited&rdquo;, &ldquo;Email design&rdquo;</div>
          <DeliverableEditor
            lines={draft.post_production}
            onChange={(next) => setDraft({ ...draft, post_production: next })}
            addLabel="Add post-production item"
            placeholder="e.g. Repurposed Reel"
          />
        </div>

        {/* Guarantees */}
        <Field label="Guarantees" hint="(per-client)">
          <textarea
            rows={2}
            value={draft.guarantees ?? ""}
            onChange={(e) => setDraft({ ...draft, guarantees: e.target.value || undefined })}
            className={inputCls}
            placeholder="e.g. 1 shoot/mo guaranteed; make-good = 1 edit batch if a shoot is missed"
          />
        </Field>

        {/* Commercials */}
        <div className="flex flex-col gap-2">
          <SectionLabel>Commercials</SectionLabel>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field label="Retainer ($/mo)">
              <input
                type="number"
                min={0}
                step={100}
                value={draft.retainer_amount ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, retainer_amount: e.target.value ? Number(e.target.value) : undefined })
                }
                className={inputCls}
              />
            </Field>
            <Field label="Billing">
              <select
                value={draft.billing_frequency ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, billing_frequency: (e.target.value || undefined) as BillingFrequency | undefined })
                }
                className={inputCls}
              >
                <option value="">(not set)</option>
                {BILLING_FREQUENCIES.map((f) => (
                  <option key={f} value={f}>
                    {BILLING_LABELS[f]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Monthly hours" hint="(Allocation)">
              <input
                type="number"
                min={0}
                step={1}
                value={draft.monthly_hours ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, monthly_hours: e.target.value ? Number(e.target.value) : undefined })
                }
                className={inputCls}
              />
            </Field>
          </div>
        </div>

        {/* Internal notes */}
        <Field label="Internal notes">
          <textarea
            rows={2}
            value={draft.notes ?? ""}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value || undefined })}
            className={inputCls}
            placeholder="Contract caveats, special agreements, extras..."
          />
        </Field>

        {/* Phones: Save / Cancel ride above the tab bar while the form scrolls. */}
        <div className="sticky bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-10 -mx-4 -mb-4 flex items-center justify-end gap-2 rounded-b-2xl border-t border-border bg-panel/95 px-4 py-3 backdrop-blur md:static md:m-0 md:rounded-none md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none [&>button]:h-11 [&>button]:flex-1 [&>button]:justify-center [&>button]:text-[14px] md:[&>button]:h-auto md:[&>button]:flex-none md:[&>button]:text-xs">
          <button
            type="button"
            onClick={cancel}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-panel px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
          >
            <X className="h-3 w-3" />
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={pending || !dirty}
            className="inline-flex items-center gap-1 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Save className="h-3 w-3" />
            {pending ? "Saving…" : "Save scope"}
          </button>
        </div>
      </div>
    </Tile>
  );
}
