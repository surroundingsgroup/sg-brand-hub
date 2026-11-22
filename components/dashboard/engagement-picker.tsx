"use client";

// Inline engagement-type picker for a brand card. Stops navigation when
// the trigger is clicked (the surrounding card is a Link), opens a
// popover with Retainer / Project / Inactive, writes via the existing
// updateBrand server action.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { updateBrand } from "@/app/(internal)/brand/[id]/actions";
import { ENGAGEMENT_LABELS, type EngagementType } from "@/types/brand";

const OPTIONS: EngagementType[] = ["prospect", "retainer", "project", "inactive"];

export function EngagementPicker({
  brandId,
  current,
}: {
  brandId: string;
  current: EngagementType | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const label = current ? ENGAGEMENT_LABELS[current] : "Set engagement";

  // Keep the trigger from navigating when it's inside a Link card.
  function onTriggerClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setOpen((v) => !v);
  }

  async function pick(next: EngagementType) {
    if (next === current) {
      setOpen(false);
      return;
    }
    setSaving(true);
    try {
      const res = await updateBrand(brandId, { engagement_type: next });
      if (res && res.ok === false) throw new Error(res.error);
      toast.success(`Set to ${ENGAGEMENT_LABELS[next]}.`);
      setOpen(false);
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error((e as Error).message || "Couldn't update.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={onTriggerClick}
          className={`tap-target inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider transition-colors ${
            current === "retainer"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
              : current === "project"
                ? "border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100"
                : current === "prospect"
                  ? "border-violet-200 bg-violet-50 text-violet-800 hover:bg-violet-100"
                : current === "inactive"
                  ? "border-border bg-secondary text-muted-foreground hover:bg-secondary/80"
                  : "border-dashed border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
          }`}
          title="Change engagement"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          {label}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-52 p-1"
        onClick={(e) => e.stopPropagation()}
      >
        <ul className="flex flex-col">
          {OPTIONS.map((opt) => (
            <li key={opt}>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  pick(opt);
                }}
                className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-[14px] text-foreground transition-colors hover:bg-secondary md:min-h-0 md:text-[12.5px]"
              >
                {ENGAGEMENT_LABELS[opt]}
                {opt === current ? <Check className="h-3.5 w-3.5 text-foreground/60" /> : null}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
