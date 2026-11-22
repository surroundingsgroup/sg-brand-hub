// Dashboard brand grid — clean cards, no colored chips. Just the
// business name as the lead, with a quiet meta row for AM + updated.
// Cards lift on hover. Accepts an optional `title` for grouped
// sections (Active Retainers / Other Clients).

import Link from "next/link";
import { formatRelativeDate } from "@/lib/utils";
import { VERTICAL_LABELS, type Brand } from "@/types/brand";
import { cn } from "@/lib/utils";
import { EngagementPicker } from "./engagement-picker";

export function BrandList({
  brands,
  title,
  subtitle,
  emphasis = "default",
}: {
  brands: Brand[];
  title?: string;
  subtitle?: string;
  /** "primary" = retainers (headline tier), "default" = everything else. */
  emphasis?: "primary" | "default";
}) {
  if (brands.length === 0 && !title) {
    return (
      <div className="rounded-2xl border border-border/60 bg-panel p-10 text-center shadow-[0_1px_2px_rgba(16,10,0,0.04),0_8px_24px_-16px_rgba(16,10,0,0.08)]">
        <h3 className="text-base font-semibold">No brands yet</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          When a client submits the intake form it&rsquo;ll show up here.
        </p>
      </div>
    );
  }

  return (
    <section className={emphasis === "primary" ? "mb-10" : "mb-10"}>
      {title ? (
        <header className="mb-4 flex items-baseline justify-between gap-3">
          <div className="flex items-baseline gap-2.5">
            <h2
              className={cn(
                "font-semibold tracking-tight",
                emphasis === "primary"
                  ? "text-[18px] text-foreground"
                  : "text-[14px] text-foreground/80"
              )}
            >
              {title}
            </h2>
            <span className="text-[11px] font-mono tabular-nums text-muted-foreground">
              {brands.length}
            </span>
          </div>
          {subtitle ? (
            <span className="text-[11px] text-muted-foreground">
              {subtitle}
            </span>
          ) : null}
        </header>
      ) : null}
      {brands.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-panel/40 p-6 text-center text-[12.5px] text-muted-foreground">
          Nothing here yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {brands.map((brand) => (
            <BrandCard key={brand.id} brand={brand} emphasis={emphasis} />
          ))}
        </div>
      )}
    </section>
  );
}

function BrandCard({
  brand,
  emphasis,
}: {
  brand: Brand;
  emphasis: "primary" | "default";
}) {
  const amLabel = brand.account_manager?.trim();
  const vertical = brand.vertical ? VERTICAL_LABELS[brand.vertical] : null;

  return (
    <Link
      href={`/client/${brand.id}`}
      className={cn(
        "group relative flex flex-col gap-3 rounded-2xl border border-border/60 bg-panel p-4 active:scale-[0.99] md:p-5",
        "shadow-[0_1px_2px_rgba(16,10,0,0.04),0_8px_24px_-16px_rgba(16,10,0,0.08)]",
        "transition-all duration-200",
        "hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-[0_2px_4px_rgba(16,10,0,0.04),0_16px_32px_-12px_rgba(16,10,0,0.14)]"
      )}
    >
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-2">
          <h3
            className={cn(
              "line-clamp-2 min-w-0 flex-1 font-semibold leading-tight tracking-tight text-foreground",
              emphasis === "primary" ? "text-[16px]" : "text-[15px]"
            )}
          >
            {brand.business_name}
          </h3>
          <EngagementPicker brandId={brand.id} current={brand.engagement_type} />
        </div>
        {vertical ? (
          <p className="mt-1 truncate text-[11px] text-muted-foreground">
            {vertical}
          </p>
        ) : null}
      </div>

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border/50 pt-3 text-[11px]">
        <span className="text-muted-foreground">
          {amLabel ? (
            <>
              <span className="font-medium text-foreground/75">AM</span>
              <span className="mx-1 text-foreground/30">·</span>
              <span className="text-foreground/70">{amLabel}</span>
            </>
          ) : (
            <span className="italic text-amber-700">No AM assigned</span>
          )}
        </span>
        {brand.updated_at ? (
          <span className="whitespace-nowrap text-muted-foreground">
            {formatRelativeDate(brand.updated_at)}
          </span>
        ) : null}
      </div>
    </Link>
  );
}
