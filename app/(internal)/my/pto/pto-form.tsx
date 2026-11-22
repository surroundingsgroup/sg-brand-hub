"use client";

// Hub-native PTO form. Submits to /api/my/pto/submit which creates
// the item on the Monday PTO board. Fields: type (from the board's
// configured labels), start date, end date, optional notes. Days
// requested auto-calculates.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send, Check, CalendarCheck } from "lucide-react";
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

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysBetween(start: string, end: string): number {
  if (!start) return 0;
  const s = new Date(start + "T00:00:00").getTime();
  const e = new Date((end || start) + "T00:00:00").getTime();
  if (isNaN(s) || isNaN(e) || e < s) return 0;
  return Math.round((e - s) / 86400000) + 1;
}

export function PtoForm({
  typeOptions,
  defaultStatusLabel,
}: {
  typeOptions: string[];
  defaultStatusLabel: string | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [type, setType] = useState(typeOptions[0] ?? "Vacation");
  const [start, setStart] = useState(today());
  const [end, setEnd] = useState(today());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [sent, setSent] = useState<null | { url: string }>(null);

  const days = useMemo(() => daysBetween(start, end), [start, end]);
  const dayLabel =
    days === 0 ? "—" : days === 1 ? "1 day" : `${days} days`;

  async function submit() {
    if (!type) {
      toast.error("Pick a PTO type.");
      return;
    }
    if (!start) {
      toast.error("Pick a start date.");
      return;
    }
    if (end && end < start) {
      toast.error("End date can't be before start.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/my/pto/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          start_date: start,
          end_date: end || start,
          notes,
        }),
      });
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({ error: "Failed." }))) as {
          error?: string;
        };
        toast.error(error ?? "Couldn't submit.");
        return;
      }
      const data = (await res.json()) as { monday_url: string };
      setSent({ url: data.monday_url });
      setNotes("");
      toast.success("Request submitted.");
      startTransition(() => router.refresh());
    } catch {
      toast.error("Network error.");
    } finally {
      setSaving(false);
    }
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-6">
        <div className="flex items-center gap-2 text-emerald-900">
          <CalendarCheck className="h-5 w-5" />
          <span className="text-[15px] font-semibold">Request submitted</span>
        </div>
        <p className="text-[12.5px] text-emerald-900/80">
          Status:{" "}
          <span className="font-medium">
            {defaultStatusLabel ?? "Pending"}
          </span>
          . Your AM is notified on Monday. Status updates sync back here.
        </p>
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => setSent(null)}
          >
            Submit another
          </Button>
          <a
            href={sent.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[12px] text-emerald-900 underline underline-offset-4 hover:text-emerald-950"
          >
            Open in Monday
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border/70 bg-panel p-6 shadow-[0_1px_2px_rgba(16,10,0,0.04),0_10px_28px_-14px_rgba(16,10,0,0.14)]">
      <header className="mb-5 flex items-baseline justify-between gap-3 border-b border-border/60 pb-3">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Request time off
          </div>
          <h2 className="mt-1 text-[15px] font-semibold tracking-tight">
            New PTO request
          </h2>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Days requested
          </div>
          <div className="text-[18px] font-semibold tabular-nums">
            {dayLabel}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Type">
          <Select value={type} onValueChange={setType}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {typeOptions.map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Submitting as">
          <div className="flex h-10 items-center rounded-md border border-border bg-secondary/40 px-3 text-[13px] text-muted-foreground">
            <Check className="mr-2 h-3.5 w-3.5 text-emerald-600" />
            Signed-in team member
          </div>
        </Field>
        <Field label="Start date">
          <Input
            type="date"
            value={start}
            onChange={(e) => {
              setStart(e.target.value);
              if (!end || end < e.target.value) setEnd(e.target.value);
            }}
          />
        </Field>
        <Field label="End date">
          <Input
            type="date"
            value={end}
            min={start}
            onChange={(e) => setEnd(e.target.value)}
          />
        </Field>
        <Field label="Notes" span2 helper="Optional — context for your AM (coverage, out-of-office handoff, etc.)">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Any context your AM should know."
          />
        </Field>
      </div>

      <footer className="mt-5 flex flex-wrap items-center gap-3 border-t border-border/60 pt-5">
        <Button type="button" onClick={submit} disabled={saving} className="gap-1.5">
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
          Submit request
        </Button>
        <span className="text-[11px] text-muted-foreground">
          Lands on the Monday PTO board. Status syncs back to your snapshot.
        </span>
      </footer>
    </div>
  );
}

function Field({
  label,
  helper,
  span2,
  children,
}: {
  label: string;
  helper?: string;
  span2?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${span2 ? "md:col-span-2" : ""}`}>
      <label className="text-[11px] font-medium text-foreground">{label}</label>
      {children}
      {helper ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">{helper}</p>
      ) : null}
    </div>
  );
}
