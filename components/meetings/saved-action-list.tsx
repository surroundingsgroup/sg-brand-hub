"use client";

// Action items on a saved meeting, as a checklist: tap the circle to check one
// off (its To-do in My Surroundings follows), × to clear it (with Undo). Done
// items stay in place, struck through, with their tools folded away.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, CalendarClock, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { ActionTool, type ActionToolItem } from "./action-tool";

export type SavedItem = ActionToolItem & {
  owner?: string | null;
  due?: string | null;
  done?: boolean;
};

// "2026-11-25" -> "Wed, Nov 25"; loose wording stays as written.
function dueLabel(due: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return due;
  return new Date(`${due}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function SavedActionList({
  items: initial,
  side,
  brandId,
  meetingId,
  emptyLabel,
  numbered = false,
  tool,
}: {
  items: SavedItem[];
  side: "us" | "them";
  brandId: string;
  meetingId: string;
  emptyLabel: string;
  numbered?: boolean;
  /** Show each open item's next-step tool (ours). */
  tool?: { brandName: string; pocEmail: string | null };
}) {
  const router = useRouter();
  const [items, setItems] = useState<SavedItem[]>(initial);
  const [busy, setBusy] = useState<string | null>(null);

  async function send(action: "done" | "undone" | "clear" | "restore", item: SavedItem, index: number): Promise<boolean> {
    setBusy(item.task);
    try {
      const res = await fetch(`/api/brand/${brandId}/meeting-notes/${meetingId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ side, index, task: item.task, action, item }),
      });
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(error ?? "Couldn't update that item.");
        return false;
      }
      router.refresh();
      return true;
    } catch {
      toast.error("Network error. Try again.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function toggle(i: number) {
    const it = items[i];
    const done = !it.done;
    setItems((list) => list.map((x, j) => (j === i ? { ...x, done } : x)));
    const ok = await send(done ? "done" : "undone", it, i);
    if (!ok) setItems((list) => list.map((x, j) => (j === i ? { ...x, done: !done } : x)));
  }

  async function clear(i: number) {
    const it = items[i];
    setItems((list) => list.filter((_, j) => j !== i));
    const ok = await send("clear", it, i);
    if (!ok) {
      setItems((list) => [...list.slice(0, i), it, ...list.slice(i)]);
      return;
    }
    toast("Cleared", {
      description: it.task,
      action: {
        label: "Undo",
        onClick: async () => {
          setItems((list) => [...list.slice(0, i), { ...it, done: false }, ...list.slice(i)]);
          await send("restore", { ...it, done: false }, i);
        },
      },
    });
  }

  if (!items.length) return <p className="text-[12px] italic text-muted-foreground">{emptyLabel}</p>;

  const doneCount = items.filter((x) => x.done).length;
  const now = new Date().toISOString();
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2.5">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-foreground transition-all duration-500" style={{ width: `${(doneCount / items.length) * 100}%` }} />
        </div>
        <span className="text-[10.5px] tabular-nums text-muted-foreground">
          {doneCount} of {items.length} done
        </span>
      </div>
      <ul className="space-y-2.5">
        {items.map((it, i) => {
          // Proposed times that have already passed are no use any more.
          const item: SavedItem = it.slots ? { ...it, slots: it.slots.filter((s) => s.start > now) } : it;
          const pending = busy === it.task;
          return (
            <li key={`${it.task}-${i}`} className="group flex items-start gap-2.5 border-b border-border/40 pb-2.5 last:border-b-0 last:pb-0">
              <button
                type="button"
                onClick={() => toggle(i)}
                disabled={pending}
                aria-label={it.done ? "Mark not done" : "Mark done"}
                title={it.done ? "Mark not done" : "Mark done"}
                className={`group/check mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border text-[10.5px] font-semibold transition-colors ${
                  it.done
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : numbered
                      ? "border-foreground bg-foreground text-background hover:border-emerald-600 hover:bg-emerald-600"
                      : "border-foreground/30 text-transparent hover:border-emerald-600 hover:text-emerald-600"
                }`}
              >
                {it.done ? (
                  <Check className="h-3 w-3" strokeWidth={3} />
                ) : numbered ? (
                  <>
                    <span className="group-hover/check:hidden">{i + 1}</span>
                    <Check className="hidden h-3 w-3 group-hover/check:block" strokeWidth={3} />
                  </>
                ) : (
                  <Check className="h-3 w-3" strokeWidth={3} />
                )}
              </button>
              <div className="min-w-0 flex-1 space-y-1.5">
                <div
                  className={`leading-snug transition-colors ${numbered ? "text-[13.5px] font-medium" : "text-[13px]"} ${
                    it.done ? "text-muted-foreground line-through decoration-foreground/30" : "text-foreground"
                  }`}
                >
                  {it.task}
                </div>
                {(it.owner || it.due) && !it.done ? (
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    {it.owner ? (
                      <span className="inline-flex h-6 items-center gap-1 rounded-full border border-border bg-muted/60 px-2 text-foreground/80">
                        <UserRound className="h-3 w-3" />
                        {it.owner}
                      </span>
                    ) : null}
                    {it.due ? (
                      <span className="inline-flex h-6 items-center gap-1 rounded-full border border-border bg-muted/60 px-2 text-foreground/80">
                        <CalendarClock className="h-3 w-3" />
                        {dueLabel(it.due)}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {tool && !it.done ? <ActionTool item={item} brandId={brandId} brandName={tool.brandName} pocEmail={tool.pocEmail} /> : null}
              </div>
              <button
                type="button"
                onClick={() => clear(i)}
                disabled={pending}
                aria-label="Clear"
                title="Clear this item"
                className="mt-0.5 rounded-full p-0.5 text-muted-foreground/60 opacity-40 transition hover:bg-muted hover:text-foreground group-hover:opacity-100 focus:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
