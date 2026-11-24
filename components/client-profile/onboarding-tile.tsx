"use client";

// New-client onboarding: is everything set up? Each row is done (with a link
// to where it lives) or a to-do (with a link to where to do it). Hand-checked
// items (nothing else records them) tick in place.

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, ClipboardCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Tile } from "./tile";
import { setOnboardingCheck } from "@/app/(internal)/client/[id]/onboarding-actions";
import type { OnboardingChecklist } from "@/lib/onboarding/checklist";
import { cn } from "@/lib/utils";

export function OnboardingTile({
  brandId,
  checklist,
  collapsed = false,
}: {
  brandId: string;
  checklist: OnboardingChecklist;
  /** Start folded (older clients: there to check, not in the way). */
  collapsed?: boolean;
}) {
  const [open, setOpen] = useState(!collapsed);
  const [local, setLocal] = useState<Record<string, boolean>>({});
  const [pending, start] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const items = checklist.items.map((i) => (i.key in local ? { ...i, done: local[i.key] } : i));
  const done = items.filter((i) => i.done).length;
  const pct = Math.round((done / Math.max(1, items.length)) * 100);

  function toggle(key: string, next: boolean) {
    setBusyKey(key);
    setLocal((cur) => ({ ...cur, [key]: next }));
    start(async () => {
      const r = await setOnboardingCheck(brandId, key, next);
      if (!r.ok) {
        setLocal((cur) => ({ ...cur, [key]: !next }));
        toast.error(r.error ?? "Could not save");
      }
      setBusyKey(null);
    });
  }

  return (
    <Tile id="onboarding" label="Onboarding" icon={<ClipboardCheck />} sublabel={`${done} of ${items.length} set up`} spans={2}>
      <div className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className={cn("h-full rounded-full transition-all duration-500", done === items.length ? "bg-emerald-500" : "bg-accent")}
          style={{ width: `${pct}%` }}
        />
      </div>
      {collapsed ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="mb-2 self-start text-[12px] font-medium text-foreground/70 hover:text-foreground"
        >
          {open ? "Hide checklist" : "Show checklist"}
        </button>
      ) : null}
      {open ? (
      <ul className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
        {items.map((i) => {
          const external = i.href ? /^https?:\/\//.test(i.href) : false;
          const link = i.href ? (
            external ? (
              <a
                href={i.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 whitespace-nowrap text-[12px] font-medium text-foreground/70 hover:text-foreground"
              >
                {i.hrefLabel}
                <ArrowUpRight className="h-3 w-3" />
              </a>
            ) : (
              <Link href={i.href} className="whitespace-nowrap text-[12px] font-medium text-foreground/70 hover:text-foreground">
                {i.hrefLabel}
              </Link>
            )
          ) : null;
          return (
            <li key={i.key} className="flex items-start gap-3 border-b border-border/40 py-2.5 last:border-b-0 md:[&:nth-last-child(2):nth-child(odd)]:border-b-0">
              {i.manual ? (
                <button
                  type="button"
                  onClick={() => toggle(i.key, !i.done)}
                  disabled={pending && busyKey === i.key}
                  aria-label={i.done ? `Untick ${i.label}` : `Tick ${i.label}`}
                  className={cn(
                    "mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border transition-colors",
                    i.done ? "border-emerald-600 bg-emerald-600 text-white" : "border-foreground/30 hover:border-foreground"
                  )}
                >
                  {pending && busyKey === i.key ? <Loader2 className="h-3 w-3 animate-spin" /> : i.done ? <Check className="h-3 w-3" /> : null}
                </button>
              ) : (
                <span
                  className={cn(
                    "mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full",
                    i.done ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" : "border border-dashed border-amber-500/70"
                  )}
                >
                  {i.done ? <Check className="h-3 w-3" /> : null}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className={cn("text-[13px] font-medium", i.done ? "text-foreground/60" : "text-foreground")}>{i.label}</span>
                  {link}
                </div>
                {i.parts?.length ? (
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                    {i.parts.map((p) => (
                      <span key={p.label} className={cn("inline-flex items-center gap-1 text-[11.5px]", p.done ? "text-foreground/60" : "text-muted-foreground")}>
                        {p.done ? <Check className="h-3 w-3 text-emerald-600" /> : <span className="h-2.5 w-2.5 rounded-full border border-dashed border-amber-500/70" />}
                        {p.label}
                      </span>
                    ))}
                  </div>
                ) : null}
                {i.hint && !i.done ? <div className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{i.hint}</div> : null}
                {i.hint && i.done && i.key === "am" ? <div className="mt-0.5 text-[11.5px] text-muted-foreground">{i.hint}</div> : null}
              </div>
            </li>
          );
        })}
      </ul>
      ) : null}
    </Tile>
  );
}
