"use client";

// Submit a case study from My Surroundings. It is filed on the Monday "Shout
// Outs & Showcases" board as a showcase piece, where the team already
// collects them.

import { useState } from "react";
import { ArrowUpRight, Check, Loader2, Plus, Send } from "lucide-react";

const FIELD =
  "w-full rounded-lg border border-border bg-panel px-3 py-2 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-foreground/50";
const LABEL = "mb-1 block text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground";
const BLANK = { client: "", title: "", story: "", why: "", link: "" };

export function CaseStudyWidget({ clients }: { clients: string[] }) {
  const [f, setF] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ name: string; url: string } | null>(null);
  const set = (k: keyof typeof BLANK) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((cur) => ({ ...cur, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/my/case-study", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; url?: string; error?: string } | null;
      if (!res.ok || !json?.ok || !json.url) {
        setError(json?.error ?? "That did not go through. Try again.");
        return;
      }
      setDone({ name: `${f.client.trim()} | ${f.title.trim()}`, url: json.url });
      setF(BLANK);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="flex h-full min-h-[200px] flex-col items-start justify-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
          <Check className="h-4 w-4" />
        </span>
        <div>
          <div className="text-[15px] font-semibold leading-snug text-foreground">{done.name}</div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">Submitted. It is on the Shout Outs & Showcases board as a showcase piece.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={done.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-lg bg-foreground px-3 py-1.5 text-[12px] font-medium text-background transition-opacity hover:opacity-90"
          >
            Open in Monday
            <ArrowUpRight className="h-3 w-3" />
          </a>
          <button
            type="button"
            onClick={() => setDone(null)}
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-panel px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-secondary"
          >
            <Plus className="h-3 w-3" />
            Submit another
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-x-3 gap-y-3 sm:grid-cols-2">
      <label className="block">
        <span className={LABEL}>Client</span>
        <input className={FIELD} value={f.client} onChange={set("client")} required maxLength={120} placeholder="Who it was for" list="case-study-clients" autoComplete="off" />
        <datalist id="case-study-clients">
          {clients.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </label>
      <label className="block">
        <span className={LABEL}>Title</span>
        <input className={FIELD} value={f.title} onChange={set("title")} required maxLength={140} placeholder="The project, in a few words" autoComplete="off" />
      </label>
      <label className="block sm:col-span-2">
        <span className={LABEL}>What we did</span>
        <textarea className={`${FIELD} resize-y`} rows={3} value={f.story} onChange={set("story")} required maxLength={4000} placeholder="The brief, what we made, how it came together" />
      </label>
      <label className="block sm:col-span-2">
        <span className={LABEL}>The result, and why it matters</span>
        <textarea className={`${FIELD} resize-y`} rows={2} value={f.why} onChange={set("why")} maxLength={2000} placeholder="Numbers, what the client said, what it led to" />
      </label>
      <label className="block sm:col-span-2">
        <span className={LABEL}>Link to the work</span>
        <input className={FIELD} type="url" value={f.link} onChange={set("link")} maxLength={500} placeholder="https://" autoComplete="off" />
      </label>
      {error ? <p className="text-[12px] leading-relaxed text-red-700 sm:col-span-2">{error}</p> : null}
      <div className="flex justify-end sm:col-span-2">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-4 py-2 text-[12.5px] font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          {busy ? "Sending" : "Submit case study"}
        </button>
      </div>
    </form>
  );
}
