// Shared card tile for the client profile page.
//
// Design: elevated card with hairline border + soft lift shadow + an
// icon chip in the header. Feels like a product dashboard widget
// rather than a flat brief page. Each tile reads as a self-contained
// unit at rest, and the whole surface lifts a touch on hover.

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function Tile({
  label,
  icon,
  sublabel,
  href,
  hrefLabel,
  hrefExternal = false,
  spans = 1,
  children,
  className,
  accent = "default",
}: {
  label: string;
  icon?: React.ReactNode;
  /** Optional one-line hint rendered under the label. */
  sublabel?: string;
  href?: string;
  hrefLabel?: string;
  hrefExternal?: boolean;
  /** Grid column spans on md+. 1 = default, 2 = wide. */
  spans?: 1 | 2;
  children: React.ReactNode;
  className?: string;
  /** Visual accent on the icon chip. "default" uses the amber accent;
   *  "neutral" is quieter for utility tiles like Internal notes. */
  accent?: "default" | "neutral";
}) {
  return (
    <section
      data-tile-label={label}
      className={cn(
        // Base: white panel, hairline border, subtle lift shadow.
        // tile-glow (globals.css): a soft stone gradient washes in on hover.
        "group/tile tile-glow relative flex flex-col rounded-2xl border border-border/60 bg-panel p-4 md:p-6",
        // Jump target for the phone section bar (clears top bar + chip row).
        "scroll-mt-[calc(6.75rem+env(safe-area-inset-top))] md:scroll-mt-20",
        "shadow-[0_1px_2px_rgba(16,10,0,0.04),0_8px_24px_-16px_rgba(16,10,0,0.08)]",
        "transition-all duration-200",
        // Hover: slightly stronger shadow + a darker hairline.
        "hover:border-foreground/25 hover:shadow-[0_2px_4px_rgba(16,10,0,0.04),0_12px_28px_-12px_rgba(16,10,0,0.12)]",
        spans === 2 && "md:col-span-2",
        className
      )}
    >
      <header className="mb-4 flex items-start justify-between gap-3 border-b border-border/50 pb-3.5">
        <div className="flex items-start gap-3 min-w-0">
          {icon ? (
            <span
              className={cn(
                "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg transition-colors",
                accent === "default"
                  ? "bg-accent-soft text-accent-foreground group-hover/tile:bg-accent/30"
                  : "bg-secondary text-foreground/60"
              )}
            >
              <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>
            </span>
          ) : null}
          <div className="min-w-0 pt-0.5">
            <div className="text-[12.5px] font-extrabold uppercase tracking-[0.13em] text-foreground">
              {label}
            </div>
            {sublabel ? (
              <div className="mt-0.5 truncate text-[10.5px] text-muted-foreground">
                {sublabel}
              </div>
            ) : null}
          </div>
        </div>
        {href ? (
          hrefExternal ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="tap-target inline-flex flex-shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              {hrefLabel ?? "Open"}
              <ArrowUpRight className="h-3 w-3" />
            </a>
          ) : (
            <Link
              href={href}
              className="tap-target inline-flex flex-shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              {hrefLabel ?? "Open"}
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          )
        ) : null}
      </header>
      <div className="flex-1">{children}</div>
    </section>
  );
}

export function TileEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-[72px] items-center justify-center rounded-lg border border-dashed border-border bg-secondary/20 p-4 text-center text-xs leading-relaxed text-muted-foreground">
      {children}
    </div>
  );
}
