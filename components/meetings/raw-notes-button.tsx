"use client";

// The raw dump behind a button on a saved meeting: it matters while writing,
// not after, so it opens in a side panel instead of taking half the page.

import { useEffect, useState } from "react";
import { FileText, X } from "lucide-react";

export function RawNotesButton({ notes }: { notes: string | null }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!notes?.trim()) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-4 py-2 text-[12.5px] font-medium text-foreground/85 transition-colors hover:border-foreground/40 hover:text-foreground"
      >
        <FileText className="h-3.5 w-3.5" />
        Raw notes
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-label="Raw notes">
          <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="absolute inset-0 bg-black/30 backdrop-blur-[1px]" />
          <aside className="relative flex h-full w-full max-w-lg flex-col border-l border-border bg-panel shadow-2xl">
            <header className="flex items-center justify-between border-b border-border/70 px-5 py-3.5">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Raw notes · {notes.length.toLocaleString()} chars
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Close raw notes"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/90">{notes}</p>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
