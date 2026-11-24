"use client";

// Meeting composer — the sweet, premium UX for turning a messy voice
// or text dump into:
//   • a clean recap summary
//   • action items for US (SG) and THEM (the client)
//   • a client-ready follow-up email draft
//   • a one-line focus for the next sync
//
// Two columns. Left: the raw notes textarea + meeting meta. Right: the
// AI output cards. Analyze is a stateless call (no DB write) so the AM
// can iterate on raw notes freely. "Save" persists to meeting_notes
// and bounces back to the client profile.

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  Loader2,
  Copy,
  Mail,
  Calendar,
  Check,
  ListChecks,
  Users,
  Mic,
  AudioLines,
  Square,
} from "lucide-react";
import { useDictation } from "@/components/dictation/use-dictation";
import { DictationPill } from "@/components/dictation/dictation-pill";
import { SummaryList } from "@/components/meetings/summary-list";
import { EmailPreview, copyEmail } from "@/components/meetings/email-preview";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

type ActionItem = {
  task: string;
  owner?: string | null;
  due?: string | null;
};

type Analysis = {
  summary: string;
  action_items_us: ActionItem[];
  action_items_them: ActionItem[];
  followup_email_subject: string;
  followup_email_body: string;
  next_meeting_focus: string;
};

const EMPTY: Analysis = {
  summary: "",
  action_items_us: [],
  action_items_them: [],
  followup_email_subject: "",
  followup_email_body: "",
  next_meeting_focus: "",
};

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function MeetingComposer({
  brandId,
  brandName,
  meetingType,
  meetingTitle,
  pocName,
  pocEmail,
  amName,
}: {
  brandId: string;
  brandName: string;
  meetingType: string;
  meetingTitle: string;
  pocName: string | null;
  pocEmail: string | null;
  amName: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [meetingDate, setMeetingDate] = useState<string>(today());
  const [rawNotes, setRawNotes] = useState("");
  const [editingEmail, setEditingEmail] = useState(false);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const modeRef = useRef<"dictate" | "meeting" | null>(null);

  // Voice: dictation drops words at the cursor; a meeting recording puts each
  // spoken phrase on its own line, ready for Analyze to turn into notes.
  const insertSpoken = useCallback((text: string) => {
    const el = notesRef.current;
    setRawNotes((cur) => {
      if (modeRef.current === "meeting") return `${cur}${cur && !cur.endsWith("\n") ? "\n" : ""}${text}\n`;
      const focused = el && document.activeElement === el;
      const at = focused ? el.selectionEnd ?? cur.length : cur.length;
      const before = cur.slice(0, at);
      const after = cur.slice(at);
      const sep = before && !/\s$/.test(before) ? " " : "";
      const next = `${before}${sep}${text}${after && !/^\s/.test(after) ? " " : ""}${after}`;
      if (focused) {
        const caret = (before + sep + text).length;
        requestAnimationFrame(() => el.setSelectionRange(caret, caret));
      }
      return next;
    });
  }, []);
  const voice = useDictation(insertSpoken);
  const { start: startVoice, stop: stopVoice } = voice;

  function toggleVoice(mode: "dictate" | "meeting") {
    if (voice.active) {
      stopVoice();
      modeRef.current = null;
      return;
    }
    modeRef.current = mode;
    if (mode === "meeting") {
      const at = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      setRawNotes((cur) => `${cur}${cur.trim() ? "\n\n" : ""}Meeting recording, ${at}\n`);
    }
    startVoice(mode);
  }

  // ⌘D / Ctrl+D starts and stops dictation on this page.
  const toggleRef = useRef(toggleVoice);
  toggleRef.current = toggleVoice;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        toggleRef.current("dictate");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (voice.error) {
      toast.error(voice.error);
      voice.clearError();
    }
  }, [voice]);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis>(EMPTY);
  const [analyzed, setAnalyzed] = useState(false);

  async function analyze() {
    if (rawNotes.trim().length < 10) {
      toast.error("Jot down a few sentences first.");
      return;
    }
    setAnalyzing(true);
    try {
      const res = await fetch(`/api/brand/${brandId}/meeting-notes/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meeting_type: meetingType,
          meeting_date: meetingDate,
          meeting_title: meetingTitle,
          raw_notes: rawNotes,
        }),
      });
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({ error: "Analyze failed." }))) as {
          error?: string;
        };
        toast.error(error ?? "Couldn't analyze — try again.");
        return;
      }
      const data = (await res.json()) as Analysis;
      setAnalysis(data);
      setAnalyzed(true);
      // Scroll the first output card into view on mobile.
      if (typeof window !== "undefined" && window.innerWidth < 768) {
        setTimeout(() => {
          document.getElementById("meeting-output")?.scrollIntoView({ behavior: "smooth" });
        }, 50);
      }
    } catch {
      toast.error("Network error — try again.");
    } finally {
      setAnalyzing(false);
    }
  }

  async function save() {
    if (!analyzed) {
      toast.error("Analyze first, then save.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/brand/${brandId}/meeting-notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meeting_type: meetingType,
          meeting_title: meetingTitle,
          meeting_date: meetingDate,
          raw_notes: rawNotes,
          ...analysis,
          analyzed_at: new Date().toISOString(),
        }),
      });
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({ error: "Save failed." }))) as {
          error?: string;
        };
        toast.error(error ?? "Couldn't save.");
        return;
      }
      const saved = (await res.json().catch(() => ({}))) as { todos_added?: number };
      toast.success(
        saved.todos_added
          ? `Meeting notes saved. ${saved.todos_added} action item${saved.todos_added === 1 ? "" : "s"} added to To-dos.`
          : "Meeting notes saved."
      );
      startTransition(() => router.push(`/client/${brandId}`));
    } catch {
      toast.error("Network error — try again.");
    } finally {
      setSaving(false);
    }
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied.`);
    } catch {
      toast.error("Copy failed.");
    }
  }

  const followupMailto = pocEmail
    ? `mailto:${pocEmail}?subject=${encodeURIComponent(analysis.followup_email_subject)}&body=${encodeURIComponent(analysis.followup_email_body)}`
    : null;

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      {/* Hero strip — compact header for the meeting */}
      <div className="mb-8">
        <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {meetingTitle}
        </div>
        <h1 className="mt-1.5 text-3xl font-semibold tracking-tight text-foreground md:text-[2.25rem]">
          {brandName}
        </h1>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-muted-foreground">
          <label className="inline-flex items-center gap-2">
            <Calendar className="h-3.5 w-3.5" />
            <Input
              type="date"
              value={meetingDate}
              onChange={(e) => setMeetingDate(e.target.value)}
              className="h-7 w-[150px] border-0 bg-transparent p-0 text-[12px] text-foreground focus-visible:ring-0"
            />
          </label>
          {pocName ? (
            <span>
              with <span className="text-foreground">{pocName}</span>
            </span>
          ) : null}
          {amName ? (
            <span>
              Led by <span className="text-foreground">{amName}</span>
            </span>
          ) : null}
        </div>
      </div>

      {/* Two-column layout: notes on left, output on right */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        {/* LEFT — raw notes */}
        <div className="flex flex-col">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Raw notes
            </h2>
            <span className="flex items-center gap-2">
              {voice.supported ? (
                <>
                  <button
                    type="button"
                    onClick={() => toggleVoice("dictate")}
                    title="Talk and your words go where the cursor is. ⌘D starts and stops."
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      voice.active === "dictate"
                        ? "border-foreground bg-foreground text-background"
                        : "border-border text-foreground/80 hover:border-foreground/50"
                    }`}
                  >
                    {voice.active === "dictate" ? <Square className="h-3 w-3 fill-current" /> : <Mic className="h-3 w-3" />}
                    {voice.active === "dictate" ? "Stop" : "Dictate"}
                    <kbd className="ml-0.5 text-[10px] opacity-60">⌘D</kbd>
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleVoice("meeting")}
                    title="Leave it running during the meeting. Everything said near your mic is written down, one line per phrase; then hit Analyze."
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      voice.active === "meeting"
                        ? "border-foreground bg-foreground text-background"
                        : "border-border text-foreground/80 hover:border-foreground/50"
                    }`}
                  >
                    {voice.active === "meeting" ? <Square className="h-3 w-3 fill-current" /> : <AudioLines className="h-3 w-3" />}
                    {voice.active === "meeting" ? "Stop recording" : "Record meeting"}
                  </button>
                </>
              ) : null}
              <span className="text-[10px] text-muted-foreground">
                {rawNotes.length.toLocaleString()} chars
              </span>
            </span>
          </div>
          <Textarea
            ref={notesRef}
            value={rawNotes}
            onChange={(e) => setRawNotes(e.target.value)}
            placeholder={`Dump everything. Talking points, decisions, promises, random stuff that came up. Bullets, paragraphs, half-sentences — doesn't matter, the AI will clean it up.

Examples:
• Confirmed November shoot date (Nov 18, 9am, their Miami office)
• Client wants more reels, fewer static posts
• Sasha asked about analytics report format
• Follow up with Sarah re: brand guidelines v2`}
            className="min-h-[520px] resize-y bg-panel text-[13px] leading-relaxed"
          />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              onClick={analyze}
              disabled={analyzing || rawNotes.trim().length < 10}
              className="gap-1.5"
            >
              {analyzing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {analyzing ? "Analyzing…" : analyzed ? "Re-analyze" : "Analyze with AI"}
            </Button>
            {analyzed ? (
              <Button
                type="button"
                variant="outline"
                onClick={save}
                disabled={saving || isPending}
                className="gap-1.5"
              >
                {saving || isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                {saving ? "Saving…" : "Save meeting"}
              </Button>
            ) : null}
            <span className="text-[11px] text-muted-foreground">
              Your dump stays private — we save when you click Save.
            </span>
          </div>
        </div>

        {/* RIGHT — AI output */}
        <div id="meeting-output" className="flex flex-col gap-4">
          {!analyzed ? (
            <EmptyState />
          ) : (
            <>
              <OutputCard title="Summary">
                <SummaryList text={analysis.summary} />
              </OutputCard>

              <OutputCard
                title="Action items — us"
                icon={<ListChecks className="h-3.5 w-3.5" />}
                onCopy={() =>
                  copy(
                    analysis.action_items_us
                      .map((a) => `• ${a.task}${a.owner ? ` (${a.owner})` : ""}${a.due ? ` — ${a.due}` : ""}`)
                      .join("\n"),
                    "Our action items"
                  )
                }
              >
                <ActionList
                  items={analysis.action_items_us}
                  onChange={(items) =>
                    setAnalysis((a) => ({ ...a, action_items_us: items }))
                  }
                  emptyLabel="Nothing we promised."
                />
                {analysis.action_items_us.length ? (
                  <p className="mt-3 text-[11px] text-muted-foreground">
                    When you save, each goes on its owner&apos;s To-dos in My Surroundings (no owner = yours).
                  </p>
                ) : null}
              </OutputCard>

              <OutputCard
                title="Action items — client"
                icon={<Users className="h-3.5 w-3.5" />}
                onCopy={() =>
                  copy(
                    analysis.action_items_them
                      .map((a) => `• ${a.task}${a.owner ? ` (${a.owner})` : ""}${a.due ? ` — ${a.due}` : ""}`)
                      .join("\n"),
                    "Client action items"
                  )
                }
              >
                <ActionList
                  items={analysis.action_items_them}
                  onChange={(items) =>
                    setAnalysis((a) => ({ ...a, action_items_them: items }))
                  }
                  emptyLabel="Nothing owed from them."
                />
              </OutputCard>

              <OutputCard
                title="Follow-up email"
                icon={<Mail className="h-3.5 w-3.5" />}
                trailing={
                  followupMailto ? (
                    <a
                      href={followupMailto}
                      className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Mail className="h-3 w-3" />
                      Open in mail
                    </a>
                  ) : null
                }
                onCopy={async () => {
                  const ok = await copyEmail(analysis.followup_email_body);
                  if (ok) toast.success("Email copied, formatted. Paste it into Gmail.");
                  else toast.error("Couldn't copy.");
                }}
              >
                <div className="flex flex-col gap-2">
                  <label className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    Subject
                  </label>
                  <Input
                    value={analysis.followup_email_subject}
                    onChange={(e) =>
                      setAnalysis((a) => ({
                        ...a,
                        followup_email_subject: e.target.value,
                      }))
                    }
                    className="h-8 text-[13px]"
                  />
                  <div className="mt-2 flex items-baseline justify-between">
                    <label className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      Body
                    </label>
                    <button
                      type="button"
                      onClick={() => setEditingEmail((e) => !e)}
                      className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {editingEmail ? "Done editing" : "Edit"}
                    </button>
                  </div>
                  {editingEmail ? (
                    <AutoTextarea
                      value={analysis.followup_email_body}
                      onChange={(v) =>
                        setAnalysis((a) => ({ ...a, followup_email_body: v }))
                      }
                      rows={18}
                    />
                  ) : (
                    <EmailPreview body={analysis.followup_email_body} />
                  )}
                </div>
              </OutputCard>

              {analysis.next_meeting_focus ? (
                <div className="rounded-xl border border-border/70 bg-panel p-4">
                  <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    Next meeting focus
                  </div>
                  <p className="mt-1.5 text-[13px] text-foreground/90">
                    {analysis.next_meeting_focus}
                  </p>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
      {voice.active ? (
        <DictationPill mode={voice.active} level={voice.level} interim={voice.interim} startedAt={voice.startedAt} onStop={() => toggleVoice(voice.active!)} />
      ) : null}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex min-h-[520px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-panel/50 p-10 text-center">
      <Sparkles className="h-6 w-6 text-muted-foreground/60" />
      <h3 className="mt-3 text-sm font-semibold tracking-tight text-foreground">
        Output appears here
      </h3>
      <p className="mt-1.5 max-w-[32ch] text-[12px] leading-relaxed text-muted-foreground">
        Jot down what came up in the meeting on the left, then hit <strong>Analyze with AI</strong>. You&apos;ll get a clean recap, action items split by owner, and a client-ready follow-up email.
      </p>
    </div>
  );
}

function OutputCard({
  title,
  icon,
  onCopy,
  trailing,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  onCopy?: () => void;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border/70 bg-panel p-5">
      <header className="mb-3 flex items-center justify-between gap-3 border-b border-border/60 pb-2.5">
        <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {icon ? <span className="text-foreground/50">{icon}</span> : null}
          {title}
        </div>
        <div className="flex items-center gap-3">
          {trailing}
          {onCopy ? (
            <button
              type="button"
              onClick={onCopy}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              title="Copy"
            >
              <Copy className="h-3 w-3" />
              Copy
            </button>
          ) : null}
        </div>
      </header>
      {children}
    </section>
  );
}

function AutoTextarea({
  value,
  onChange,
  rows,
}: {
  value: string;
  onChange: (v: string) => void;
  rows: number;
}) {
  return (
    <Textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      className="resize-y bg-background text-[13px] leading-relaxed"
    />
  );
}

function ActionList({
  items,
  onChange,
  emptyLabel,
}: {
  items: ActionItem[];
  onChange: (next: ActionItem[]) => void;
  emptyLabel: string;
}) {
  function update(i: number, patch: Partial<ActionItem>) {
    onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function remove(i: number) {
    onChange(items.filter((_, idx) => idx !== i));
  }
  function add() {
    onChange([...items, { task: "", owner: null, due: null }]);
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[12px] italic text-muted-foreground">{emptyLabel}</p>
        <button
          type="button"
          onClick={add}
          className="inline-flex w-fit items-center gap-1 text-[11px] text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
        >
          Add one
        </button>
      </div>
    );
  }

  return (
    <ul className="space-y-2.5">
      {items.map((it, i) => (
        <li
          key={i}
          className="flex items-start gap-2.5 border-b border-border/40 pb-2.5 last:border-b-0 last:pb-0"
        >
          <div className="pt-1.5 text-muted-foreground">•</div>
          <div className="flex-1 space-y-1.5">
            <textarea
              value={it.task}
              onChange={(e) => update(i, { task: e.target.value })}
              rows={1}
              className="w-full resize-none border-0 bg-transparent p-0 text-[13px] leading-snug text-foreground focus:outline-none"
              placeholder="Action item…"
            />
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <input
                value={it.owner ?? ""}
                onChange={(e) => update(i, { owner: e.target.value || null })}
                placeholder="Owner"
                className="h-5 w-24 border-0 bg-transparent p-0 text-[11px] focus:outline-none"
              />
              <span className="text-foreground/20">·</span>
              <input
                value={it.due ?? ""}
                onChange={(e) => update(i, { due: e.target.value || null })}
                placeholder="Due"
                className="h-5 w-24 border-0 bg-transparent p-0 text-[11px] focus:outline-none"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() => remove(i)}
            className="text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground"
            aria-label="Remove"
          >
            ×
          </button>
        </li>
      ))}
      <li>
        <button
          type="button"
          onClick={add}
          className="text-[11px] text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
        >
          Add one
        </button>
      </li>
    </ul>
  );
}
