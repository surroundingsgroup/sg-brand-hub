"use client";

// The floating "listening" pill: two pulsing dots, a live level meter that
// moves with your voice, the words as they are heard, the elapsed time and
// a stop button. Sits at the bottom of the screen while dictation is on.

import { useEffect, useState } from "react";
import { Square } from "lucide-react";
import type { DictationMode } from "./use-dictation";

const BARS = 18;

export function DictationPill({
  mode,
  level,
  interim,
  startedAt,
  onStop,
}: {
  mode: DictationMode;
  level: number;
  interim: string;
  startedAt: number | null;
  onStop: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const secs = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2 px-4">
      {interim ? (
        <div className="pointer-events-none max-w-xl truncate rounded-2xl bg-[#0F0F0F]/85 px-4 py-2 text-[13px] text-[#F7F4F0]/90 shadow-lg backdrop-blur">
          {interim}
        </div>
      ) : null}
      <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-[#0F0F0F] py-2 pl-4 pr-2 text-[#F7F4F0] shadow-[0_10px_30px_-8px_rgba(0,0,0,0.45)]">
        <span className="flex items-center gap-1" aria-hidden>
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#FFBD83]" />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#FFBD83] [animation-delay:300ms]" />
        </span>
        <span className="flex h-6 items-center gap-[3px]" aria-hidden>
          {Array.from({ length: BARS }).map((_, i) => {
            // A gentle wave shaped by the live level, so quiet still shows life.
            const wave = 0.35 + 0.65 * Math.abs(Math.sin((Date.now() / 140 + i * 0.7) % Math.PI));
            const h = Math.max(3, Math.round(4 + level * 20 * wave));
            return <span key={i} className="w-[3px] rounded-full bg-[#F7F4F0]/80 transition-[height] duration-100" style={{ height: h }} />;
          })}
        </span>
        <span className="text-[12px] tabular-nums text-[#F7F4F0]/60">
          {mode === "meeting" ? "Recording" : "Listening"} {clock}
        </span>
        <button
          type="button"
          onClick={onStop}
          className="flex items-center gap-1.5 rounded-full bg-[#F7F4F0]/10 px-3 py-1.5 text-[12px] font-semibold transition hover:bg-[#F7F4F0]/20"
          title="Stop (⌘D)"
        >
          <Square className="h-3 w-3 fill-current" />
          Stop
        </button>
      </div>
    </div>
  );
}
