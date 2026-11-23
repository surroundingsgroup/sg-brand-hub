"use client";

// The time-off request form. Posts to /api/my/pto/submit, which files the
// request on the Monday "Time Off Request" board the way that board's own form
// does. Hours fill in from the dates (8 a working day, 4 for a half day) and
// can be changed, since they are what comes off the balance.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send, Check, CalendarCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { workingDays } from "@/lib/pto/holidays";

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}


const isHalf = (type: string) => /half/i.test(type);
const label = (type: string) => (isHalf(type) ? "Half day" : type.replace(/\s*-\s*/, ": "));

export type OtherTimeOff = { id: string; name: string; team: string | null; from: string; to: string; approved: boolean };

const shortDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function PtoForm({
  typeOptions,
  name,
  approver,
  myTeam,
  others,
  eligibleFrom,
  balance = null,
}: {
  typeOptions: string[];
  name: string | null;
  approver: string;
  myTeam: string;
  others: OtherTimeOff[]; // everyone else's approved and waiting time off that has not ended yet
  eligibleFrom: string | null; // the day after the first 90 days, when still ahead
  balance?: number | null; // hours available, when balances are shown
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [type, setType] = useState(typeOptions[0] ?? "");
  const [start, setStart] = useState(today());
  const [end, setEnd] = useState(today());
  const [typedHours, setTypedHours] = useState<string | null>(null); // null = follow the dates
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [sent, setSent] = useState<null | { url: string; approver: string }>(null);

  const half = isHalf(type);
  const lastDay = half ? start : end;
  const span = useMemo(() => workingDays(start, lastDay), [start, lastDay]);
  const days = span.days;
  const holidayNote = span.holidays.length ? ` ${span.holidays.map((x) => x.name).join(" and ")} ${span.holidays.length === 1 ? "is a company holiday" : "are company holidays"}, so not counted.` : "";
  const autoHours = days * (half ? 4 : 8);
  const hours = typedHours ?? String(autoHours);

  // Who else is already off on these dates, same team first. This is what keeps time off from piling up on the same days.
  const overlap = useMemo(
    () => others.filter((o) => o.from <= lastDay && o.to >= start).sort((a, b) => Number(b.team === myTeam) - Number(a.team === myTeam) || a.from.localeCompare(b.from)),
    [others, start, lastDay, myTeam]
  );
  const sameTeam = overlap.filter((o) => o.team === myTeam);
  // Time Off SOP: more than two working days off needs 30 days' notice.
  const noticeDays = Math.round((Date.parse(`${start}T12:00:00Z`) - Date.parse(`${today()}T12:00:00Z`)) / 86400000);
  const shortNotice = !half && days > 2 && noticeDays < 30;
  const tooEarly = !!eligibleFrom && start < eligibleFrom;
  const overBalance = balance != null && Number(hours) > balance;

  async function submit() {
    if (!name) return void toast.error("Add your name to your profile first.");
    if (!start) return void toast.error("Pick a start date.");
    if (lastDay < start) return void toast.error("The end date can't be before the start date.");
    if (days === 0) return void toast.error("Those dates are a weekend or a company holiday. Pick working days.");
    if (!(Number(hours) > 0)) return void toast.error("Enter the hours you are asking for.");
    setSaving(true);
    try {
      const res = await fetch("/api/my/pto/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, start_date: start, end_date: lastDay, hours: Number(hours), notes }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; monday_url?: string; approver?: string };
      if (!res.ok || !data.monday_url) {
        toast.error(data.error ?? "Couldn't submit.");
        return;
      }
      setSent({ url: data.monday_url, approver: data.approver ?? approver });
      setNotes("");
      setTypedHours(null);
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
          It is with <span className="font-medium">{sent.approver}</span> to approve. You will see the answer here under Your requests, and Monday will notify you.
        </p>
        <div className="flex items-center gap-3">
          <Button type="button" variant="outline" onClick={() => setSent(null)}>
            Submit another
          </Button>
          <a href={sent.url} target="_blank" rel="noopener noreferrer" className="text-[12px] text-emerald-900 underline underline-offset-4 hover:text-emerald-950">
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
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Request time off</div>
          <h2 className="mt-1 text-[15px] font-semibold tracking-tight">New request</h2>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Hours requested</div>
          <div className="text-[18px] font-semibold tabular-nums">{Number(hours) > 0 ? Number(hours) : 0}</div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Kind">
          <Select
            value={type}
            onValueChange={(v) => {
              setType(v);
              setTypedHours(null);
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {typeOptions.map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {label(opt)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Submitting as">
          <div className="flex h-10 items-center rounded-md border border-border bg-secondary/40 px-3 text-[13px] text-foreground">
            <Check className="mr-2 h-3.5 w-3.5 text-emerald-600" />
            {name ?? "No name on your profile yet"}
          </div>
        </Field>
        <Field label={half ? "Date" : "First day off"}>
          <Input
            type="date"
            value={start}
            onChange={(e) => {
              setStart(e.target.value);
              setTypedHours(null);
              if (!end || end < e.target.value) setEnd(e.target.value);
            }}
          />
        </Field>
        {half ? (
          <Field label="Hours" helper="A half day is 4 hours.">
            <Input type="number" min={0.5} max={4} step={0.5} value={hours} onChange={(e) => setTypedHours(e.target.value)} />
          </Field>
        ) : (
          <Field label="Last day off">
            <Input
              type="date"
              value={end}
              min={start}
              onChange={(e) => {
                setEnd(e.target.value);
                setTypedHours(null);
              }}
            />
          </Field>
        )}
        {half ? null : (
          <Field label="Hours" helper={`${days} working ${days === 1 ? "day" : "days"} at 8 hours.${holidayNote} Change it if you are taking less.`}>
            <Input type="number" min={0.5} max={Math.max(8, days * 8)} step={0.5} value={hours} onChange={(e) => setTypedHours(e.target.value)} />
          </Field>
        )}
        <Field label="Goes to">
          <div className="flex h-10 items-center rounded-md border border-border bg-secondary/40 px-3 text-[13px] text-foreground">{approver}</div>
        </Field>
        {overlap.length > 0 || shortNotice || tooEarly || overBalance ? (
          <div className="space-y-2 md:col-span-2">
            {overBalance && balance != null ? (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-[12.5px] leading-relaxed text-amber-900">
                This is more than the {Math.max(0, Math.round(balance * 10) / 10)} hours you have available. You can still ask; your manager decides how the rest is handled.
              </div>
            ) : null}
            {overlap.length > 0 ? (
              <div className={`rounded-lg border px-3 py-2.5 text-[12.5px] leading-relaxed ${sameTeam.length ? "border-amber-300 bg-amber-50 text-amber-900" : "border-border bg-secondary/40 text-foreground"}`}>
                <div className="font-semibold">
                  {sameTeam.length
                    ? `${sameTeam.length === 1 ? "Someone on your team is" : `${sameTeam.length} people on your team are`} already off then`
                    : `${overlap.length === 1 ? "One other person is" : `${overlap.length} other people are`} off then`}
                </div>
                <ul className="mt-1 space-y-0.5">
                  {overlap.slice(0, 6).map((o) => (
                    <li key={o.id}>
                      {o.name}, {shortDate(o.from)}
                      {o.to !== o.from ? ` to ${shortDate(o.to)}` : ""}
                      {o.approved ? "" : " (waiting for approval)"}
                      {o.team && o.team !== myTeam ? `, ${o.team}` : ""}
                    </li>
                  ))}
                  {overlap.length > 6 ? <li>and {overlap.length - 6} more</li> : null}
                </ul>
                {sameTeam.length ? <div className="mt-1">You can still ask. Other dates are more likely to be approved.</div> : null}
              </div>
            ) : null}
            {shortNotice ? (
              <div className="rounded-lg border border-border bg-secondary/40 px-3 py-2.5 text-[12.5px] leading-relaxed text-foreground">
                More than two days off needs 30 days&apos; notice. This starts in {Math.max(0, noticeDays)} {noticeDays === 1 ? "day" : "days"}, so it is up to your manager.
              </div>
            ) : null}
            {tooEarly && eligibleFrom ? (
              <div className="rounded-lg border border-border bg-secondary/40 px-3 py-2.5 text-[12.5px] leading-relaxed text-foreground">
                Paid time off starts after your first 90 days, on {shortDate(eligibleFrom)}. Your manager will see this request is before then.
              </div>
            ) : null}
          </div>
        ) : null}
        <Field label="Note" span2 helper="Optional. Coverage, handoff, anything your manager should know.">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </Field>
      </div>

      <footer className="mt-5 flex flex-wrap items-center gap-3 border-t border-border/60 pt-5">
        <Button type="button" onClick={submit} disabled={saving || !name} className="gap-1.5">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          {saving ? "Sending, about 10 seconds" : "Submit request"}
        </Button>
        <span className="text-[11px] text-muted-foreground">Goes onto the Monday Time Off Request board. Hours come off your balance once it is approved.</span>
      </footer>
    </div>
  );
}

function Field({ label, helper, span2, children }: { label: string; helper?: string; span2?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex flex-col gap-1.5 ${span2 ? "md:col-span-2" : ""}`}>
      <label className="text-[11px] font-medium text-foreground">{label}</label>
      {children}
      {helper ? <p className="text-[11px] leading-relaxed text-muted-foreground">{helper}</p> : null}
    </div>
  );
}
