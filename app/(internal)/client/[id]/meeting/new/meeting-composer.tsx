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
  UserRound,
  CalendarClock,
} from "lucide-react";
import { useDictation } from "@/components/dictation/use-dictation";
import { DictationPill } from "@/components/dictation/dictation-pill";
import { SummaryList } from "@/components/meetings/summary-list";
import { EmailPreview, copyEmail } from "@/components/meetings/email-preview";
import { OpenInGmail } from "@/components/meetings/open-in-gmail";
import { ActionTool, type ActionToolItem } from "@/components/meetings/action-tool";
import { RecapHero } from "@/components/meetings/recap-hero";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

type ActionItem = ActionToolItem & {
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
  /** Recent client emails the analyzer read alongside the notes. */
  sources?: { subject: string; date: string }[];
  /** Client-side people on recent threads, offered as CC. */
  cc_suggestions?: { email: string; name: string }[];
  /** How many of the writer's past recaps shaped the email's style. */
  styled_on?: number;
};

const EMPTY: Analysis = {
  summary: "",
  action_items_us: [],
  action_items_them: [],
  followup_email_subject: "",
  followup_email_body: "",
  next_meeting_focus: "",
};

// "Bertram Yachts'" not "Bertram Yachts's".
function possessive(name: string): string {
  return /s$/i.test(name.trim()) ? `${name.trim()}'` : `${name.trim()}'s`;
}

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
  teamNames = [],
}: {
  teamNames?: string[];
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
  const [cc, setCc] = useState<string[]>([]);
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

  // Keep a draft on this device so a refresh or a closed tab mid-meeting
  // never loses the dump. Cleared on Save.
  const draftKey = `sg-meeting-draft:${brandId}:${meetingType}`;
  const restored = useRef(false);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(draftKey);
      if (raw) {
        const d = JSON.parse(raw) as { notes?: string; date?: string; analysis?: Analysis | null; at?: number };
        // Older than three days is stale.
        if (d.at && Date.now() - d.at < 3 * 86400000 && (d.notes || "").trim()) {
          setRawNotes(d.notes || "");
          if (d.date) setMeetingDate(d.date);
          if (d.analysis) {
            setAnalysis({ ...EMPTY, ...d.analysis });
            setAnalyzed(true);
          }
          toast.message("Picked up your unsaved notes.");
        } else {
          window.localStorage.removeItem(draftKey);
        }
      }
    } catch {}
    restored.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);
  useEffect(() => {
    if (!restored.current) return;
    const t = setTimeout(() => {
      try {
        if (!rawNotes.trim()) window.localStorage.removeItem(draftKey);
        else
          window.localStorage.setItem(
            draftKey,
            JSON.stringify({ notes: rawNotes, date: meetingDate, analysis: analyzed ? analysis : null, at: Date.now() })
          );
      } catch {}
    }, 400);
    return () => clearTimeout(t);
  }, [rawNotes, meetingDate, analysis, analyzed, draftKey]);

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
      try {
        window.localStorage.removeItem(draftKey);
      } catch {}
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
        {/* LEFT — raw notes (stays in view while the output scrolls) */}
        <div className="flex flex-col md:sticky md:top-20 md:self-start">
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
            className={`resize-y bg-panel text-[13px] leading-relaxed ${
              analyzed ? "min-h-[260px] md:h-[calc(100vh-15rem)]" : "min-h-[520px]"
            }`}
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
              Kept on this device until you save. Only the team sees it after.
            </span>
          </div>
        </div>

        {/* RIGHT — AI output */}
        <div id="meeting-output" className="flex flex-col gap-4">
          {analyzing ? (
            <AnalyzingState brandName={brandName} pocName={pocName} />
          ) : !analyzed ? (
            <EmptyState />
          ) : (
            <>
              <RecapHero
                summary={analysis.summary}
                focus={analysis.next_meeting_focus}
                sources={analysis.sources}
                clientName={brandName}
              />

              <OutputCard
                title={`Our next steps${analysis.action_items_us.length ? ` · ${analysis.action_items_us.length}` : ""}`}
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
                  renderTool={(it) => <ActionTool item={it} brandId={brandId} brandName={brandName} pocEmail={pocEmail} />}
                  numbered
                  ownerOptions={teamNames}
                />
                {analysis.action_items_us.length ? (
                  <p className="mt-3 text-[11px] text-muted-foreground">
                    When you save, each goes on its owner&apos;s To-dos in My Surroundings (no owner = yours).
                  </p>
                ) : null}
              </OutputCard>

              <OutputCard
                title={`On ${pocName ? possessive(pocName.split(" ")[0]) : "the client's"} side`}
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
                  ownerOptions={pocName ? [pocName] : []}
                />
              </OutputCard>

              <OutputCard
                title="Follow-up email"
                icon={<Mail className="h-3.5 w-3.5" />}
                trailing={
                  <OpenInGmail to={pocEmail} cc={cc} subject={analysis.followup_email_subject} body={analysis.followup_email_body} />
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
                  {analysis.cc_suggestions?.length ? (
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span className="mr-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">CC</span>
                      {analysis.cc_suggestions.map((p) => {
                        const on = cc.includes(p.email);
                        return (
                          <button
                            key={p.email}
                            type="button"
                            title={p.email}
                            onClick={() => setCc((c) => (on ? c.filter((x) => x !== p.email) : [...c, p.email]))}
                            className={`inline-flex h-6 items-center gap-1 rounded-full border px-2.5 text-[11px] transition-colors ${
                              on
                                ? "border-foreground bg-foreground text-background"
                                : "border-dashed border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                            }`}
                          >
                            {on ? <Check className="h-3 w-3" /> : <span className="text-[12px] leading-none">+</span>}
                            {p.name}
                          </button>
                        );
                      })}
                      <span className="text-[10.5px] text-muted-foreground/70">on recent threads</span>
                    </div>
                  ) : null}
                  <div className="mt-2 flex items-baseline justify-between">
                    <label className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      Body
                      {analysis.styled_on ? (
                        <span className="ml-2 normal-case tracking-normal text-muted-foreground/70">
                          written in your style, from {analysis.styled_on} past recap{analysis.styled_on === 1 ? "" : "s"}
                        </span>
                      ) : null}
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

// What the AI is doing while Analyze runs (it reads the notes, the client's
// open projects, Billy's calendar and recent email, then writes).
function AnalyzingState({ brandName, pocName }: { brandName: string; pocName: string | null }) {
  const first = pocName ? pocName.split(" ")[0] : "the client";
  const steps = [
    "Reading your notes",
    `Matching to ${possessive(brandName)} open projects`,
    "Finding open times on the calendar",
    `Reading recent email with ${first}`,
    "Picking the right tool for each next step",
    `Writing the recap for ${first}`,
  ];
  const [at, setAt] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setAt((n) => Math.min(n + 1, steps.length - 1)), 4500);
    return () => clearInterval(t);
  }, [steps.length]);
  return (
    <div className="relative flex min-h-[520px] flex-col justify-center overflow-hidden rounded-xl bg-[#0F0F0F] p-8 text-[#F7F4F0]">
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 animate-pulse rounded-full bg-[#FFBD83]/10 blur-3xl" />
      <div className="mb-6 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[#FFBD83]">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#FFBD83]" />
        Working on {brandName}
      </div>
      <ol className="space-y-3.5">
        {steps.map((label, i) => {
          const done = i < at;
          const now = i === at;
          return (
            <li
              key={label}
              className={`flex items-center gap-3 text-[13.5px] transition-all duration-500 ${
                done ? "text-[#F7F4F0]/45" : now ? "text-[#F7F4F0]" : "text-[#F7F4F0]/20"
              }`}
            >
              <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center">
                {done ? (
                  <Check className="h-3.5 w-3.5 text-[#FFBD83]" />
                ) : now ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[#FFBD83]" />
                ) : (
                  <span className="h-1 w-1 rounded-full bg-current" />
                )}
              </span>
              {label}
            </li>
          );
        })}
      </ol>
      <p className="mt-8 text-[11px] text-[#F7F4F0]/40">Usually a minute or so.</p>
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
  renderTool,
  numbered = false,
  ownerOptions = [],
}: {
  /** Names offered in the owner picker. */
  ownerOptions?: string[];
  items: ActionItem[];
  onChange: (next: ActionItem[]) => void;
  emptyLabel: string;
  /** The next-step buttons under an item (ours only). */
  renderTool?: (item: ActionItem) => React.ReactNode;
  /** Numbered steps instead of bullets (ours). */
  numbered?: boolean;
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
          {numbered ? (
            <div className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-foreground text-[10.5px] font-semibold text-background">
              {i + 1}
            </div>
          ) : (
            <div className="pt-1.5 text-muted-foreground">•</div>
          )}
          <div className="flex-1 space-y-1.5">
            <textarea
              value={it.task}
              onChange={(e) => update(i, { task: e.target.value })}
              rows={1}
              ref={growToFit}
              onInput={(e) => growToFit(e.currentTarget)}
              className={`w-full resize-none overflow-hidden border-0 bg-transparent p-0 leading-snug text-foreground focus:outline-none ${numbered ? "text-[13.5px] font-medium" : "text-[13px]"}`}
              placeholder="Action item…"
            />
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              <MetaChip
                icon={<UserRound className="h-3 w-3" />}
                value={it.owner ?? ""}
                placeholder="Add owner"
                options={ownerOptions}
                onChange={(v) => update(i, { owner: v || null })}
              />
              <DueChip value={it.due ?? ""} onChange={(v) => update(i, { due: v || null })} />
            </div>
            {renderTool ? renderTool(it) : null}
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

// Grow a one-line textarea to fit what is in it.
function growToFit(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

// Owner / due as small editable chips that size to their text.
function MetaChip({
  icon,
  value,
  placeholder,
  options = [],
  onChange,
}: {
  icon: React.ReactNode;
  value: string;
  placeholder: string;
  options?: string[];
  onChange: (v: string) => void;
}) {
  const listId = useRef(`chip-${Math.random().toString(36).slice(2, 9)}`).current;
  const width = `${Math.max((value || placeholder).length, 6) + 1}ch`;
  return (
    <label
      className={`inline-flex h-6 items-center gap-1 rounded-full border px-2 transition-colors focus-within:border-foreground/50 ${
        value ? "border-border bg-muted/60 text-foreground/80" : "border-dashed border-border/80 text-muted-foreground/70"
      }`}
    >
      {icon}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ width }}
        list={options.length ? listId : undefined}
        className="h-5 min-w-0 border-0 bg-transparent p-0 text-[11px] placeholder:text-muted-foreground/60 focus:outline-none [&::-webkit-calendar-picker-indicator]:hidden"
      />
      {options.length ? (
        <datalist id={listId}>
          {options.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      ) : null}
    </label>
  );
}

// Due date as a chip: real dates read "Wed, Nov 25" and open a date picker;
// loose ones the AI wrote ("end of next week") show as written until picked.
function DueChip({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value);
  let label = value;
  if (iso) {
    const d = new Date(`${value}T12:00:00`);
    label = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }
  return (
    <span
      className={`relative inline-flex h-6 items-center gap-1 rounded-full border px-2 transition-colors focus-within:border-foreground/50 ${
        value ? "border-border bg-muted/60 text-foreground/80" : "border-dashed border-border/80 text-muted-foreground/70"
      }`}
    >
      <CalendarClock className="h-3 w-3" />
      <span className="text-[11px]">{label || "Add due"}</span>
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          className="relative z-10 -mr-0.5 ml-0.5 text-[11px] leading-none text-muted-foreground/60 hover:text-foreground"
          aria-label="Clear due date"
        >
          ×
        </button>
      ) : null}
      <input
        type="date"
        value={iso ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => {
          try {
            e.currentTarget.showPicker();
          } catch {}
        }}
        aria-label="Due date"
        className={`absolute inset-0 cursor-pointer opacity-0 ${value ? "right-5" : ""}`}
      />
    </span>
  );
}
