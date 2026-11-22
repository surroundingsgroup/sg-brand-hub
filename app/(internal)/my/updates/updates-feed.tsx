"use client";

// Updates feed — inline composer at top, pinned + chronological list
// below. Pin toggle + delete inline on each row.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pin, PinOff, Trash2, Megaphone, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
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
import type { UpdateRow } from "./page";

const KIND_LABEL: Record<UpdateRow["kind"], string> = {
  announcement: "Announcement",
  policy: "Policy",
  signature: "Signature",
  new_hire: "New hire",
  process: "Process",
  other: "Other",
};

function relative(iso: string): string {
  const then = new Date(iso).getTime();
  if (isNaN(then)) return iso;
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function UpdatesFeed({
  initial,
  myEmail,
}: {
  initial: UpdateRow[];
  myEmail: string | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [rows, setRows] = useState<UpdateRow[]>(initial);
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<UpdateRow["kind"]>("announcement");
  const [saving, setSaving] = useState(false);

  async function create() {
    if (!title.trim()) {
      toast.error("Add a title.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/my/updates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body, kind }),
      });
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({ error: "Failed." }))) as {
          error?: string;
        };
        toast.error(error ?? "Couldn't post.");
        return;
      }
      setTitle("");
      setBody("");
      setKind("announcement");
      setComposing(false);
      toast.success("Posted.");
      startTransition(() => router.refresh());
    } catch {
      toast.error("Network error.");
    } finally {
      setSaving(false);
    }
  }

  async function togglePin(id: string, pinned: boolean) {
    setRows((cur) => cur.map((r) => (r.id === id ? { ...r, pinned: !pinned } : r)));
    const res = await fetch(`/api/my/updates/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: !pinned }),
    });
    if (!res.ok) {
      toast.error("Couldn't update pin.");
      // Revert
      setRows((cur) => cur.map((r) => (r.id === id ? { ...r, pinned } : r)));
      return;
    }
    startTransition(() => router.refresh());
  }

  async function remove(id: string) {
    if (!confirm("Delete this update?")) return;
    const prev = rows;
    setRows((cur) => cur.filter((r) => r.id !== id));
    const res = await fetch(`/api/my/updates/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Couldn't delete.");
      setRows(prev);
      return;
    }
    toast.success("Deleted.");
    startTransition(() => router.refresh());
  }

  const pinned = rows.filter((r) => r.pinned);
  const rest = rows.filter((r) => !r.pinned);

  return (
    <div className="flex flex-col gap-6">
      {/* Composer */}
      {composing ? (
        <div className="rounded-xl border border-border/70 bg-panel p-5">
          <div className="mb-3 flex items-center gap-2 border-b border-border/60 pb-2.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            New update
          </div>
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_200px]">
              <Input
                placeholder="Title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
              <Select value={kind} onValueChange={(v) => setKind(v as UpdateRow["kind"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(KIND_LABEL).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Textarea
              placeholder="Details (optional). Links, context, next steps."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
            />
            <div className="flex items-center gap-2">
              <Button type="button" onClick={create} disabled={saving} className="gap-1.5">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Post
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setComposing(false);
                  setTitle("");
                  setBody("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          onClick={() => setComposing(true)}
          className="w-fit gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" />
          Post an update
        </Button>
      )}

      {/* Feed */}
      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-panel/50 p-10 text-center">
          <Megaphone className="mx-auto h-5 w-5 text-muted-foreground/70" />
          <p className="mt-3 text-[12.5px] text-muted-foreground">
            Nothing posted yet. Drop the first update.
          </p>
        </div>
      ) : (
        <>
          {pinned.length > 0 ? (
            <section>
              <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Pinned
              </div>
              <ul className="space-y-3">
                {pinned.map((r) => (
                  <UpdateCard key={r.id} r={r} myEmail={myEmail} onPin={togglePin} onDelete={remove} />
                ))}
              </ul>
            </section>
          ) : null}
          {rest.length > 0 ? (
            <section>
              {pinned.length > 0 ? (
                <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Recent
                </div>
              ) : null}
              <ul className="space-y-3">
                {rest.map((r) => (
                  <UpdateCard key={r.id} r={r} myEmail={myEmail} onPin={togglePin} onDelete={remove} />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function UpdateCard({
  r,
  myEmail,
  onPin,
  onDelete,
}: {
  r: UpdateRow;
  myEmail: string | null;
  onPin: (id: string, pinned: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const mine = r.created_by_email?.toLowerCase() === myEmail;
  return (
    <li className="rounded-xl border border-border/70 bg-panel p-5">
      <header className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-accent-foreground">
            {KIND_LABEL[r.kind]}
          </span>
          {r.pinned ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900">
              <Pin className="h-2.5 w-2.5" />
              Pinned
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <button
            type="button"
            onClick={() => onPin(r.id, r.pinned)}
            className="rounded-md p-1 transition-colors hover:bg-secondary hover:text-foreground"
            title={r.pinned ? "Unpin" : "Pin"}
          >
            {r.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
          </button>
          {mine ? (
            <button
              type="button"
              onClick={() => onDelete(r.id)}
              className="rounded-md p-1 transition-colors hover:bg-rose-100 hover:text-rose-700"
              title="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </header>
      <h3 className="text-[15px] font-semibold tracking-tight text-foreground">{r.title}</h3>
      {r.body ? (
        <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/85">
          {r.body}
        </p>
      ) : null}
      <footer className="mt-3 text-[11px] text-muted-foreground">
        {r.created_by_name ?? "Someone"} · {relative(r.created_at)}
      </footer>
    </li>
  );
}
