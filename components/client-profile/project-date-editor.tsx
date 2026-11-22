"use client";
// Inline shoot-date editor on a Projects row. Reads like the row's
// existing date text until clicked; opens a bare native date picker,
// commits on change, falls back visually if Monday rejects.
//
// Keeps the design quiet — the row doesn't change height, the control
// is just the date text styled as a hover-dashed underline, mimicking
// Google Sheets inline editing.

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { changeProjectShootDateAction } from "@/app/(internal)/client/[id]/project-actions";

function formatShoot(dateIso: string | null): string {
  if (!dateIso) return "Set date";
  const d = new Date(dateIso);
  if (isNaN(d.getTime())) return "Set date";
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const hasTime = /T\d{2}:\d{2}/.test(dateIso);
  if (!hasTime) return date;
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time}`;
}

export function ProjectDateEditor({
  brandId,
  projectId,
  projectName,
  currentIso,
}: {
  brandId: string;
  projectId: string;
  projectName: string;
  currentIso: string | null;
}) {
  const [isoLocal, setIsoLocal] = useState(currentIso);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  // YYYY-MM-DD for the date input value.
  const value = isoLocal
    ? (isoLocal.length >= 10 ? isoLocal.slice(0, 10) : "")
    : "";

  function commit(newDate: string) {
    const previous = isoLocal;
    const nextIso = newDate ? `${newDate}T12:00:00` : null;
    setIsoLocal(nextIso); // optimistic
    startTransition(async () => {
      const res = await changeProjectShootDateAction({
        brandId,
        projectId,
        projectName,
        newDate,
      });
      if (!res.ok) {
        setIsoLocal(previous);
        toast.error(`Couldn't update shoot date: ${res.error}`);
      } else {
        toast.success(newDate ? `Shoot date → ${newDate}` : "Shoot date cleared");
      }
    });
  }

  return (
    <span className="relative inline-flex items-center">
      <span
        className={`cursor-pointer border-b border-dashed border-transparent transition-colors hover:border-foreground/30 ${pending ? "opacity-60" : ""}`}
        onClick={() => inputRef.current?.showPicker?.()}
      >
        {formatShoot(isoLocal)}
      </span>
      <input
        ref={inputRef}
        type="date"
        value={value}
        onChange={(e) => commit(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        aria-label="Shoot date"
      />
    </span>
  );
}
