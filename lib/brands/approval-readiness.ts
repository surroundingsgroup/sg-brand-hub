// Pre-approve checklist logic. Used by both the editor page (to render the
// missing-items panel) and the Approve button (to know whether to gate or
// pass through).
//
// "Required" items block approval entirely — without them, the downstream
// flow (Monday sync, share page, PDF) would either fail or produce a broken
// artifact.
//
// "Recommended" items are surfaced as warnings on the editor but do NOT
// block approval.

import type { Brand, BrandLogo } from "@/types/brand";

export type ChecklistItem = {
  /** Stable identifier for keying React lists + tests. */
  key: string;
  /** Short user-facing label. */
  label: string;
  /** Optional fix-it hint. */
  hint?: string;
  /** Editor tab the user should jump to to fix this. */
  tab: "overview" | "voice" | "visual" | "logos" | "creative" | "notes";
  /** Whether this item is currently satisfied. */
  done: boolean;
};

const trimBlank = (v: string | null | undefined) => !!v && v.trim().length > 0;

export function buildApprovalChecklist(
  brand: Brand,
  logos: BrandLogo[]
): { required: ChecklistItem[]; videoAssets: ChecklistItem[]; recommended: ChecklistItem[] } {
  // Treat .ai/.eps/.pdf reference files as "no image logo" — those don't
  // render on the share page or PDF.
  const imageLogos = logos.filter((l) => l.logo_type !== "reference");
  const hasPrimaryColor = (brand.colors ?? []).some((c) => c.role === "primary");
  const hasOverview = trimBlank(brand.overview_polished) || trimBlank(brand.overview_client_raw);

  const required: ChecklistItem[] = [
    {
      key: "account_manager",
      label: "Account manager assigned",
      hint: "Required so the Monday All Projects parent gets a person.",
      tab: "overview",
      done: trimBlank(brand.account_manager),
    },
    {
      key: "image_logo",
      label: "At least one image logo uploaded",
      hint: "PDF/AI/EPS don't render on the share page — needs a PNG/JPG/SVG.",
      tab: "logos",
      done: imageLogos.length > 0,
    },
    {
      key: "primary_color",
      label: "At least one primary color",
      hint: "Used in the editorial PDF + share page header.",
      tab: "visual",
      done: hasPrimaryColor,
    },
    {
      key: "overview",
      label: "Brand overview written",
      hint: "The share page header pulls from this.",
      tab: "overview",
      done: hasOverview,
    },
  ];

  // What the video team builds from (end cards and lower thirds, 16x9 and
  // 9x16): clean logo files, the full palette and type, where the end card
  // points people, and the sound. Not required to approve, but the video
  // assets request is only as good as this.
  const ext = (l: BrandLogo) => (l.file_name ?? "").split(".").pop()?.toLowerCase() ?? "";
  const b = brand as Brand & { youtube?: string | null; tiktok?: string | null; linkedin?: string | null };
  const videoAssets: ChecklistItem[] = [
    {
      key: "transparent_logo",
      label: "Logo with a transparent background (PNG or SVG)",
      tab: "logos",
      done: imageLogos.some((l) => ["png", "svg"].includes(ext(l))),
    },
    {
      key: "logo_versions",
      label: "Logo versions for light and dark backgrounds",
      hint: "Two or more image logos.",
      tab: "logos",
      done: imageLogos.length >= 2,
    },
    {
      key: "vector_logo",
      label: "Vector logo file (AI, EPS, SVG or PDF)",
      tab: "logos",
      done: logos.some((l) => ["ai", "eps", "svg", "pdf"].includes(ext(l))),
    },
    {
      key: "secondary_color",
      label: "Secondary color",
      tab: "visual",
      done: (brand.colors ?? []).some((c) => c.role === "secondary"),
    },
    {
      key: "fonts",
      label: "Primary font",
      tab: "visual",
      done: (brand.fonts ?? []).some((f) => f.role === "primary") || (brand.fonts ?? []).length > 0,
    },
    {
      key: "website",
      label: "Website URL",
      hint: "Goes on the end cards.",
      tab: "overview",
      done: trimBlank(brand.website),
    },
    {
      key: "social",
      label: "A social handle",
      hint: "Instagram, Facebook, YouTube, TikTok or LinkedIn.",
      tab: "overview",
      done: [b.instagram, b.facebook, b.youtube, b.tiktok, b.linkedin].some((v) => trimBlank(v)),
    },
    {
      key: "tagline",
      label: "Tagline",
      tab: "overview",
      done: trimBlank(brand.tagline),
    },
    {
      key: "music",
      label: "Music direction",
      tab: "voice",
      done: trimBlank(brand.music_notes),
    },
    {
      key: "dropbox",
      label: "Dropbox folder",
      hint: "Where the video team saves the finished assets.",
      tab: "overview",
      done: trimBlank(brand.dropbox_folder_url),
    },
  ];

  const recommended: ChecklistItem[] = [
    {
      key: "vertical",
      label: "Vertical / industry",
      tab: "overview",
      done: trimBlank(brand.vertical),
    },
    {
      key: "brand_voice",
      label: "Brand voice description",
      tab: "voice",
      done: trimBlank(brand.brand_voice),
    },
    {
      key: "audience_type",
      label: "Target audience",
      tab: "voice",
      done: trimBlank(brand.audience_type),
    },
    {
      key: "look_and_feel",
      label: "Look & feel description",
      tab: "creative",
      done: trimBlank(brand.look_and_feel),
    },
  ];

  return { required, videoAssets, recommended };
}

/** Brand kit status for the onboarding checklist: required + video asset items. */
export function brandKitStatus(brand: Brand, logos: BrandLogo[]): { done: number; total: number; missing: string[] } {
  const { required, videoAssets } = buildApprovalChecklist(brand, logos);
  const all = [...required, ...videoAssets];
  return {
    done: all.filter((i) => i.done).length,
    total: all.length,
    missing: all.filter((i) => !i.done).map((i) => i.label),
  };
}

export function isReadyToApprove(brand: Brand, logos: BrandLogo[]): boolean {
  const { required } = buildApprovalChecklist(brand, logos);
  return required.every((item) => item.done);
}
