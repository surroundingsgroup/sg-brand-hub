"use client";

// Interactive layer for the Team Directory — skills search filter.
// Kept in a sibling client component so the server shell can stay
// data-only.

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { PersonRow, type DirectoryRow } from "./person-row";

export function TeamDirectoryList({
  rows,
  amIds,
  myEmail,
}: {
  rows: DirectoryRow[];
  amIds: string[];
  myEmail: string | null;
}) {
  const [q, setQ] = useState("");
  const amSet = useMemo(() => new Set(amIds), [amIds]);
  const needle = q.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!needle) return rows;
    return rows.filter((r) => {
      const p = r.profile;
      const hay = [
        r.name,
        p?.title,
        p?.department,
        p?.location,
        p?.bio,
        p?.fun_fact,
        ...(p?.skills ?? []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [rows, needle]);

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name, title, skill, department…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
          />
        </div>
        <span className="text-[11px] text-muted-foreground">
          {filtered.length} of {rows.length}
        </span>
      </div>
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-panel/50 p-10 text-center text-[12.5px] text-muted-foreground">
          No one matches &ldquo;{q}&rdquo;.
        </div>
      ) : (
        <ul className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border/70 bg-panel">
          {filtered.map((r) => (
            <PersonRow
              key={r.email}
              r={r}
              isAm={r.monday_id ? amSet.has(r.monday_id) : false}
              isMe={myEmail === r.email}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
