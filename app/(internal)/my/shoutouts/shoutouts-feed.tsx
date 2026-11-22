"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Heart, Loader2, ExternalLink, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ShoutoutRecord } from "@/lib/monday/shoutouts";

function relative(iso: string | null): string {
  if (!iso) return "";
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

export function ShoutoutsFeed({
  initial,
  teamNames,
  kindOptions,
  schemaOk,
  error,
}: {
  initial: ShoutoutRecord[];
  teamNames: string[];
  kindOptions: string[];
  schemaOk: boolean;
  error: string | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [kind, setKind] = useState(kindOptions[0] ?? "Shoutout");
  const [toName, setToName] = useState<string>("__team__");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function post() {
    if (!message.trim()) {
      toast.error("Write a message first.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/my/shoutouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          to_name: toName === "__team__" ? null : toName,
          message,
        }),
      });
      if (!res.ok) {
        const { error: err } = (await res.json().catch(() => ({ error: "Failed." }))) as {
          error?: string;
        };
        toast.error(err ?? "Couldn't post.");
        return;
      }
      setMessage("");
      setToName("__team__");
      setKind(kindOptions[0] ?? "Shoutout");
      toast.success("Posted to Monday.");
      startTransition(() => router.refresh());
    } catch {
      toast.error("Network error.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Composer */}
      <div className="rounded-2xl border border-border/70 bg-panel p-6 shadow-[0_1px_2px_rgba(16,10,0,0.04),0_10px_28px_-14px_rgba(16,10,0,0.14)]">
        <header className="mb-4 flex items-baseline justify-between border-b border-border/60 pb-2.5">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              New post
            </div>
            <h2 className="mt-1 text-[15px] font-semibold tracking-tight">
              Say something good
            </h2>
          </div>
          <span className="text-[10.5px] text-muted-foreground">
            Lands on the Monday board
          </span>
        </header>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-[160px_200px_1fr]">
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {kindOptions.map((k) => (
                <SelectItem key={k} value={k}>{k}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={toName} onValueChange={setToName}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__team__">Whole team</SelectItem>
              {teamNames.map((n) => (
                <SelectItem key={n} value={n}>{n}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Textarea
            placeholder="What killed it this week? Who crushed something? Say it here."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
          />
        </div>

        <footer className="mt-4 flex items-center gap-3 border-t border-border/60 pt-4">
          <Button type="button" onClick={post} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Heart className="h-3.5 w-3.5" />}
            Post
          </Button>
          <span className="text-[11px] text-muted-foreground">
            Auto-tagged with your name. Writes to the &ldquo;Shoutouts and Showcases&rdquo; Monday board.
          </span>
        </footer>
      </div>

      {/* Feed */}
      {!schemaOk ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-5 text-[12.5px] text-rose-900">
          Couldn&apos;t reach Monday — {error ?? "retry in a moment"}.
        </div>
      ) : initial.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-panel/50 p-10 text-center">
          <Sparkles className="mx-auto h-5 w-5 text-muted-foreground/70" />
          <p className="mt-3 text-[12.5px] text-muted-foreground">
            No shoutouts on the board yet. Be the first — it&apos;s contagious.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {initial.map((s) => (
            <ShoutoutCard key={s.id} s={s} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ShoutoutCard({ s }: { s: ShoutoutRecord }) {
  const kindTone = (s.kind ?? "").toLowerCase().includes("showcase")
    ? "bg-sky-100 text-sky-900"
    : "bg-accent-soft text-accent-foreground";
  return (
    <li className="rounded-2xl border border-border/70 bg-panel p-5 shadow-[0_1px_2px_rgba(16,10,0,0.04),0_8px_24px_-16px_rgba(16,10,0,0.08)] transition-colors hover:border-accent/40">
      <header className="mb-2 flex items-center justify-between gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
        <div className="flex items-center gap-1.5">
          {s.kind ? (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${kindTone}`}>
              {s.kind}
            </span>
          ) : null}
          {s.to_name ? (
            <span>
              for{" "}
              <span className="text-foreground">{s.to_name}</span>
            </span>
          ) : (
            <span>
              for <span className="text-foreground">the team</span>
            </span>
          )}
        </div>
        <span>{relative(s.created_at)}</span>
      </header>
      {s.message ? (
        <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-foreground">
          {s.message}
        </p>
      ) : (
        <p className="text-[12px] italic text-muted-foreground">
          {s.name}
        </p>
      )}
      <footer className="mt-3 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
        <span>— {s.from_name ?? "Someone"}</span>
        <a
          href={s.monday_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
        >
          Monday
          <ExternalLink className="h-3 w-3" />
        </a>
      </footer>
    </li>
  );
}
