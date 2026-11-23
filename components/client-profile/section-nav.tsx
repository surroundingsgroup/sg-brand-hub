"use client";
// Phone-only jump bar for the client page. The page is a long stack of tiles
// on a phone, so this pins a swipeable row of chips under the top bar — tap
// one to jump to that tile; the chip for the tile on screen stays lit.
//
// It discovers the tiles itself (every <section data-tile-label>), so it
// always matches whatever the page actually rendered.

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const SHORT: Record<string, string> = {
  "projects & briefs": "Projects",
  "scope & contract health": "Scope",
  "files & documents": "Files",
  "industry update": "Industry",
  "internal notes": "Notes",
  "activity feed": "Activity",
};

type Item = { id: string; label: string };

export function SectionNav() {
  const [items, setItems] = useState<Item[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sections = Array.from(document.querySelectorAll<HTMLElement>("section[data-tile-label]"));
    const found: Item[] = sections.map((el, i) => {
      const raw = el.dataset.tileLabel ?? "";
      if (!el.id) el.id = `tile-${i}`;
      return { id: el.id, label: SHORT[raw.toLowerCase()] ?? raw };
    });
    setItems(found);

    // Light the chip for the tile currently under the pinned bars: the last
    // tile whose top edge has scrolled past that line.
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = 150; // top bar + chip row + a little breathing room
      let current = sections[0]?.id ?? null;
      for (const el of sections) {
        if (el.getBoundingClientRect().top <= line) current = el.id;
        else break;
      }
      // At the very bottom, the last tile may never reach the line.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
        current = sections[sections.length - 1]?.id ?? current;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  // Keep the lit chip in view inside the swipeable row.
  useEffect(() => {
    if (!active || !rowRef.current) return;
    const chip = rowRef.current.querySelector<HTMLElement>(`[data-chip="${active}"]`);
    chip?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [active]);

  if (items.length < 3) return null;

  return (
    <div className="sticky top-[calc(3rem+env(safe-area-inset-top))] z-30 -mx-4 mb-3 border-b border-border/60 bg-canvas/95 backdrop-blur md:hidden">
      <div ref={rowRef} className="no-scrollbar flex gap-1.5 overflow-x-auto px-4 py-2">
        {items.map((it) => (
          <button
            key={it.id}
            type="button"
            data-chip={it.id}
            onClick={() => {
              document.getElementById(it.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
              setActive(it.id);
            }}
            className={cn(
              "flex h-9 flex-shrink-0 items-center whitespace-nowrap rounded-full border px-3.5 text-[13px] font-medium transition-colors active:opacity-70",
              active === it.id
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-panel text-muted-foreground"
            )}
          >
            {it.label}
          </button>
        ))}
      </div>
    </div>
  );
}
