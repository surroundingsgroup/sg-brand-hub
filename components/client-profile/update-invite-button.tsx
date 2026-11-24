"use client";

// "Update invite" on a shoot: re-sends the calendar invite with the current
// creators, date and details (via the Brief tool). Emphasized when the invite
// no longer matches the shoot, e.g. right after the creators changed.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Check, Loader2 } from "lucide-react";

export function UpdateInviteButton({
  briefId,
  emphasize = false,
  compact = false,
}: {
  briefId: string;
  emphasize?: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [error, setError] = useState("");

  async function send(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (state === "sending") return;
    setState("sending");
    setError("");
    try {
      const res = await fetch("/api/briefs/update-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief_id: briefId }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || "Could not update the invite");
      setState("done");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setState("error");
    }
  }

  const label =
    state === "sending" ? "Updating..." : state === "done" ? "Invite updated" : state === "error" ? "Try again" : "Update invite";
  const icon =
    state === "sending" ? (
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
    ) : state === "done" ? (
      <Check className="h-3.5 w-3.5" />
    ) : (
      <CalendarClock className="h-3.5 w-3.5" />
    );
  const tone =
    state === "done"
      ? "border-emerald-600/30 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
      : emphasize || state === "error"
        ? "border-amber-500/60 bg-amber-100 text-amber-900 hover:bg-amber-200 dark:bg-amber-950/50 dark:text-amber-200"
        : "border-foreground/25 bg-panel text-foreground hover:border-foreground hover:bg-foreground hover:text-background";

  return (
    <button
      type="button"
      onClick={send}
      disabled={state === "sending" || state === "done"}
      title={error || "Re-send the calendar invite with the current creators, date and details. Everyone on it gets the update."}
      className={`tap-target inline-flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border font-semibold transition-colors disabled:cursor-default ${
        compact ? "px-2 py-0.5 text-[11px]" : "px-3 py-1.5 text-[12px]"
      } ${tone}`}
    >
      {icon}
      {label}
    </button>
  );
}
