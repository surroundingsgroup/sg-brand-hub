"use client";
// Dropdown-ish status chip on a Projects-tile row. Replaces the static
// StatusChip. The AM clicks the chip → picks a new Monday "Project
// Status" label → the server action fires the Monday mutation and
// logs the change in the brand's activity log. Optimistic UI so the
// chip updates immediately; reverts if Monday rejects.

import { useState, useTransition } from "react";
import { Check, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { changeProjectStatusAction } from "@/app/(internal)/client/[id]/project-actions";

function chipClass(label: string | null): string {
  const lower = (label ?? "").toLowerCase();
  if (lower.includes("completed") || lower.includes("done")) {
    return "bg-emerald-100 text-emerald-800";
  }
  if (lower.includes("hold") || lower.includes("intake") || lower.includes("waiting")) {
    return "bg-secondary text-foreground/80";
  }
  return "bg-accent-soft text-accent-foreground";
}

export function ProjectStatusPicker({
  brandId,
  projectId,
  projectName,
  currentStatus,
  labels,
}: {
  brandId: string;
  projectId: string;
  projectName: string;
  currentStatus: string | null;
  labels: string[];
}) {
  const [status, setStatus] = useState(currentStatus);
  const [pending, startTransition] = useTransition();

  function pick(label: string) {
    if (label === status || pending) return;
    const previous = status;
    setStatus(label); // optimistic
    startTransition(async () => {
      const res = await changeProjectStatusAction({
        brandId,
        projectId,
        projectName,
        newLabel: label,
      });
      if (!res.ok) {
        setStatus(previous);
        toast.error(`Couldn't update status: ${res.error}`);
      } else {
        toast.success(`Status → ${label}`);
      }
    });
  }

  if (labels.length === 0) {
    // No labels loaded — fall back to a plain read-only chip so the
    // row still looks right.
    return status ? (
      <span
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${chipClass(status)}`}
      >
        {status}
      </span>
    ) : null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={pending}
          onClick={(e) => e.preventDefault()}
          className={`tap-target inline-flex items-center gap-0.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide transition-opacity disabled:opacity-60 ${chipClass(status)}`}
        >
          {status ?? "Set status"}
          <ChevronDown className="h-2.5 w-2.5 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {labels.map((label) => (
          <DropdownMenuItem
            key={label}
            onClick={() => pick(label)}
            className="flex items-center justify-between gap-2 text-xs"
          >
            <span>{label}</span>
            {status === label ? <Check className="h-3 w-3 text-foreground/70" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
