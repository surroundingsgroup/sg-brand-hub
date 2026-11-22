// Client profile hero — compact, editorial, no logo thumb.
//
// Three stacked rows:
//   1. small "CLIENT" label + client name + action cluster (right)
//   2. ops chips: AM, engagement type, vertical
//   3. inline contact strip: POC, email, phone, website, socials
//
// Replaces the standalone ContactTile that used to live in the grid —
// contact info is identity-level metadata, not a tile's worth of real
// estate. A sync-call-style profile reads better when this sits in the
// hero and the tiles are all operational.
//
// No data fetching here. The AM and engagement chips are small client-side
// pickers (edit in place — no trip to the brand editor or the Brief tool).

import Link from "next/link";
import { FilePlus2 } from "lucide-react";
import type { Brand } from "@/types/brand";
import { AmPicker } from "./am-picker";
import { EngagementPicker } from "@/components/dashboard/engagement-picker";

const BRIEF_TOOL_URL =
  process.env.BRIEF_TOOL_URL ?? "https://briefs.surroundingsgroup.com";

export function ClientHero({
  brand: b,
  logoCount,
  amOptions = [],
}: {
  brand: Brand;
  logoCount: number;
  amOptions?: string[];
}) {
  return (
    <header className="mb-4 border-b border-border/70 pb-4 md:mb-6 md:pb-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-5">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Client
          </div>
          <h1 className="mt-1 text-[1.75rem] font-semibold leading-tight tracking-tight text-foreground md:mt-1.5 md:text-[2.25rem]">
            {b.business_name}
          </h1>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
            <AmPicker brandId={b.id} current={b.account_manager ?? null} options={amOptions} />
            <EngagementPicker brandId={b.id} current={b.engagement_type ?? null} />
            {b.vertical ? (
              <span className="capitalize">{b.vertical.replace(/_/g, " ")}</span>
            ) : null}
          </div>
        </div>
        <div className="no-scrollbar -mx-4 flex items-center gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:overflow-visible md:px-0 [&>a]:h-10 [&>a]:flex-shrink-0 [&>a]:rounded-full [&>a]:px-4 [&>a]:text-[13px] md:[&>a]:h-auto md:[&>a]:rounded-md md:[&>a]:px-3 md:[&>a]:text-[12px]">
          <a
            href={`${BRIEF_TOOL_URL}/?client=${encodeURIComponent(b.business_name)}&request=1`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-[12px] font-medium text-background transition-opacity hover:opacity-90"
          >
            <FilePlus2 className="h-3.5 w-3.5" />
            New project request
          </a>
          <Link
            href={`/brand/${b.id}?from=client`}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-panel px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-secondary"
          >
            Brand assets
            {logoCount > 0 ? (
              <span className="text-[10px] text-muted-foreground">{logoCount}</span>
            ) : null}
          </Link>
          {b.share_token ? (
            <a
              href={`/share/${b.share_token}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-panel px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-secondary"
            >
              Guidelines
            </a>
          ) : null}
        </div>
      </div>
    </header>
  );
}
