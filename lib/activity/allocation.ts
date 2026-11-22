// Rough creator-hour allocation for a client's active month, estimated
// from Monday All Projects project types. The actual per-deliverable
// hours live on Monday sub-items (populated by the Brief Tool via
// src/lib/time-allocation.ts) — we deliberately don't crawl sub-items
// here to keep the Hub profile load fast.
//
// Totals here are indicative: they're accurate enough to flag "this
// month has already eaten 160% of the retainer hours" or "we've got a
// big month coming" without pretending to be payroll-grade. Tune the
// per-type numbers below as the actuals come in.

import type { HubProject } from "@/lib/monday/projects";

// Average creator hours (shoot + edit + organize + social cut) per
// project type at a 1-day shoot. Derived from brief-tool's
// time-allocation.ts totals rounded to clean numbers. Edit-only
// projects get a lower band since there's no field day.
const HOURS_BY_TYPE: Record<string, number> = {
  "Professional Content Shoot": 15,
  "Standard Listing": 10,
  "Micro Content Shoot": 10,
  "Event Coverage Package": 12,
  "Lifestyle / Charter Package": 15,
  "Core SMM Content Package": 12,
  "Social Media Content Session": 10,
  "Professional Showcase Package": 15,
  "Edit Request": 5,
  "Video Assets": 8,
  "Graphic Design": 4,
  "Custom / Other": 8,
};

const DEFAULT_HOURS = 8;

export type AllocationBucket = {
  projectType: string;
  count: number;
  estimatedHours: number;
};

export type AllocationSummary = {
  estimatedHoursThisMonth: number;
  byType: AllocationBucket[];
  projectsThisMonth: number;
};

export function estimateAllocation(projects: HubProject[]): AllocationSummary {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  // Include projects whose SHOOT DATE sits inside this calendar month,
  // or whose row was last touched this month (catches edit-only
  // projects that may never have a shoot date).
  const relevant = projects.filter((p) => {
    const shoot = p.shootDateIso ? new Date(p.shootDateIso) : null;
    if (shoot && !isNaN(shoot.getTime()) && shoot >= monthStart && shoot < monthEnd) {
      return true;
    }
    const type = p.projectType ?? "";
    if (type === "Edit Request" || type === "Graphic Design" || type === "Video Assets") {
      const upd = new Date(p.updatedAt);
      if (!isNaN(upd.getTime()) && upd >= monthStart && upd < monthEnd) return true;
    }
    return false;
  });

  const bucketMap = new Map<string, AllocationBucket>();
  let total = 0;
  for (const p of relevant) {
    const type = p.projectType ?? "Custom / Other";
    const perHours = HOURS_BY_TYPE[type] ?? DEFAULT_HOURS;
    const existing = bucketMap.get(type) ?? { projectType: type, count: 0, estimatedHours: 0 };
    existing.count += 1;
    existing.estimatedHours += perHours;
    bucketMap.set(type, existing);
    total += perHours;
  }

  return {
    estimatedHoursThisMonth: total,
    byType: [...bucketMap.values()].sort((a, b) => b.estimatedHours - a.estimatedHours),
    projectsThisMonth: relevant.length,
  };
}
