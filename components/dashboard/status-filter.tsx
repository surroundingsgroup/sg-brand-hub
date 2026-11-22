"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import type { BrandStatus } from "@/types/brand";

const OPTIONS: Array<{ value: "all" | BrandStatus; label: string }> = [
  { value: "all", label: "All" },
  { value: "submitted", label: "Submitted" },
  { value: "in_review", label: "In Review" },
  { value: "approved", label: "Approved" },
  { value: "archived", label: "Archived" },
];

export function StatusFilter() {
  const searchParams = useSearchParams();
  const current = searchParams.get("status") ?? "all";

  return (
    <div className="no-scrollbar -mx-4 flex items-center gap-5 overflow-x-auto border-b border-border px-4 md:mx-0 md:gap-6 md:px-0">
      {OPTIONS.map((opt) => {
        const isActive = current === opt.value;
        const params = new URLSearchParams(searchParams);
        if (opt.value === "all") params.delete("status");
        else params.set("status", opt.value);
        return (
          <Link
            key={opt.value}
            href={`?${params.toString()}`}
            className={cn(
              "relative flex-shrink-0 whitespace-nowrap py-3 text-sm font-medium transition-colors",
              isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {opt.label}
            {isActive && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-accent" />
            )}
          </Link>
        );
      })}
    </div>
  );
}
