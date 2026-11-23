// Scope & contract shape — one blob on brands.scope (JSONB column).
// Added 2026-11-20, extended 2026-11-22 (services, term, production,
// deliverables + post-production + guarantees). Shaped so the per-channel
// quota mirrors SocialDesk's profile.quotas, which lets the delivered-vs-owed
// readout reuse the same counts without a translation layer.
//
// Everything is optional and additive — older scope blobs keep working.

// ── Services (what the retainer covers) ───────────────────────────────────────
export const SERVICE_TYPES = [
  "content",
  "social_media",
  "paid_media",
  "website",
  "events",
] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];
export const SERVICE_LABELS: Record<ServiceType, string> = {
  content: "Content Retainer",
  social_media: "Social Media Management",
  paid_media: "Paid Media & Ads",
  website: "Website",
  events: "Events",
};

// Channels available under Social Media Management (not every retainer runs all).
export const SMM_CHANNELS = [
  "Instagram",
  "Facebook",
  "YouTube",
  "TikTok",
  "LinkedIn",
  "Google Business",
] as const;

// ── Term ──────────────────────────────────────────────────────────────────────
export const CONTRACT_TERMS = ["monthly", "3mo", "6mo", "12mo", "custom"] as const;
export type ContractTerm = (typeof CONTRACT_TERMS)[number];
export const TERM_LABELS: Record<ContractTerm, string> = {
  monthly: "Month-to-month",
  "3mo": "3 months",
  "6mo": "6 months",
  "12mo": "12 months",
  custom: "Custom",
};
// Fixed-length terms → month count (monthly/custom are open-ended / manual).
export const TERM_MONTHS: Partial<Record<ContractTerm, number>> = {
  "3mo": 3,
  "6mo": 6,
  "12mo": 12,
};

export const BILLING_FREQUENCIES = ["monthly", "quarterly", "annual"] as const;
export type BillingFrequency = (typeof BILLING_FREQUENCIES)[number];
export const BILLING_LABELS: Record<BillingFrequency, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual (upfront)",
};

// ── Production cadence ────────────────────────────────────────────────────────
export const SHOOT_CADENCES = [
  "weekly",
  "bi-weekly",
  "monthly",
  "bi-monthly",
  "quarterly",
  "per-event",
  "ad-hoc",
] as const;
export type ShootCadence = (typeof SHOOT_CADENCES)[number];
export const CADENCE_LABELS: Record<ShootCadence, string> = {
  weekly: "Weekly",
  "bi-weekly": "Bi-weekly",
  monthly: "Monthly",
  "bi-monthly": "Bi-monthly (every 2 months)",
  quarterly: "Quarterly",
  "per-event": "Per event",
  "ad-hoc": "Ad-hoc",
};

export type ScopeChannel = {
  name: string; // "Instagram", "Facebook", "YouTube", ...
  inFeed?: number; // monthly minimum in-feed posts
  stories?: number; // monthly minimum stories
};

// A single contracted deliverable line, e.g. { label: "Main Video 30-60s", qty: "1" }
// or { label: "Edited Photos", qty: "15-30" }. qty is free text to allow ranges.
export type DeliverableLine = {
  label: string;
  qty?: string;
};

export type BrandScope = {
  // Services the retainer covers
  services?: ServiceType[];

  // Social Media Management: which channels + per-channel monthly counts
  channels?: ScopeChannel[];

  // Term & dates
  term?: ContractTerm;
  start_date?: string; // YYYY-MM-DD
  end_date?: string;
  renewal_date?: string;
  auto_renew?: boolean;
  // Length of each renewal term in months, when it differs from the span
  // between Start and End: a 6-month first term that renews for 12, or a
  // record that keeps the ORIGINAL start beside the CURRENT end (the way the
  // Monday All Accounts board shows a contract that has already renewed).
  renewal_months?: number;

  // Production
  shoot_cadence?: ShootCadence;
  shoots_per_period?: number; // how many shoots per cadence period
  shoot_day_hours?: number; // standard shoot-day length (hours)
  // Shared shoot pool: brand id of another client covered by the SAME agreement
  // (e.g. Solana + Ryan Hughes Design). When set, both clients' shoots are
  // counted together against the combined quota.
  pool_with?: string;

  // Deliverables (contracted outputs) + post-production + guarantees
  deliverables?: DeliverableLine[]; // per-shoot / monthly content outputs
  post_production?: DeliverableLine[]; // editing / repurposing outputs
  guarantees?: string; // per-client guarantee (e.g. Solana: shoot/mo or edits)

  // Commercials
  retainer_amount?: number; // monthly $
  billing_frequency?: BillingFrequency;
  monthly_hours?: number; // creator/editor hours allotted per month

  notes?: string; // internal only

  // Set by the app, not the form: this client's row on the Monday "All
  // Accounts" board, where the contract dates are copied (lib/scope/board-sync.ts).
  monday_account_item_id?: string;
  // The client's name in SocialDesk, only when it differs from the name here.
  // Unused since the names were unified (2026-11-22); kept as the escape hatch.
  socialdesk_client?: string;
  // The agreement file (Monday asset id, All Accounts board) this scope was
  // last checked against. A newer file on the row means a new agreement.
  agreement_asset_id?: string;
  // A scope drafted from a newly uploaded agreement, waiting for the account
  // manager to check and save (lib/scope/agreement.ts).
  pending_draft?: ScopeDraft;
};

// A first pass at the scope, read from the signed agreement. Never the
// agreement itself: no file, no fees, only the working scope.
export type ScopeDraft = {
  scope: BrandScope; // the contract fields the reader found, nothing else
  check: string[]; // what the account manager should look at before saving
  file: string; // the agreement's file name on the board
  asset_id: string;
  uploaded_at?: string; // YYYY-MM-DD
  drafted_at: string; // ISO
};

// Keys the app keeps inside the scope blob that are not the contract.
const APP_SCOPE_KEYS = new Set(["monday_account_item_id", "socialdesk_client", "agreement_asset_id", "pending_draft"]);

/** True when somebody has actually entered a scope (app bookkeeping does not count). */
export function scopeHasContent(s: BrandScope | null | undefined): s is BrandScope {
  return !!s && Object.keys(s).some((k) => !APP_SCOPE_KEYS.has(k));
}

// Derive End + Renewal from Start + a fixed-length term. Month-to-month and
// Custom return nothing (open-ended / hand-entered). End is the last day of the
// term; Renewal is the day after.
export function computeTermDates(
  start: string | undefined,
  term: ContractTerm | undefined
): { end?: string; renewal?: string } {
  if (!start || !term) return {};
  const months = TERM_MONTHS[term];
  if (!months) return {}; // monthly / custom
  const d = new Date(start + "T12:00:00");
  if (isNaN(d.getTime())) return {};
  const end = new Date(d);
  end.setMonth(end.getMonth() + months);
  end.setDate(end.getDate() - 1);
  const renewal = new Date(end);
  renewal.setDate(renewal.getDate() + 1);
  const fmt = (x: Date) => x.toISOString().slice(0, 10);
  return { end: fmt(end), renewal: fmt(renewal) };
}
