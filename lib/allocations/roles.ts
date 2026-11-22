// Canonical role list for the Allocation editor. Kept in sync with
// the Monday Allocation Setup template's Team column so an AM's
// roster entries match what Operations tracks on their end.

export const ALLOCATION_ROLES = [
  "AM",
  "Creative",
  "Social",
  "Graphic",
  "Strategy",
  "Production",
  "Ops",
  "Other",
] as const;

export type AllocationRole = (typeof ALLOCATION_ROLES)[number];

// Normalize anything that came from the Monday template to the
// canonical label above, so free-text values like "social" or
// "strategy / planning" fall through cleanly.
export function normalizeRole(raw: string | null | undefined): AllocationRole | null {
  if (!raw) return null;
  const t = raw.trim().toLowerCase();
  for (const r of ALLOCATION_ROLES) {
    if (r.toLowerCase() === t) return r;
  }
  if (t.startsWith("am")) return "AM";
  if (t.startsWith("social")) return "Social";
  if (t.startsWith("creat")) return "Creative";
  if (t.startsWith("graph")) return "Graphic";
  if (t.startsWith("strat")) return "Strategy";
  if (t.startsWith("prod")) return "Production";
  if (t.startsWith("op")) return "Ops";
  return "Other";
}
