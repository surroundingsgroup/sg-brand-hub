"use client";

// The next step for one of our meeting action items, picked by the analyzer:
// a filled-in edit or project request in the Brief tool, a revision on the
// right brief, a task on the client's SocialDesk notebook, or open times for
// a meeting (each one a ready calendar invite). Plus the links from the notes.

import { useState } from "react";
import { ArrowUpRight, CalendarPlus, Check, Clapperboard, FilePlus2, Link2, Loader2, PenLine, Share2 } from "lucide-react";
import { toast } from "sonner";

export type ActionToolItem = {
  task: string;
  tool?: "edit_request" | "project_request" | "revision_request" | "social_task" | "meeting" | "todo";
  links?: string[];
  request_url?: string;
  revise_url?: string;
  revise_project?: string;
  meeting?: { title: string; minutes: number; with_client: boolean };
  slots?: { start: string; end: string; label: string }[];
};

const chip =
  "inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-foreground/80 transition-colors hover:border-foreground/50 hover:text-foreground";

const gcalStamp = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

export function ActionTool({
  item,
  brandId,
  brandName,
  pocEmail,
}: {
  item: ActionToolItem;
  brandId: string;
  brandName: string;
  pocEmail: string | null;
}) {
  const [sd, setSd] = useState<"idle" | "busy" | { url?: string }>("idle");
  const links = item.links ?? [];
  const host = (u: string) => {
    try {
      return new URL(u).hostname.replace(/^www\./, "");
    } catch {
      return u;
    }
  };

  async function addToNotebook() {
    setSd("busy");
    try {
      const r = await fetch(`/api/brand/${brandId}/socialdesk-notebook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: [item.task, ...links].join(" ") }),
      });
      const d = (await r.json().catch(() => ({}))) as { ok?: boolean; url?: string; already?: boolean; error?: string };
      if (!d.ok) throw new Error(d.error || "Could not add it");
      setSd({ url: d.url });
      toast.success(d.already ? "Already on the SocialDesk notebook." : "Added to the SocialDesk notebook for the SMM.");
    } catch (e) {
      setSd("idle");
      toast.error((e as Error).message);
    }
  }

  const actions: React.ReactNode[] = [];
  if ((item.tool === "edit_request" || item.tool === "project_request") && item.request_url) {
    actions.push(
      <a key="req" href={item.request_url} target="_blank" rel="noopener noreferrer" className={chip}>
        {item.tool === "edit_request" ? <Clapperboard className="h-3 w-3" /> : <FilePlus2 className="h-3 w-3" />}
        {item.tool === "edit_request" ? "Edit request" : "Project request"}
        <ArrowUpRight className="h-3 w-3 opacity-60" />
      </a>
    );
  }
  if (item.tool === "revision_request") {
    actions.push(
      item.revise_url ? (
        <a key="rev" href={item.revise_url} target="_blank" rel="noopener noreferrer" className={chip} title={item.revise_project}>
          <PenLine className="h-3 w-3" />
          Request revision{item.revise_project ? `: ${item.revise_project.split("|").pop()?.trim()}` : ""}
          <ArrowUpRight className="h-3 w-3 opacity-60" />
        </a>
      ) : (
        <span key="rev" className="text-[11px] text-muted-foreground">Revision: no matching brief found, open it from the client&apos;s briefs</span>
      )
    );
  }
  if (item.tool === "social_task") {
    actions.push(
      typeof sd === "object" ? (
        <a key="sd" href={sd.url} target="_blank" rel="noopener noreferrer" className={`${chip} border-emerald-600/40 text-emerald-700 dark:text-emerald-400`}>
          <Check className="h-3 w-3" />
          On the SocialDesk notebook
          <ArrowUpRight className="h-3 w-3 opacity-60" />
        </a>
      ) : (
        <button key="sd" type="button" onClick={addToNotebook} disabled={sd === "busy"} className={chip}>
          {sd === "busy" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Share2 className="h-3 w-3" />}
          Add to SocialDesk notebook
        </button>
      )
    );
  }
  if (item.tool === "meeting" && item.slots?.length) {
    for (const s of item.slots) {
      const q = new URLSearchParams({
        text: `${brandName} | ${item.meeting?.title ?? item.task}`,
        dates: `${gcalStamp(s.start)}/${gcalStamp(s.end)}`,
      });
      if (item.meeting?.with_client !== false && pocEmail) q.set("add", pocEmail);
      actions.push(
        <a
          key={s.start}
          href={`https://calendar.google.com/calendar/r/eventedit?${q.toString()}`}
          target="_blank"
          rel="noopener noreferrer"
          className={chip}
          title="Open this as a calendar invite"
        >
          <CalendarPlus className="h-3 w-3" />
          {s.label}
        </a>
      );
    }
  }
  for (const l of links) {
    actions.push(
      <a key={l} href={l} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
        <Link2 className="h-3 w-3" />
        {host(l)}
      </a>
    );
  }
  if (!actions.length) return null;
  return <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{actions}</div>;
}
