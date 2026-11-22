// Team profile helpers shared between the directory + profile pages.

export type TeamProfile = {
  id: string;
  email: string;
  name: string | null;
  title: string | null;
  department: string | null;
  employment_type: "full_time" | "contractor" | "part_time" | "other" | null;
  phone: string | null;
  pronouns: string | null;
  slack_handle: string | null;
  time_zone: string | null;
  location: string | null;
  birthday: string | null;
  start_date: string | null;
  bio: string | null;
  fun_fact: string | null;
  skills: string[] | null;
  avatar_url: string | null;
  manager_email: string | null;
  created_at: string;
  updated_at: string;
};

export type DirectoryPerson = {
  email: string;
  name: string;
  monday_id: string | null;
  // Profile is null if the person hasn't filled anything in yet.
  profile: TeamProfile | null;
};

export const DEPARTMENTS = [
  "Account Management",
  "Creative",
  "Social",
  "Production",
  "Operations",
  "Strategy",
  "Leadership",
  "Other",
] as const;

export const EMPLOYMENT_TYPES = [
  { value: "full_time", label: "Full-time" },
  { value: "contractor", label: "Contractor" },
  { value: "part_time", label: "Part-time" },
  { value: "other", label: "Other" },
] as const;

/** MM-DD from a YYYY-MM-DD date string, or null. Used for birthday /
 *  anniversary math where the year is either unknown or irrelevant. */
export function mmdd(iso: string | null): string | null {
  if (!iso || iso.length < 10) return null;
  return iso.slice(5, 10);
}

/** How many days until the next occurrence of this MM-DD, ignoring year. */
export function daysUntilNextOccurrence(iso: string | null, now = new Date()): number | null {
  if (!iso) return null;
  const [m, d] = iso.slice(5, 10).split("-").map(Number);
  if (!m || !d) return null;
  const year = now.getFullYear();
  let next = new Date(year, m - 1, d);
  const today = new Date(year, now.getMonth(), now.getDate());
  if (next < today) next = new Date(year + 1, m - 1, d);
  return Math.round((next.getTime() - today.getTime()) / 86400000);
}

/** Pretty "Dec 14" from YYYY-MM-DD. */
export function fmtMMDD(iso: string | null): string | null {
  if (!iso || iso.length < 10) return null;
  const [, m, d] = iso.split("-").map(Number);
  if (!m || !d) return null;
  const date = new Date(2000, m - 1, d);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Years since start_date. Returns 0 if invalid or in the future. */
export function yearsSince(iso: string | null, now = new Date()): number {
  if (!iso || iso.length < 10) return 0;
  const start = new Date(iso + "T12:00:00");
  if (isNaN(start.getTime())) return 0;
  const diffMs = now.getTime() - start.getTime();
  if (diffMs <= 0) return 0;
  return Math.floor(diffMs / (365.25 * 86400 * 1000));
}
