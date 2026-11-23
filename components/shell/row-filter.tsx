"use client";

// A filter bar for a list or table the server already rendered. It hides rows
// in place, so the pages stay server-rendered.
//
//   <RowFilter scope="accounts" groups={[...]} />
//   <ul data-filter-scope="accounts">
//     <li data-filter-row data-filter-text="client name am" data-filter-level="red">...
//
// Each group filters on the row attribute `data-filter-<key>` (a row may hold
// several values, space-separated). The search box matches `data-filter-text`.

import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type FilterGroup = { key: string; label: string; options: { value: string; label: string }[] };

export function RowFilter({ scope, placeholder = "Search", groups = [] }: { scope: string; placeholder?: string; groups?: FilterGroup[] }) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [counts, setCounts] = useState<{ shown: number; total: number } | null>(null);

  useEffect(() => {
    const root = document.querySelectorAll<HTMLElement>(`[data-filter-scope="${scope}"]`);
    const rows = Array.from(root).flatMap((r) => Array.from(r.querySelectorAll<HTMLElement>("[data-filter-row]")));
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const row of rows) {
      const text = (row.dataset.filterText ?? row.textContent ?? "").toLowerCase();
      const okText = words.every((w) => text.includes(w));
      const okGroups = Object.entries(picked).every(([key, value]) => !value || (row.getAttribute(`data-filter-${key}`) ?? "").split(/\s+/).includes(value));
      const show = okText && okGroups;
      row.hidden = !show;
      if (show) shown++;
    }
    root.forEach((r) => r.querySelectorAll<HTMLElement>("[data-filter-empty]").forEach((el) => (el.hidden = shown > 0 || rows.length === 0)));
    setCounts({ shown, total: rows.length });
  }, [q, picked, scope]);

  const active = !!q || Object.values(picked).some(Boolean);
  return (
    <div className="mb-4 flex flex-col gap-2.5 rounded-xl border border-border/70 bg-panel p-3 md:flex-row md:flex-wrap md:items-center">
      <label className="relative flex min-w-[220px] flex-1 items-center">
        <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-lg border border-border bg-canvas py-1.5 pl-8 pr-8 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-foreground/50"
        />
        {q ? (
          <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="absolute right-2 rounded p-0.5 text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </label>
      {groups.map((g) => (
        <div key={g.key} className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{g.label}</span>
          {[{ value: "", label: "All" }, ...g.options].map((o) => {
            const on = (picked[g.key] ?? "") === o.value;
            return (
              <button
                key={o.value || "all"}
                type="button"
                onClick={() => setPicked((cur) => ({ ...cur, [g.key]: o.value }))}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors",
                  on ? "border-foreground bg-foreground text-background" : "border-border bg-canvas text-foreground hover:bg-secondary"
                )}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      ))}
      <div className="flex items-center gap-2 text-[12px] text-muted-foreground md:ml-auto">
        {counts ? <span>{counts.shown === counts.total ? `${counts.total} shown` : `${counts.shown} of ${counts.total}`}</span> : null}
        {active ? (
          <button
            type="button"
            onClick={() => {
              setQ("");
              setPicked({});
            }}
            className="font-medium text-foreground underline-offset-2 hover:underline"
          >
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}
