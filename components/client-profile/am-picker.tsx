"use client";

// Inline Account Manager picker for the client hero. Same pattern as the
// EngagementPicker: a small trigger that opens a popover and writes through
// the existing updateBrand server action (which also keeps the Brief tool's
// legacy `am` column mirrored).
//
// Options come from the Monday "Account Managers" team. A current AM who
// isn't on that team is still listed so opening the picker never hides or
// drops the value already on the record.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { updateBrand } from "@/app/(internal)/brand/[id]/actions";

export function AmPicker({
  brandId,
  current,
  options,
}: {
  brandId: string;
  current: string | null;
  options: string[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const cur = current?.trim() || "";
  const names = [...options];
  if (cur && !names.some((n) => n.toLowerCase() === cur.toLowerCase())) names.push(cur);
  names.sort((a, b) => a.localeCompare(b));

  async function pick(next: string) {
    if (next === cur) {
      setOpen(false);
      return;
    }
    setSaving(true);
    try {
      const res = await updateBrand(brandId, { account_manager: next || null });
      if (res && res.ok === false) throw new Error(res.error);
      toast.success(next ? `AM set to ${next}.` : "AM cleared.");
      setOpen(false);
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error((e as Error).message || "Couldn't update the AM.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`tap-target inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] transition-colors hover:bg-secondary md:px-2 md:py-0.5 ${
            cur ? "border-border text-foreground" : "border-dashed border-amber-300 bg-amber-50 text-amber-800"
          }`}
          title="Change account manager"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          {cur ? (
            <span>
              AM&nbsp;·&nbsp;<span className="font-medium">{cur}</span>
            </span>
          ) : (
            <span>Assign AM</span>
          )}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-72 w-56 overflow-y-auto p-1">
        <ul className="flex flex-col">
          {names.map((name) => (
            <li key={name}>
              <button
                type="button"
                onClick={() => pick(name)}
                className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-[14px] text-foreground transition-colors hover:bg-secondary md:min-h-0 md:text-[12.5px]"
              >
                {name}
                {name === cur ? <Check className="h-3.5 w-3.5 text-foreground/60" /> : null}
              </button>
            </li>
          ))}
          {cur ? (
            <li className="mt-1 border-t border-border pt-1">
              <button
                type="button"
                onClick={() => pick("")}
                className="flex min-h-[44px] w-full items-center rounded-md px-2.5 py-1.5 text-left text-[14px] text-muted-foreground transition-colors hover:bg-secondary md:min-h-0 md:text-[12.5px]"
              >
                Unassign
              </button>
            </li>
          ) : null}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
