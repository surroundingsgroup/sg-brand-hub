"use client";

// Allocation editor — the sweet planning surface.
//
// Hero (what month we're planning, due, status, delta vs. template)
// + a lines table (task / role / owner / hours / notes) + a totals
// bar + save/submit actions.
//
// Submit → status "submitted" + submitted_at.
// Save draft → status "draft", stays editable.
// Everything is one POST to /api/brand/[id]/allocation.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  Check,
  Plus,
  Trash2,
  Calendar,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { toast } from "sonner";
import { money, rateMath, rateTone } from "@/lib/allocations/rate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  daysUntilDue,
  dueDateLabel,
  periodLabel,
  periodShort,
} from "@/lib/allocations/period";
import {
  ALLOCATION_ROLES,
  type AllocationRole,
  normalizeRole,
} from "@/lib/allocations/roles";

export type AllocationLine = {
  id: string | null;
  task: string;
  role: string | null;
  owner: string | null;
  hours: number;
  notes: string | null;
};

type RecentMonth = {
  year: number;
  month: number;
  status: string;
  total_hours: number;
};

export function AllocationEditor({
  brandId,
  brandName,
  year,
  month,
  initialLines,
  initialNotes,
  initialStatus,
  submittedAt,
  templateTotal,
  templateFound,
  startedFrom = null,
  recentMonths,
  teamMembers,
  monthly = null,
  targetRate = 150,
}: {
  brandId: string;
  brandName: string;
  year: number;
  month: number;
  initialLines: AllocationLine[];
  initialNotes: string;
  initialStatus: "draft" | "submitted";
  submittedAt: string | null;
  templateTotal: number;
  templateFound: boolean;
  /** "Copied from Oct 2026" / "Standard starting rows": what a new month was pre-filled from. */
  startedFrom?: string | null;
  recentMonths: RecentMonth[];
  teamMembers: string[];
  /** What the client pays a month, and the company's target rate, for the two rate numbers. */
  monthly?: number | null;
  targetRate?: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [lines, setLines] = useState<AllocationLine[]>(initialLines);
  const [notes, setNotes] = useState(initialNotes);
  const [status, setStatus] = useState<"draft" | "submitted">(initialStatus);
  const [savingDraft, setSavingDraft] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const total = useMemo(
    () => lines.reduce((sum, l) => sum + (Number(l.hours) || 0), 0),
    [lines]
  );
  const delta = total - templateTotal;
  // Real rate and what these hours should bill at the target, live as hours change.
  const math = rateMath(monthly, total, targetRate);
  const rate = rateTone(math.realRate, targetRate);

  const period = { year, month };
  const daysToDue = daysUntilDue(period);
  const dueLabel = dueDateLabel(period);

  function updateLine(i: number, patch: Partial<AllocationLine>) {
    setLines((cur) => cur.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function removeLine(i: number) {
    setLines((cur) => cur.filter((_, idx) => idx !== i));
  }
  function addLine() {
    setLines((cur) => [
      ...cur,
      { id: null, task: "", role: null, owner: null, hours: 0, notes: null },
    ]);
  }

  async function save(nextStatus: "draft" | "submitted") {
    if (nextStatus === "submitted") setSubmitting(true);
    else setSavingDraft(true);
    try {
      const res = await fetch(`/api/brand/${brandId}/allocation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year,
          month,
          status: nextStatus,
          notes,
          lines: lines.map((l, idx) => ({
            task: l.task,
            role: l.role,
            owner: l.owner,
            hours: l.hours,
            notes: l.notes,
            sort_order: idx,
          })),
        }),
      });
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({ error: "Save failed." }))) as {
          error?: string;
        };
        toast.error(error ?? "Couldn't save allocation.");
        return;
      }
      setStatus(nextStatus);
      toast.success(
        nextStatus === "submitted"
          ? `${periodShort(period)} allocation submitted.`
          : "Draft saved."
      );
      if (nextStatus === "submitted") {
        startTransition(() => router.push(`/client/${brandId}`));
      }
    } catch {
      toast.error("Network error — try again.");
    } finally {
      setSavingDraft(false);
      setSubmitting(false);
    }
  }

  const statusBadge =
    status === "submitted" ? (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-medium text-emerald-900">
        <Check className="h-3 w-3" />
        Submitted
        {submittedAt
          ? ` · ${new Date(submittedAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}`
          : ""}
      </span>
    ) : daysToDue < 0 ? (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-100 px-2.5 py-0.5 text-[11px] font-medium text-rose-900">
        Overdue · {Math.abs(daysToDue)}d
      </span>
    ) : daysToDue === 0 ? (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-medium text-amber-900">
        Due today
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-medium text-foreground/80">
        <Calendar className="h-3 w-3" />
        Due {dueLabel} · {daysToDue}d
      </span>
    );

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      {/* Hero */}
      <div className="mb-8">
        <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Allocation · {periodLabel(period)}
        </div>
        <h1 className="mt-1.5 text-3xl font-semibold tracking-tight text-foreground md:text-[2.25rem]">
          {brandName}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-3">{statusBadge}</div>
      </div>

      {/* At-a-glance tiles: planned, template, delta, 3 recent */}
      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Planned" value={`${total.toFixed(1)}h`} emphasis />
        <StatTile
          label="Template"
          value={templateFound ? `${templateTotal.toFixed(1)}h` : "—"}
          sub={startedFrom ?? (templateFound ? "Monday setup" : "No template")}
        />
        <StatTile
          label="Delta"
          value={
            templateFound
              ? `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}h`
              : "—"
          }
          tone={
            !templateFound
              ? "muted"
              : Math.abs(delta) < 0.5
                ? "muted"
                : delta > 0
                  ? "warn"
                  : "ok"
          }
          icon={
            templateFound
              ? delta > 0.5
                ? <TrendingUp className="h-3 w-3" />
                : delta < -0.5
                  ? <TrendingDown className="h-3 w-3" />
                  : null
              : null
          }
        />
        <StatTile
          label="Last 3 months"
          value={
            recentMonths.length === 0
              ? "—"
              : (
                  recentMonths.reduce((s, m) => s + Number(m.total_hours), 0) /
                  recentMonths.length
                ).toFixed(1) + "h"
          }
          sub={
            recentMonths.length === 0
              ? "First submission"
              : recentMonths
                  .map((m) => `${periodShort({ year: m.year, month: m.month }).split(" ")[0]} ${Number(m.total_hours).toFixed(0)}h`)
                  .join(" · ")
          }
        />
      </div>

      {/* What these hours are worth: the real rate, and what they should bill at the target */}
      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="They pay a month" value={math.monthly != null ? money(math.monthly) : "—"} sub={math.monthly != null ? undefined : "Add it under Scope, Commercials"} />
        <StatTile
          label="Real effective rate"
          value={math.realRate != null ? `$${math.realRate.toFixed(2)}` : "—"}
          sub={math.realRate != null ? "an hour, at the hours planned" : math.monthly != null ? "Add hours to see it" : undefined}
          tone={rate === "good" ? "ok" : rate === "watch" || rate === "low" ? "warn" : "muted"}
        />
        <StatTile
          label={`Should bill at $${targetRate} an hour`}
          value={math.atTarget != null ? money(math.atTarget) : "—"}
          sub={
            math.gap == null
              ? undefined
              : math.gap < 0
                ? `${money(-math.gap)} more than they pay`
                : math.gap > 0
                  ? `${money(math.gap)} less than they pay`
                  : "the same as they pay"
          }
          tone={math.gap != null && math.gap < 0 ? "warn" : "default"}
        />
        <StatTile
          label="Hours the amount buys"
          value={math.budgetHours != null ? `${math.budgetHours.toFixed(1)}h` : "—"}
          sub={math.budgetHours != null ? `at $${targetRate} an hour` : undefined}
        />
      </div>

      {/* Lines table */}
      <div className="rounded-xl border border-border/70 bg-panel">
        <div className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-3">
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Lines
          </div>
          <button
            type="button"
            onClick={addLine}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <Plus className="h-3 w-3" />
            Add row
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border/60 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                <th className="px-4 py-2.5 text-left">Task</th>
                <th className="px-3 py-2.5 text-left">Role</th>
                <th className="px-3 py-2.5 text-left">Owner</th>
                <th className="px-3 py-2.5 text-right">Hours</th>
                <th className="px-3 py-2.5 text-left">Notes</th>
                <th className="px-3 py-2.5 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-[12px] italic text-muted-foreground">
                    No lines yet. {templateFound ? "Add some, or" : ""} <button type="button" onClick={addLine} className="underline underline-offset-4 hover:text-foreground">add a row</button> to start.
                  </td>
                </tr>
              ) : (
                lines.map((l, i) => {
                  const roleValue = normalizeRole(l.role) ?? "";
                  // If the saved owner isn't in the Monday roster
                  // (manual override from an earlier free-text save),
                  // surface it at the bottom of the list so it stays
                  // selectable without silently dropping.
                  const ownerOptions =
                    l.owner && !teamMembers.includes(l.owner)
                      ? [...teamMembers, l.owner]
                      : teamMembers;
                  return (
                    <tr key={i} className="border-b border-border/40 last:border-b-0 hover:bg-secondary/20">
                      <td className="px-4 py-2 align-top">
                        <Input
                          value={l.task}
                          onChange={(e) => updateLine(i, { task: e.target.value })}
                          placeholder="e.g. Client Communication / Meetings"
                          className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                        />
                      </td>
                      <td className="px-3 py-2 align-top">
                        <Select
                          value={roleValue}
                          onValueChange={(v) =>
                            updateLine(i, { role: (v as AllocationRole) || null })
                          }
                        >
                          <SelectTrigger className="h-8 w-[112px] border-0 bg-transparent px-0 shadow-none focus:ring-0">
                            <SelectValue placeholder="Role" />
                          </SelectTrigger>
                          <SelectContent>
                            {ALLOCATION_ROLES.map((r) => (
                              <SelectItem key={r} value={r}>
                                {r}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-3 py-2 align-top">
                        {teamMembers.length === 0 ? (
                          <Input
                            value={l.owner ?? ""}
                            onChange={(e) => updateLine(i, { owner: e.target.value || null })}
                            placeholder="Person"
                            className="h-8 w-32 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                          />
                        ) : (
                          <Select
                            value={l.owner ?? ""}
                            onValueChange={(v) =>
                              updateLine(i, { owner: v || null })
                            }
                          >
                            <SelectTrigger className="h-8 w-[160px] border-0 bg-transparent px-0 shadow-none focus:ring-0">
                              <SelectValue placeholder="Owner" />
                            </SelectTrigger>
                            <SelectContent>
                              {ownerOptions.map((name) => (
                                <SelectItem key={name} value={name}>
                                  {name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top text-right">
                        <Input
                          type="number"
                          inputMode="decimal"
                          step="0.25"
                          min="0"
                          value={l.hours}
                          onChange={(e) =>
                            updateLine(i, { hours: Number(e.target.value) || 0 })
                          }
                          className="h-8 w-20 border-0 bg-transparent px-0 text-right tabular-nums shadow-none focus-visible:ring-0"
                        />
                      </td>
                      <td className="px-3 py-2 align-top">
                        <Input
                          value={l.notes ?? ""}
                          onChange={(e) => updateLine(i, { notes: e.target.value || null })}
                          placeholder="Optional"
                          className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                        />
                      </td>
                      <td className="px-3 py-2 align-top">
                        <button
                          type="button"
                          onClick={() => removeLine(i)}
                          className="text-muted-foreground transition-colors hover:text-rose-600"
                          aria-label="Remove row"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            <tfoot>
              <tr className="bg-secondary/30">
                <td colSpan={3} className="px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Total
                </td>
                <td className="px-3 py-2.5 text-right text-[14px] font-semibold tabular-nums text-foreground">
                  {total.toFixed(1)}h
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Notes */}
      <div className="mt-6">
        <label className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Notes for this month
        </label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional — context the ops team should know (extra shoot day, travel, etc.)"
          rows={3}
          className="mt-2 bg-panel text-[13px] leading-relaxed"
        />
      </div>

      {/* Actions */}
      <div className="mt-6 border-t border-border/60 pt-6">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            onClick={() => save("submitted")}
            disabled={submitting || savingDraft || isPending || lines.length === 0}
            className="gap-1.5"
          >
            {submitting || isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            {status === "submitted"
              ? "Re-submit"
              : `Submit ${periodShort(period).split(" ")[0]}`}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => save("draft")}
            disabled={submitting || savingDraft}
          >
            {savingDraft ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : null}
            Save draft
          </Button>
        </div>
        {/* What happens on Submit — clearly spelled out so the AM
            isn't guessing. */}
        <div className="mt-4 rounded-md border border-border/70 bg-secondary/30 p-3.5">
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {status === "submitted" ? "You've already submitted" : "What happens on Submit"}
          </div>
          <ul className="mt-1.5 space-y-0.5 text-[12px] text-foreground/85">
            {status === "submitted" ? (
              <>
                <li>• Submitted on {submittedAt ? new Date(submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}.</li>
                <li>• Your changes above will re-submit with a fresh timestamp when you hit <strong>Re-submit</strong>.</li>
              </>
            ) : (
              <>
                <li>• Status flips to <strong>Submitted</strong> and the current time is stamped on it.</li>
                <li>• Operations sees your plan on their dashboard (not just a draft).</li>
                <li>• Shows as <strong>Submitted ✓</strong> on this client&apos;s profile with the total hours.</li>
                <li>• <em>Not yet:</em> mirror to the Monday Allocation board. Wiring that next pass once the shape is validated.</li>
              </>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  sub,
  tone = "default",
  emphasis = false,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "warn" | "ok" | "muted";
  emphasis?: boolean;
  icon?: React.ReactNode;
}) {
  const valueClass =
    tone === "warn"
      ? "text-amber-700"
      : tone === "ok"
        ? "text-emerald-700"
        : tone === "muted"
          ? "text-muted-foreground"
          : "text-foreground";
  return (
    <div className="rounded-xl border border-border/70 bg-panel p-4">
      <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 flex items-baseline gap-1 ${emphasis ? "text-3xl" : "text-xl"} font-semibold tabular-nums ${valueClass}`}>
        {icon ? <span className="mb-0.5">{icon}</span> : null}
        {value}
      </div>
      {sub ? (
        <div className="mt-1 truncate text-[10.5px] text-muted-foreground">
          {sub}
        </div>
      ) : null}
    </div>
  );
}
