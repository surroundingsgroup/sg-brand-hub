"use client";

// Industry Update tile — Claude-generated inspiration + competitor
// notes for this client's vertical. Clicked "Refresh" calls
// POST /api/brand/:id/industry-update which writes to brands.industry_update
// and the page revalidates on next load. The cached payload is passed
// in from the server component so the tile renders instantly.
//
// This is a sync-call tool, not a surveillance tool: four quick bullets
// the AM can riff on when talking strategy. Refresh cadence is manual
// so we're not spending Claude tokens on every page view.

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Compass, RefreshCw, Loader2, Plus, X, ArrowUpRight, Instagram, Facebook, Youtube, Linkedin, Globe, Music2, Copy } from "lucide-react";
import { readSaved, SAVED_KINDS, type SavedItem, type SavedKind } from "@/lib/connect/saved";
import { toast } from "sonner";
import { Tile, TileEmpty } from "./tile";

type IndustryItem = {
  kind: "inspiration" | "competitor";
  headline: string;
  body: string;
};

type IndustryUpdate = {
  generated_at: string;
  items: IndustryItem[];
};

function parseCached(raw: unknown): IndustryUpdate | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.generated_at !== "string") return null;
  if (!Array.isArray(o.items)) return null;
  return {
    generated_at: o.generated_at,
    items: (o.items as unknown[])
      .map((it): IndustryItem | null => {
        if (!it || typeof it !== "object") return null;
        const r = it as Record<string, unknown>;
        const kind =
          r.kind === "inspiration" || r.kind === "competitor" ? r.kind : null;
        if (!kind) return null;
        if (typeof r.headline !== "string" || typeof r.body !== "string") return null;
        return { kind, headline: r.headline, body: r.body };
      })
      .filter((x): x is IndustryItem => x !== null),
  };
}

// The first paint shows a plain date, pinned to New York time so the server
// and the browser write the same thing. "3h ago" depends on the exact second
// it is worked out, so it is swapped in once the page is live.
function stampDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
}

function UpdatedAt({ iso }: { iso: string }) {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    setLabel(relativeTime(iso));
  }, [iso]);
  return <span>Updated {label ?? stampDate(iso)}</span>;
}

function relativeTime(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = Math.max(0, now - d.getTime());
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  return `${months}mo ago`;
}

// Billy's house style: no em dashes. Notes saved before the generator was
// told so are tidied on the way to the screen.
function noDash(text: string): string {
  return text
    .replace(/\s*[\u2014\u2013]\s*/g, ", ")
    .replace(/,\s*,/g, ",")
    .replace(/,\s*([.!?])/g, "$1");
}

// ── The feed ──────────────────────────────────────────────────────────────────
// A saved link from a platform that offers embeds plays right here instead of
// sending the team off to another tab. Only these known platforms are ever
// framed, and the frame address is rebuilt from the post's id, never taken
// from the saved link as written.
type Platform = "Instagram" | "Facebook" | "YouTube" | "TikTok" | "LinkedIn" | "Web";
type Embed = { platform: Platform; src: string | null; height: number };

function embedFor(url: string | null): Embed {
  if (!url) return { platform: "Web", src: null, height: 0 };
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { platform: "Web", src: null, height: 0 };
  }
  const host = u.hostname.replace(/^(www|m|mobile)\./, "").toLowerCase();
  const path = u.pathname;
  if (host === "instagram.com") {
    const m = path.match(/\/(p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/);
    return { platform: "Instagram", src: m ? `https://www.instagram.com/${m[1] === "reels" ? "reel" : m[1]}/${m[2]}/embed/` : null, height: 560 };
  }
  if (host === "youtube.com" || host === "youtu.be") {
    const id =
      host === "youtu.be"
        ? path.slice(1).split("/")[0]
        : (u.searchParams.get("v") ?? path.match(/\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{6,})/)?.[1] ?? "");
    const short = /\/shorts\//.test(path);
    return { platform: "YouTube", src: /^[A-Za-z0-9_-]{6,}$/.test(id) ? `https://www.youtube.com/embed/${id}` : null, height: short ? 560 : 196 };
  }
  if (host === "tiktok.com") {
    const id = path.match(/\/video\/(\d{8,})/)?.[1];
    return { platform: "TikTok", src: id ? `https://www.tiktok.com/embed/v2/${id}` : null, height: 560 };
  }
  if (host === "facebook.com" || host === "fb.watch") {
    const isVideo = host === "fb.watch" || /\/(videos|watch|reel)\b/.test(path);
    const postLike = isVideo || /\/(posts|photos|permalink|share)\b/.test(path) || u.searchParams.has("story_fbid") || u.searchParams.has("fbid");
    return {
      platform: "Facebook",
      src: postLike
        ? `https://www.facebook.com/plugins/${isVideo ? "video" : "post"}.php?href=${encodeURIComponent(u.toString())}&show_text=${isVideo ? "false" : "true"}&width=328`
        : null,
      height: isVideo ? 420 : 500,
    };
  }
  if (host === "linkedin.com") {
    const urn = path.match(/urn:li:(?:share|activity|ugcPost):\d+/)?.[0];
    return { platform: "LinkedIn", src: urn ? `https://www.linkedin.com/embed/feed/update/${urn}` : null, height: 500 };
  }
  return { platform: "Web", src: null, height: 0 };
}

const PLATFORM_ICON: Record<Platform, typeof Globe> = {
  Instagram,
  Facebook,
  YouTube: Youtube,
  TikTok: Music2,
  LinkedIn: Linkedin,
  Web: Globe,
};

export function IndustryUpdateTile({
  brandId,
  vertical,
  brandName,
  cached,
}: {
  brandId: string;
  vertical: string | null;
  brandName: string;
  cached: unknown;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [refreshing, setRefreshing] = useState(false);
  const [local, setLocal] = useState<IndustryUpdate | null>(parseCached(cached));
  // Saved for this client: by the team here, or by an outside assistant
  // through the connector API (app/api/connect).
  const [saved, setSaved] = useState<SavedItem[]>(readSaved(cached));
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<{ kind: SavedKind; title: string; url: string; note: string }>({ kind: "inspiration", title: "", url: "", note: "" });
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<"all" | SavedKind>("all");
  const [openNotes, setOpenNotes] = useState<Set<string>>(new Set());
  // Instagram's embeds report how tall they are, so each frame is cut to fit
  // its post instead of leaving a blank gap under a wide video.
  const frames = useRef<Map<string, HTMLIFrameElement>>(new Map());
  const [frameHeights, setFrameHeights] = useState<Record<string, number>>({});
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== "https://www.instagram.com" || typeof e.data !== "string") return;
      let msg: { type?: string; details?: { height?: number } };
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      const h = msg?.details?.height;
      if (msg?.type !== "MEASURE" || typeof h !== "number") return;
      for (const [id, el] of frames.current) {
        if (el.contentWindow === e.source) {
          setFrameHeights((prev) => ({ ...prev, [id]: Math.max(200, Math.min(640, Math.round(h))) }));
          break;
        }
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  const shown = filter === "all" ? saved : saved.filter((x) => x.kind === filter);
  const kindsPresent = SAVED_KINDS.filter((k) => saved.some((x) => x.kind === k));

  async function saveItem() {
    if (!draft.title.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/brand/${brandId}/saved`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const json = (await res.json().catch(() => null)) as { saved?: SavedItem[]; error?: string } | null;
      if (!res.ok || !json?.saved) {
        toast.error(json?.error ?? "Couldn't save that.");
        return;
      }
      setSaved(json.saved);
      setDraft({ kind: draft.kind, title: "", url: "", note: "" });
      setAdding(false);
    } catch {
      toast.error("Network error. Try again.");
    } finally {
      setSaving(false);
    }
  }

  // Muse fills this feed, and Muse is asked from Muse's side (it calls the
  // hub; the hub cannot call it). This copies the request for this client so
  // it is one paste away.
  async function copyMuseRequest() {
    const ask = `For ${brandName} in the Surroundings hub: read its brand context and what is already saved, then find three reels or campaigns it should study and two things its competitors are doing well. Save each one to the hub as inspiration or competitor, with a short note on why it matters for ${brandName}, the direct link to the post or reel itself (not a profile), and the source. Do not repeat anything already saved. Plain text, no em dashes.`;
    try {
      await navigator.clipboard.writeText(ask);
      toast.success("Copied. Paste it into Muse.");
    } catch {
      toast.error("Couldn't copy. Ask Muse to find inspiration for this client and save it to the hub.");
    }
  }

  async function removeItem(id: string) {
    const before = saved;
    setSaved(saved.filter((x) => x.id !== id));
    try {
      const res = await fetch(`/api/brand/${brandId}/saved?item=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      setSaved(before);
      toast.error("Couldn't remove that.");
    }
  }

  async function refresh() {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/brand/${brandId}/industry-update`, {
        method: "POST",
      });
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({ error: "Request failed." }))) as {
          error?: string;
        };
        toast.error(error ?? "Couldn't refresh industry update.");
        return;
      }
      const data = (await res.json()) as IndustryUpdate;
      setLocal(data);
      toast.success("Industry update refreshed.");
      startTransition(() => router.refresh());
    } catch {
      toast.error("Network error — try again.");
    } finally {
      setRefreshing(false);
    }
  }

  const label = vertical
    ? `Industry · ${vertical.replace(/_/g, " ")}`
    : "Industry Update";

  const busy = refreshing || isPending;

  return (
    <Tile label={label} icon={<Compass className="h-3.5 w-3.5" />} spans={2}>
      {!local || local.items.length === 0 ? (
        <div className="flex flex-col gap-3">
          <TileEmpty>
            No industry notes yet. Generate inspiration and competitor signals for {brandName}&apos;s next sync.
          </TileEmpty>
          <button
            type="button"
            onClick={refresh}
            disabled={busy}
            className="inline-flex w-fit items-center gap-1.5 rounded-md border border-border bg-panel px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {busy ? "Generating…" : "Generate"}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <ul className="grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2">
            {local.items.map((item, i) => (
              <li key={i} className="border-l-2 border-border pl-3">
                <div className="mb-0.5 flex items-baseline gap-2">
                  <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {item.kind === "inspiration" ? "Inspiration" : "Competitor"}
                  </span>
                  <span className="text-[12px] font-semibold text-foreground">
                    {noDash(item.headline)}
                  </span>
                </div>
                <p className="text-[12px] leading-relaxed text-foreground/85">
                  {noDash(item.body)}
                </p>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between border-t border-border/70 pt-3 text-[11px] text-muted-foreground">
            <UpdatedAt iso={local.generated_at} />
            <button
              type="button"
              onClick={refresh}
              disabled={busy}
              className="inline-flex items-center gap-1.5 text-foreground transition-colors hover:text-accent-foreground disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              {busy ? "Generating…" : "Refresh"}
            </button>
          </div>
        </div>
      )}

      {/* Saved for this client */}
      <div className="mt-4 flex flex-col gap-3 border-t border-border/70 pt-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Saved for {brandName}
              {saved.length ? <span className="ml-1.5 text-foreground/60">{saved.length}</span> : null}
            </div>
            {kindsPresent.length > 1 ? (
              <div className="flex flex-wrap gap-1">
                {(["all", ...kindsPresent] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setFilter(k)}
                    className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium capitalize transition-colors ${
                      filter === k ? "bg-foreground text-background" : "bg-secondary text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {k}
                    <span className="ml-1 opacity-60">{k === "all" ? saved.length : saved.filter((x) => x.kind === k).length}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="flex flex-shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={copyMuseRequest}
              title="Copies a ready-made request for this client. Paste it into Muse and it fills this feed."
              className="inline-flex items-center gap-1 rounded-md bg-foreground px-2.5 py-1 text-[11px] font-medium text-background transition-opacity hover:opacity-90"
            >
              <Copy className="h-3 w-3" />
              Ask Muse
            </button>
            <button
              type="button"
              onClick={() => setAdding((v) => !v)}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-panel px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-secondary"
            >
              {adding ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
              {adding ? "Close" : "Save a link or idea"}
            </button>
          </div>
        </div>

        {adding ? (
          <div className="flex flex-col gap-2 rounded-md border border-border bg-secondary/20 p-3">
            <div className="flex flex-wrap gap-1.5">
              {SAVED_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setDraft({ ...draft, kind: k })}
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium capitalize transition-colors ${
                    draft.kind === k ? "border-foreground bg-foreground text-background" : "border-border bg-panel text-muted-foreground hover:bg-secondary"
                  }`}
                >
                  {k}
                </button>
              ))}
            </div>
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="What is it? (a reel, a campaign, an article, an idea)"
              maxLength={160}
              className="w-full rounded-md border border-border bg-panel px-2.5 py-1.5 text-[12px] text-foreground outline-none focus:border-foreground/40"
            />
            <input
              value={draft.url}
              onChange={(e) => setDraft({ ...draft, url: e.target.value })}
              placeholder="Link (optional)"
              inputMode="url"
              className="w-full rounded-md border border-border bg-panel px-2.5 py-1.5 text-[12px] text-foreground outline-none focus:border-foreground/40"
            />
            <textarea
              value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
              placeholder="Why it matters for this client (optional)"
              rows={2}
              maxLength={1200}
              className="w-full resize-y rounded-md border border-border bg-panel px-2.5 py-1.5 text-[12px] text-foreground outline-none focus:border-foreground/40"
            />
            <div>
              <button
                type="button"
                onClick={saveItem}
                disabled={saving || !draft.title.trim()}
                className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-[12px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                Save
              </button>
            </div>
          </div>
        ) : null}

        {saved.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">
            Nothing saved yet. Press Ask Muse, paste what it copies into Muse, and the posts it finds appear here. You can also save
            a link yourself.
          </p>
        ) : (
          // A feed you scroll sideways: each saved post plays in place where
          // its platform allows it, with the note on why it matters underneath.
          <ul className="-mx-1 flex snap-x snap-mandatory gap-4 overflow-x-auto px-1 pb-3">
            {shown.map((item, i) => {
              const embed = embedFor(item.url);
              const Icon = PLATFORM_ICON[embed.platform];
              const open = openNotes.has(item.id);
              const long = (item.note ?? "").length > 150;
              return (
                <li key={item.id} className="group/saved flex w-[328px] max-w-[86vw] flex-shrink-0 snap-start flex-col gap-2.5">
                  <div className="overflow-hidden rounded-xl border border-border/70 bg-secondary/30">
                    {embed.src ? (
                      <iframe
                        ref={(el) => {
                          if (el) frames.current.set(item.id, el);
                          else frames.current.delete(item.id);
                        }}
                        src={embed.src}
                        title={item.title}
                        loading="lazy"
                        scrolling="no"
                        allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
                        allowFullScreen
                        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation"
                        referrerPolicy="strict-origin-when-cross-origin"
                        className="block w-full border-0 bg-panel"
                        style={{ height: frameHeights[item.id] ?? embed.height }}
                      />
                    ) : (
                      // Nothing to play: a quiet title card that opens the link.
                      <a
                        href={item.url ?? undefined}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="flex h-[196px] flex-col justify-between p-4 transition-colors hover:bg-secondary/60"
                      >
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        <span className="line-clamp-4 text-[17px] font-semibold leading-snug tracking-tight text-foreground">{noDash(item.title)}</span>
                      </a>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    <span className="text-[13px] font-light tracking-normal text-foreground/40 tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                    <span>{item.kind}</span>
                    <span className="inline-flex items-center gap-1 font-medium normal-case tracking-normal">
                      <Icon className="h-3 w-3" />
                      {embed.platform === "Web" ? (item.source ?? "Link") : embed.platform}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeItem(item.id)}
                      title="Remove"
                      className="ml-auto rounded p-0.5 opacity-60 transition-opacity hover:text-foreground hover:opacity-100 md:opacity-0 md:group-hover/saved:opacity-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  {item.url ? (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="group/title inline-flex items-start gap-1 text-[14px] font-semibold leading-snug tracking-tight text-foreground"
                    >
                      <span className="underline decoration-transparent underline-offset-2 transition-colors group-hover/title:decoration-foreground">{noDash(item.title)}</span>
                      <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform group-hover/title:-translate-y-0.5 group-hover/title:translate-x-0.5" />
                    </a>
                  ) : (
                    <span className="text-[14px] font-semibold leading-snug tracking-tight text-foreground">{noDash(item.title)}</span>
                  )}
                  {item.note ? (
                    <div>
                      <p className={`text-[12.5px] leading-relaxed text-foreground/80 ${open ? "" : "line-clamp-3"}`}>{noDash(item.note)}</p>
                      {long ? (
                        <button
                          type="button"
                          onClick={() =>
                            setOpenNotes((prev) => {
                              const next = new Set(prev);
                              if (next.has(item.id)) next.delete(item.id);
                              else next.add(item.id);
                              return next;
                            })
                          }
                          className="mt-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                        >
                          {open ? "Show less" : "Read more"}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="text-[10.5px] text-muted-foreground">
                    Saved by {item.saved_by} · {stampDate(item.saved_at)}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Tile>
  );
}
