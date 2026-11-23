import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/auth/domain";
import { extractBrandFromPdf } from "@/lib/anthropic/extract-pdf";
import { SELECTABLE_VERTICALS } from "@/types/brand";

// The unified list (same as the Monday Deals board).
const VALID_VERTICALS = new Set<string>(SELECTABLE_VERTICALS);

// Claude's PDF processing can take 30–60s for a multi-page doc.
export const maxDuration = 120;

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isEmailAllowed(user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (file.type !== "application/pdf") {
    return NextResponse.json({ error: "Must be a PDF" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let extracted;
  try {
    extracted = await extractBrandFromPdf(buffer);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  if (!extracted.business_name || extracted.business_name.trim() === "") {
    return NextResponse.json(
      { error: "Couldn't find a business name in this PDF — manual review needed." },
      { status: 422 }
    );
  }

  // Sanitize: drop any vertical Claude invented, drop bad hex codes, fill in font defaults.
  const vertical =
    extracted.vertical && VALID_VERTICALS.has(extracted.vertical) ? extracted.vertical : null;

  const colors = (extracted.colors ?? [])
    .filter((c) => c && /^#[0-9A-Fa-f]{6}$/.test(c.hex))
    .map((c, i) => ({
      name: c.name?.trim() || (c.role === "secondary" ? `Secondary ${i + 1}` : `Primary ${i + 1}`),
      hex: c.hex.toUpperCase(),
      role: c.role === "secondary" ? "secondary" : "primary",
    }));

  const fonts = (extracted.fonts ?? [])
    .filter((f) => f && f.name && f.name.trim().length > 0)
    .map((f) => ({
      name: f.name.trim(),
      role: f.role === "secondary" ? "secondary" : "primary",
      use_case: f.use_case ?? (f.role === "secondary" ? "Body copy" : "Headlines, titles"),
    }));

  // Smart merge: if a brand with this name already exists (normalized match),
  // fill in any empty fields rather than creating a duplicate.
  const incomingName = extracted.business_name.trim();
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/\bllc\b|\binc\b|\bthe\b/g, "")
      .replace(/[^a-z0-9]+/g, "")
      .trim();
  const incomingKey = normalize(incomingName);

  const { data: allBrands } = await supabase.from("brands").select("id, business_name");
  const existing = (allBrands ?? []).find((b) => normalize(b.business_name) === incomingKey);

  const payload = {
    business_name: incomingName,
    overview_client_raw: extracted.overview,
    overview_polished: extracted.overview,
    tagline: extracted.tagline,
    vertical,
    vertical_other: vertical === "other" ? extracted.vertical_other : null,
    website: extracted.website,
    instagram: extracted.instagram,
    facebook: extracted.facebook,
    youtube: extracted.youtube,
    tiktok: extracted.tiktok,
    linkedin: extracted.linkedin,
    audience_gender: extracted.audience_gender,
    audience_age: extracted.audience_age,
    audience_type: extracted.audience_type,
    brand_voice: extracted.brand_voice,
    look_and_feel: extracted.look_and_feel,
    what_to_avoid: extracted.what_to_avoid,
    inspiration_references: extracted.inspiration_references,
    coloring_tone: extracted.coloring_tone,
    music_mood: extracted.music_mood ?? [],
    music_genre: extracted.music_genre ?? [],
    music_notes: extracted.music_notes,
    client_monday_board_url: extracted.client_monday_board_url,
    dropbox_folder_url: extracted.dropbox_folder_url,
    client_asset_folder_url: extracted.brand_guidelines_external_url,
    colors,
    fonts,
  };

  let brand: { id: string; business_name: string };

  if (existing) {
    // MERGE PATH — fetch the full existing record, fill only empty fields.
    const { data: current } = await supabase
      .from("brands")
      .select("*")
      .eq("id", existing.id)
      .single();
    const update: Record<string, unknown> = {};
    const isEmpty = (v: unknown) =>
      v === null ||
      v === undefined ||
      (typeof v === "string" && v.trim() === "") ||
      (Array.isArray(v) && v.length === 0);

    for (const [key, value] of Object.entries(payload)) {
      // Never touch the business_name on a merge — the existing one is canonical.
      if (key === "business_name") continue;
      // Skip if incoming value is empty.
      if (isEmpty(value)) continue;
      // Skip if existing record already has a value.
      if (!isEmpty((current as Record<string, unknown>)[key])) continue;
      update[key] = value;
    }

    if (Object.keys(update).length > 0) {
      const { error: updErr } = await supabase
        .from("brands")
        .update(update)
        .eq("id", existing.id);
      if (updErr) {
        return NextResponse.json({ error: updErr.message }, { status: 500 });
      }
    }

    brand = existing;

    await supabase.from("brand_activity_log").insert({
      brand_id: brand.id,
      user_id: user.id,
      event_type: "imported_merged",
      metadata: {
        source: "pdf_import",
        filename: file.name,
        merged_fields: Object.keys(update),
      },
    });
  } else {
    // CREATE PATH — no existing brand matches by name.
    const { data: created, error } = await supabase
      .from("brands")
      .insert({ ...payload, status: "in_review", created_by: user.id })
      .select("id, business_name")
      .single();
    if (error || !created) {
      return NextResponse.json(
        { error: error?.message ?? "Failed to save brand" },
        { status: 500 }
      );
    }
    brand = created;
    await supabase.from("brand_activity_log").insert({
      brand_id: brand.id,
      user_id: user.id,
      event_type: "imported",
      metadata: { source: "pdf_import", filename: file.name },
    });
  }

  return NextResponse.json({
    id: brand.id,
    business_name: brand.business_name,
    merged: !!existing,
  });
}
