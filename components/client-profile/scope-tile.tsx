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

import { useState, useTransition } from "react";
import { BarChart3, ChevronDown, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { Tile, TileEmpty } from "./tile";
import { saveBrandScope } from "@/app/(internal)/client/[id]/scope-actions";
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
  type ServiceType,
  type ShootCadence,
} from "@/lib/scope/types";
import {
  contractBalance,
  contractHealth,
  contractPace,
  contractPeriods,
  kindCountsInContract,
  periodHealth,
  type ContractBalance,
  type ContractPeriod,
  type DatedProject,
} from "@/lib/scope/pace";

function daysUntil(iso: string | undefined): number | null {
  if (!iso) return null;
  const then = new Date(iso + "T12:00:00").getTime();
  if (isNaN(then)) return null;
  return Math.round((then - Date.now()) / 86400000);
}

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

// ── Shoot log helpers ─────────────────────────────────────────────────────────
function shortDate(iso: string): string {
  const d = new Date(iso.length <= 10 ? iso + "T12:00:00" : iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
              title={`${per.label}: ${done} of ${per.owed}${booked ? `, ${booked} booked` : ""}${madeUp ? `, ${madeUp} made up later` : ""}`}
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
        <span className="inline-flex items-center gap-1">
          <span className="block h-2 w-2.5 rounded-[2px] border border-border" />
          Still to come
        </span>
        {shown.length < periods.length ? <span>· showing {shown.length} of {periods.length} periods</span> : null}
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
  mtdChannelCounts,
  datedProjects = [],
  pool = null,
  poolOptions = [],
}: {
  brandId: string;
  initialScope: BrandScope | null;
  mtdChannelCounts: Record<string, { inFeed: number; stories: number }>;
  // Every dated project for this client from the Monday All Projects board,
  // classified by Project Type (and including the pool partner's when linked).
  datedProjects?: DatedProject[];
  // Set when this scope shares a shoot pool with another client.
  pool?: { name: string; partnerRate: number | null } | null;
  // Other clients, for the "Shared shoot pool with" picker.
  poolOptions?: { id: string; name: string }[];
}) {
  const [editing, setEditing] = useState(false);
  const [scope, setScope] = useState<BrandScope>(initialScope ?? {});
  const [draft, setDraft] = useState<BrandScope>(scope);
  const [pending, startTransition] = useTransition();
  const [showLog, setShowLog] = useState(false);

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
        setScope(clean);
        setDraft(clean);
        setEditing(false);
      }
    });
  }

  function cancel() {
    setDraft(scope);
    setEditing(false);
  }

  // ── Readout mode ────────────────────────────────────────────────────────────
  if (!editing) {
    const daysToRenewal = daysUntil(scope.renewal_date);
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

    // Shoots = Monday projects typed "Professional Content Shoot". With a
    // shared pool, both clients' shoots count against the combined quota.
    const ownRate = scope.shoots_per_period ?? 1;
    const quota = pool ? ownRate + (pool.partnerRate ?? ownRate) : ownRate;
    const paceScope: BrandScope = pool ? { ...scope, shoots_per_period: quota } : scope;
    const shootDates = datedProjects.filter((p) => p.kind === "shoot").map((p) => p.date);
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const shootsThisPeriod = shootDates.filter((iso) => {
      const d = new Date(iso);
      return !isNaN(d.getTime()) && d >= monthStart && d <= new Date();
    }).length;
    const kinds = kindCountsInContract(scope, datedProjects);
    const extras = kinds
      ? [
          kinds.micro ? `${kinds.micro} micro shoot${kinds.micro === 1 ? "" : "s"}` : null,
          kinds.edit ? `${kinds.edit} edit request${kinds.edit === 1 ? "" : "s"}` : null,
          kinds.other
            ? `${kinds.other} other dated project${kinds.other === 1 ? "" : "s"} (other project types, not counted)`
            : null,
        ].filter(Boolean)
      : [];

    // Macro view: shoots owed vs done since the contract started.
    const pace = contractPace(paceScope, shootDates);
    // The whole term, one entry per contract period (past, current, and the
    // ones still to come when the contract has an end date).
    const timeline = contractPeriods(paceScope, datedProjects, new Date(), { includeFuture: true }) ?? [];
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

    // Last / next shoot inside this contract, and what it takes to finish.
    const flatShoots = timeline.flatMap((per) => per.shoots);
    const lastShoot = flatShoots.length ? flatShoots[flatShoots.length - 1] : null;
    const nextShoot = timeline.flatMap((per) => per.scheduled)[0] ?? null;
    const currentPeriod = periods.find((per) => per.inProgress) ?? null;
    const daysSinceLast = lastShoot ? Math.max(0, -(daysUntil(lastShoot.date.slice(0, 10)) ?? 0)) : null;
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
    const contractReason = !pace || !health
      ? null
      : (health.reason ??
        balanceNote ??
        `${pace.done}${pace.total != null ? ` of ${pace.total}` : ""} shoots done${
          pace.expectedToDate > 0 ? `, ${pace.expectedToDate} were due by the end of ${lastClosed ? lastClosed.short : `last ${unit}`}` : ""
        }.`);
    const lights = [
      monthHealth ? { scope: `This ${unit}`, ...monthHealth } : null,
      health ? { scope: "Full contract", level: health.level, label: health.label, reason: contractReason ?? undefined } : null,
    ].filter((x): x is { scope: string; level: "green" | "yellow" | "red"; label: string; reason: string | undefined } => !!x);

    return (
      <Tile label="Scope & contract health" icon={<BarChart3 className="h-3.5 w-3.5" />} spans={2}>
        <div className="flex flex-col gap-3">
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
            <TileEmpty>
              No scope set yet — click Edit to capture services, term, production,
              deliverables and renewal dates.
            </TileEmpty>
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
                  {timeline.length ? <ContractCalendar periods={timeline} balance={balance} /> : null}
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                    <span>
                      <span className="text-[13px] font-semibold tabular-nums text-foreground">{pace.done}</span>
                      {pace.total != null ? ` of ${pace.total}` : ""} shoots done
                      {" · "}
                      {pace.expectedToDate > 0 ? (
                        <>
                          <span className="font-medium tabular-nums text-foreground">{pace.expectedToDate}</span> due by the end of{" "}
                          {lastClosed ? lastClosed.short : `last ${pace.unitLabel.toLowerCase()}`}
                        </>
                      ) : (
                        <>nothing due until this {pace.unitLabel.toLowerCase()} ends</>
                      )}
                    </span>
                    <span>
                      {pace.unitLabel} {pace.periodIndex}
                      {pace.periodCount ? ` of ${pace.periodCount}` : ""}
                    </span>
                  </div>
                  {/* What's next */}
                  <dl className="flex flex-col gap-1 border-t border-border pt-2 text-[11px]">
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
                    {remaining != null ? (
                      <div className="flex items-baseline justify-between gap-3">
                        <dt className="flex-shrink-0 text-muted-foreground">To finish on time</dt>
                        <dd className="min-w-0 text-right text-foreground">
                          {remaining === 0 ? (
                            "All shoots done"
                          ) : (
                            <>
                              {remaining} left
                              {perPeriod != null ? (
                                <span className="text-muted-foreground">
                                  {" · "}
                                  {Number.isInteger(perPeriod) ? perPeriod : `about ${perPeriod.toFixed(1)}`} a {unit} for{" "}
                                  {periodsLeft} {unit}
                                  {periodsLeft === 1 ? "" : "s"}
                                </span>
                              ) : null}
                            </>
                          )}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                  {extras.length ? (
                    <div className="text-[11px] text-muted-foreground">Also since the start: {extras.join(" · ")}</div>
                  ) : null}
                  {periods.length ? (
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => setShowLog((v) => !v)}
                        className="tap-target inline-flex w-fit items-center py-1 text-[12px] font-medium text-foreground underline underline-offset-2 md:py-0 md:text-[11px]"
                      >
                        {showLog ? "Hide shoot log" : `View shoot log (${pace.done} shoot${pace.done === 1 ? "" : "s"})`}
                      </button>
                      {showLog ? (
                        <div className="divide-y divide-border rounded-md border border-border bg-panel">
                          {periods.map((per) => {
                            const short = per.shoots.length < per.owed;
                            const bal = balance.byIndex[per.index];
                            const covered = short && !per.inProgress && !!bal && bal.missed === 0;
                            const tone = !short || covered
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
                                    {per.shoots.length} / {per.owed}
                                    {covered && bal ? <span className="font-normal"> · made up in {names(bal.coveredBy)}</span> : null}
                                  </span>
                                </div>
                                {per.shoots.length === 0 ? (
                                  <div className="text-[11px] italic text-muted-foreground">No shoots</div>
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
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {(scope.channels ?? []).map((ch) => {
                const counts = mtdChannelCounts[ch.name] ?? { inFeed: 0, stories: 0 };
                if (ch.inFeed == null && ch.stories == null) return null;
                return (
                  <div key={ch.name} className="flex flex-col gap-1">
                    <div className="text-[11px] font-medium text-foreground">{ch.name}</div>
                    {ch.inFeed != null ? <Meter label="In-Feed MTD" done={counts.inFeed} quota={ch.inFeed} /> : null}
                    {ch.stories != null ? <Meter label="Stories MTD" done={counts.stories} quota={ch.stories} /> : null}
                  </div>
                );
              })}
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
