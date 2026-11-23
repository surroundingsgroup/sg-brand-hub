// The option lists on the Monday Deals board (kept in step with the website's
// Quick Add Deal form). Plain data, safe to import in the browser.

export const DEAL_BRANDS = ["Surroundings Group", "Nautical Network", "Hive Digital Marketing"] as const;
export const DEAL_SOURCES = [
  "Referral", "Returning Client", "Current Retainer / Add-On", "Win Back", "Network", "In-Person", "Event / Show", "Cold Call", "Call In",
  "Text / WhatsApp", "Email — Inbound", "Email — Outbound", "Website Inbound", "LinkedIn", "Instagram — Nautical", "Instagram — Surroundings",
  "IG DM — Inbound", "IG DM — Outbound",
] as const;
export const DEAL_VERTICALS = [
  "Marine", "Real Estate & Development", "Multifamily", "Private Aviation", "Resorts & Travel", "Hospitality & Experiences", "Automotive", "Luxury Goods", "Other",
] as const;
