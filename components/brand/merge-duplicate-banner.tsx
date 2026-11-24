"use client";

// Shown on an intake that looks like a client we already have: one click
// folds it into that client (see mergeIntakeInto). Two-step so it is never
// a misclick.

import { useState, useTransition } from "react";
import { GitMerge, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { mergeIntakeInto } from "@/app/(internal)/brand/[id]/actions";
import type { BrandCandidate } from "@/lib/brands/duplicates";

export function MergeDuplicateBanner({ intakeId, candidates }: { intakeId: string; candidates: BrandCandidate[] }) {
  const [armed, setArmed] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!candidates.length) return null;

  function merge(targetId: string) {
    if (armed !== targetId) {
      setArmed(targetId);
      return;
    }
    start(async () => {
      const res = await mergeIntakeInto(intakeId, targetId);
      if (res && !res.ok) toast.error(res.error);
    });
  }

  return (
    <div className="mb-6 rounded-xl border border-amber-300/70 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-100">
      <div className="font-semibold">This looks like a client we already have.</div>
      <p className="mt-0.5 text-[13px] opacity-80">
        Merge this intake into it: its brand details fill in whatever the client record is missing, the logos move over, and this copy goes away.
      </p>
      <div className="mt-3 flex flex-col gap-2">
        {candidates.slice(0, 3).map((c) => (
          <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/70 px-3 py-2 dark:bg-black/20">
            <div className="min-w-0">
              <div className="truncate font-medium">{c.business_name}</div>
              <div className="text-xs opacity-70">
                {[c.status, c.engagement_type, c.account_manager ? `AM ${c.account_manager}` : null].filter(Boolean).join(" · ")}
              </div>
            </div>
            <button
              type="button"
              onClick={() => merge(c.id)}
              disabled={pending}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition ${
                armed === c.id ? "bg-amber-600 text-white hover:bg-amber-700" : "border border-amber-400 bg-white text-amber-900 hover:bg-amber-100 dark:bg-transparent dark:text-amber-100"
              }`}
            >
              {pending && armed === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitMerge className="h-3.5 w-3.5" />}
              {armed === c.id ? "Confirm merge" : "Merge into this client"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
