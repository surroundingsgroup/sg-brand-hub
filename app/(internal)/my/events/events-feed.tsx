"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, MapPin, Plus, Loader2 } from "lucide-react";
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
import type { EventRow } from "./page";

const KIND_LABEL: Record<EventRow["kind"], string> = {
  meeting: "Meeting",
  all_hands: "All-hands",
  event: "Event",
  offsite: "Off-site",
  holiday: "Holiday",
  other: "Other",
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
function isUpcoming(iso: string): boolean {
  return new Date(iso).getTime() >= Date.now() - 2 * 3600 * 1000;
}

export function EventsFeed({ initial }: { initial: EventRow[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<EventRow["kind"]>("meeting");
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function post() {
    if (!title.trim() || !starts) {
      toast.error("Title and start time are required.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/my/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          kind,
          starts_at: new Date(starts).toISOString(),
          ends_at: ends ? new Date(ends).toISOString() : null,
          location,
          notes,
        }),
      });
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({ error: "Failed." }))) as {
          error?: string;
        };
        toast.error(error ?? "Couldn't post.");
        return;
      }
      setTitle("");
      setStarts("");
      setEnds("");
      setLocation("");
      setNotes("");
      setKind("meeting");
      setComposing(false);
      toast.success("Added.");
      startTransition(() => router.refresh());
    } catch {
      toast.error("Network error.");
    } finally {
      setSaving(false);
    }
  }

  const { upcoming, past } = useMemo(() => {
    const u: EventRow[] = [];
    const p: EventRow[] = [];
    for (const e of initial) (isUpcoming(e.starts_at) ? u : p).push(e);
    return { upcoming: u, past: p.reverse() };
  }, [initial]);

  return (
    <div className="flex flex-col gap-6">
      {composing ? (
        <div className="rounded-xl border border-border/70 bg-panel p-5">
          <div className="mb-3 border-b border-border/60 pb-2.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            New event
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
            <Select value={kind} onValueChange={(v) => setKind(v as EventRow["kind"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(KIND_LABEL).map(([v, l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-muted-foreground">Starts</label>
              <Input type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-muted-foreground">Ends (optional)</label>
              <Input type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} />
            </div>
            <Input placeholder="Location (optional)" value={location} onChange={(e) => setLocation(e.target.value)} className="md:col-span-2" />
            <Textarea placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="md:col-span-2" />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Button type="button" onClick={post} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Add
            </Button>
            <Button type="button" variant="outline" onClick={() => setComposing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" onClick={() => setComposing(true)} className="w-fit gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Add event
        </Button>
      )}

      <section>
        <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Upcoming
        </div>
        {upcoming.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-panel/50 p-10 text-center">
            <CalendarCheck className="mx-auto h-5 w-5 text-muted-foreground/70" />
            <p className="mt-3 text-[12.5px] text-muted-foreground">Nothing on the calendar yet.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {upcoming.map((e) => <EventCard key={e.id} e={e} />)}
          </ul>
        )}
      </section>

      {past.length > 0 ? (
        <section>
          <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Recent
          </div>
          <ul className="space-y-3">
            {past.slice(0, 6).map((e) => <EventCard key={e.id} e={e} past />)}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function EventCard({ e, past }: { e: EventRow; past?: boolean }) {
  return (
    <li
      className={`rounded-xl border border-border/70 bg-panel p-5 ${past ? "opacity-60" : ""}`}
    >
      <header className="mb-2 flex items-center justify-between gap-3">
        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-accent-foreground">
          {KIND_LABEL[e.kind]}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {fmtDate(e.starts_at)} · {fmtTime(e.starts_at)}
          {e.ends_at ? ` – ${fmtTime(e.ends_at)}` : ""}
        </span>
      </header>
      <h3 className="text-[15px] font-semibold tracking-tight text-foreground">{e.title}</h3>
      {e.location ? (
        <div className="mt-1.5 inline-flex items-center gap-1 text-[12px] text-muted-foreground">
          <MapPin className="h-3 w-3" />
          {e.location}
        </div>
      ) : null}
      {e.notes ? (
        <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/85">
          {e.notes}
        </p>
      ) : null}
      {e.created_by_name ? (
        <footer className="mt-3 text-[11px] text-muted-foreground">
          Added by {e.created_by_name}
        </footer>
      ) : null}
    </li>
  );
}
