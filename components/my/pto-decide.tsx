"use client";

// Approve / Decline buttons for a time-off request, used on the To-dos card
// and the Time off page. Decline asks once more before it goes.

import { useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function PtoDecide({ itemId, onDone, compact }: { itemId: string; onDone?: (status: "Approved" | "Rejected") => void; compact?: boolean }) {
  const [state, setState] = useState<"idle" | "confirm-decline" | "saving" | "Approved" | "Rejected">("idle");
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "approve" | "decline") {
    setState("saving");
    setError(null);
    try {
      const res = await fetch("/api/my/pto/decide", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId, decision }) });
      const json = (await res.json().catch(() => null)) as { status?: "Approved" | "Rejected"; error?: string } | null;
      if (!res.ok || !json?.status) {
        setError(json?.error ?? "That did not save on Monday. Try again.");
        setState("idle");
        return;
      }
      setState(json.status);
      onDone?.(json.status);
    } catch {
      setError("Could not reach the server.");
      setState("idle");
    }
  }

  if (state === "Approved" || state === "Rejected") {
    return (
      <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10.5px] font-semibold", state === "Approved" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800")}>
        {state === "Approved" ? "Approved" : "Declined"}
      </span>
    );
  }

  const btn = cn("inline-flex items-center gap-1 rounded-md border font-semibold transition-colors disabled:opacity-50", compact ? "px-2 py-1 text-[11.5px]" : "px-2.5 py-1.5 text-[12px]");
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <span className="inline-flex items-center gap-1.5">
        {state === "confirm-decline" ? (
          <>
            <button type="button" onClick={() => void decide("decline")} className={cn(btn, "border-red-300 bg-red-50 text-red-800 hover:bg-red-100")}>
              Yes, decline
            </button>
            <button type="button" onClick={() => setState("idle")} className={cn(btn, "border-border bg-panel text-foreground hover:bg-secondary")}>
              Keep
            </button>
          </>
        ) : (
          <>
            <button type="button" disabled={state === "saving"} onClick={() => void decide("approve")} className={cn(btn, "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700")}>
              {state === "saving" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              Approve
            </button>
            <button type="button" disabled={state === "saving"} onClick={() => setState("confirm-decline")} className={cn(btn, "border-border bg-panel text-foreground hover:bg-secondary")}>
              <X className="h-3 w-3" />
              Decline
            </button>
          </>
        )}
      </span>
      {error ? <span className="text-[11px] text-red-700">{error}</span> : null}
    </span>
  );
}
