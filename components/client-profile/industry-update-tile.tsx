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

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Compass, RefreshCw, Loader2 } from "lucide-react";
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
    <Tile label={label} icon={<Compass className="h-3.5 w-3.5" />}>
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
          <ul className="space-y-3">
            {local.items.map((item, i) => (
              <li key={i} className="border-l-2 border-border pl-3">
                <div className="mb-0.5 flex items-baseline gap-2">
                  <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {item.kind === "inspiration" ? "Inspiration" : "Competitor"}
                  </span>
                  <span className="text-[12px] font-semibold text-foreground">
                    {item.headline}
                  </span>
                </div>
                <p className="text-[12px] leading-relaxed text-foreground/85">
                  {item.body}
                </p>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between border-t border-border/70 pt-3 text-[11px] text-muted-foreground">
            <span>Updated {relativeTime(local.generated_at)}</span>
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
    </Tile>
  );
}
