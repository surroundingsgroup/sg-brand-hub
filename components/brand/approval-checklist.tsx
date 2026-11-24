"use client";
// Pre-approve checklist surfaced on the brand editor page. Renders two lists:
//   - Required: blocks Approve & Sync until all are done
//   - Recommended: shown for completeness but does NOT block
//
// Items are clickable and could in future deep-link to the right tab + field
// via state lifted up to the parent; for now they're status-only.

import { Check, AlertCircle, Circle } from "lucide-react";
import type { ChecklistItem } from "@/lib/brands/approval-readiness";

export function ApprovalChecklist({
  required,
  videoAssets = [],
  recommended,
  allRequiredDone,
}: {
  required: ChecklistItem[];
  /** What the video team needs for end cards and lower thirds. */
  videoAssets?: ChecklistItem[];
  recommended: ChecklistItem[];
  allRequiredDone: boolean;
}) {
  const missingRequired = required.filter((i) => !i.done);
  const missingVideo = videoAssets.filter((i) => !i.done);
  const missingRecommended = recommended.filter((i) => !i.done);

  // If everything required and recommended is satisfied, hide the panel
  // entirely — brand is ready to ship and we don't need to nag.
  if (allRequiredDone && missingVideo.length === 0 && missingRecommended.length === 0) {
    return (
      <div className="panel border-emerald-200 bg-emerald-50/50 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/30">
        <div className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
          <Check className="h-4 w-4" />
          Brand kit complete: ready to approve and to request video assets.
        </div>
      </div>
    );
  }

  return (
    <div className="panel p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold tracking-tight">Brand kit checklist</h3>
        {allRequiredDone ? (
          <span className="flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            <Check className="h-3.5 w-3.5" />
            Ready
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400">
            <AlertCircle className="h-3.5 w-3.5" />
            {missingRequired.length} required item{missingRequired.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <div className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Required to approve</div>
      <ul className="space-y-2">
        {required.map((item) => (
          <ChecklistRow key={item.key} item={item} variant="required" />
        ))}
      </ul>

      {videoAssets.length > 0 && (
        <>
          <div className="my-4 h-px bg-border" />
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">For video assets</span>
            <span className="text-[11px] text-muted-foreground">
              {missingVideo.length ? `${videoAssets.length - missingVideo.length} of ${videoAssets.length}` : "All set"}
            </span>
          </div>
          <ul className="space-y-2">
            {videoAssets.map((item) => (
              <ChecklistRow key={item.key} item={item} variant="required" />
            ))}
          </ul>
        </>
      )}

      {recommended.length > 0 && (
        <>
          <div className="my-4 h-px bg-border" />
          <div className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
            Recommended
          </div>
          <ul className="space-y-2">
            {recommended.map((item) => (
              <ChecklistRow key={item.key} item={item} variant="recommended" />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ChecklistRow({
  item,
  variant,
}: {
  item: ChecklistItem;
  variant: "required" | "recommended";
}) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {item.done ? (
        <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600 dark:text-emerald-400" />
      ) : variant === "required" ? (
        <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
      ) : (
        <Circle className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground/50" />
      )}
      <div className="flex-1">
        <div
          className={
            item.done
              ? "text-muted-foreground line-through decoration-muted-foreground/40"
              : "text-foreground"
          }
        >
          {item.label}
        </div>
        {!item.done && item.hint && (
          <div className="text-xs text-muted-foreground">{item.hint}</div>
        )}
      </div>
    </li>
  );
}
