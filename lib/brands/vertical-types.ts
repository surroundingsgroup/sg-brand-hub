// The type of business within a vertical: the same list as the "Type" column
// on the Monday Deals and Contacts boards, grouped by vertical so a client
// only picks from its own vertical's types. Stored on brands.vertical_type.

import type { BrandVertical } from "@/types/brand";

const MARINE = ["Dealer / Brokerage", "Boat / Yacht Builder", "Marina", "Charter Operator", "Yacht Management", "Service / Refit", "Marine Products"];
const REAL_ESTATE = ["Developer", "Developer / Builder", "Architect", "Interior Designer", "Brokerage / Agent", "Pool Builder", "Landscape / Outdoor", "Home Service Company"];
const OTHER = ["Creative Agency", "Finance / Wealth", "Professional Services", "Nonprofit", "Association", "Technology", "Home Service Company"];

export const VERTICAL_TYPES: Record<BrandVertical, string[]> = {
  marine: MARINE,
  real_estate: REAL_ESTATE,
  real_estate_development: REAL_ESTATE,
  luxury_real_estate: REAL_ESTATE,
  multifamily_residential: ["Property Management", "Owner / Operator", "Developer", "Amenity Provider"],
  private_aviation: ["Aircraft Dealer / Broker", "FBO", "Management Company", "MRO / Maintenance", "OEM / Manufacturer"],
  resort_travel: ["Resort", "Hotel", "Vacation Rental", "Travel Advisor", "Cruise / Yacht Charter", "Tourism Board / DMO"],
  hospitality: ["Restaurant", "Bar / Nightlife", "Event Venue", "Experience / Activity", "Catering", "Club / Membership"],
  automotive: ["Dealership", "Exotic / Luxury Rental", "Custom / Aftermarket", "Service / Detailing"],
  luxury_goods: ["Jewelry / Watches", "Fashion / Apparel", "Art / Gallery", "Wine & Spirits", "Home / Furnishings", "Retail / Boutique"],
  home_services: ["Home Service Company", "Landscape / Outdoor", "Pool Builder"],
  other: OTHER,
} as Record<BrandVertical, string[]>;

/** The types to pick from for a vertical (every list ends with "Other"). */
export function typesFor(vertical: string | null | undefined): string[] {
  const list = (vertical && VERTICAL_TYPES[vertical as BrandVertical]) || [...new Set(Object.values(VERTICAL_TYPES).flat())];
  return [...list, "Other"];
}
