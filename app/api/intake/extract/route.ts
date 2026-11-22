// Smart-fill endpoint for the public intake form.
//
// Flow:
//   1. Browser uploads the file DIRECTLY to Supabase Storage bucket
//      "intake-uploads" (anon insert policy, 25 MB cap). Bypasses
//      Vercel's 4.5 MB Function body cap — brand guides routinely run
//      10-20 MB.
//   2. Browser POSTs { storage_path, mime } here.
//   3. This route downloads with the service role, hands the file to
//      Claude Opus 5, parses the JSON out of a <json>...</json> wrapper,
//      and deletes the Storage object.
//
// Why no zodOutputFormat: the SDK's zod-to-JSON-schema converter blew
// up on `.nullable()` enums during the previous iteration ("Cannot read
// properties of undefined (reading 'def')"). Prompt-driven JSON is
// boringly reliable — same pattern the Brief Tool's travel-quote uses
// when structured output isn't a fit.
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 90;
export const dynamic = "force-dynamic";

const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

const hits = new Map<string, { n: number; at: number }>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_HITS_PER_WINDOW = 10;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now - rec.at > WINDOW_MS) {
    hits.set(ip, { n: 1, at: now });
    return false;
  }
  rec.n += 1;
  return rec.n > MAX_HITS_PER_WINDOW;
}

const SYSTEM = `You read a document a prospective client uploaded during creative onboarding (brand guide, pitch deck, website screenshot, or similar) and extract brand info. Only extract what is actually in the document. Never invent. Use null for missing string fields and [] for missing arrays.

Output format — follow EXACTLY:
Wrap your entire response in <json>...</json> tags. Inside those tags, output ONLY a single valid JSON object. No prose, no code fences, no commentary before or after.

Schema (every top-level field required, but values may be null / [] when not present in the document):

{
  "business_name": string | null,
  "tagline": string | null,
  "website": string | null,
  "vertical": "marine" | "private_aviation" | "automotive" | "real_estate" | "real_estate_development" | "multifamily_residential" | "resort_travel" | "home_services" | "other" | null,
  "overview_client_raw": string | null,
  "look_and_feel": string | null,
  "audience_type": string | null,
  "audience_age": string | null,
  "audience_gender": string | null,
  "colors": [{ "name": string, "hex": "#RRGGBB", "role": "primary" | "secondary" | "accent" | "other" }],
  "fonts": [{ "name": string, "role": "primary" | "secondary" | "accent" | "other", "use_case": string }],
  "instagram": string | null,
  "facebook": string | null,
  "youtube": string | null,
  "tiktok": string | null,
  "linkedin": string | null
}

Field rules:
- colors.hex MUST match #RRGGBB (6 hex digits, uppercase). Include only colors explicitly shown or convertible from an explicit CMYK/RGB callout. Skip generic black/white unless the guide names them. Empty array if none.
- fonts.name is just the family ("Montserrat", not "Montserrat Bold 24pt"). role=primary for display/headlines, secondary for body, accent for occasional use. use_case is a short 2–6 word label ("Headlines", "Body copy", etc.) or "".
- vertical: pick the single best match. multifamily_residential = apartment communities. real_estate_development = new-construction / developer brands. resort_travel = hotels, resorts, destinations. Null if unclear.
- overview_client_raw: 2–4 sentences in the brand's own voice if an About / Who We Are section exists. Null otherwise (don't infer).
- look_and_feel: 2–4 sentences describing the visual personality — pulled from an explicit mood / voice section, or from what you observe (palette, typography, imagery tone). Written like the brand describing itself.
- social handles: @handle or URL as shown. Null if not present.`;

type Payload = { storage_path?: string; mime?: string };

export async function POST(req: NextRequest) {
  const key = process.env.ANTHROPIC_API_KEY;
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !supaUrl || !supaKey) {
    console.error("[extract] missing env", {
      hasAnthropic: !!key,
      hasSupaUrl: !!supaUrl,
      hasSupaKey: !!supaKey,
    });
    return NextResponse.json(
      { error: "Smart fill is not configured." },
      { status: 503 }
    );
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many smart-fill requests. Try again in a few minutes." },
      { status: 429 }
    );
  }

  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const storagePath = typeof body.storage_path === "string" ? body.storage_path : "";
  const mime = (typeof body.mime === "string" ? body.mime : "").toLowerCase();

  if (!storagePath || storagePath.includes("..") || !storagePath.startsWith("smart-fill/")) {
    return NextResponse.json({ error: "Invalid upload path." }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(mime)) {
    return NextResponse.json(
      { error: "Unsupported file type. Use a PDF, PNG, JPG, WebP, or GIF." },
      { status: 415 }
    );
  }

  const admin = createClient(supaUrl, supaKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const dl = await admin.storage.from("intake-uploads").download(storagePath);
  if (dl.error || !dl.data) {
    console.error("[extract] storage download failed", dl.error?.message, storagePath);
    return NextResponse.json(
      { error: `Couldn't read uploaded file: ${dl.error?.message ?? "not found"}` },
      { status: 404 }
    );
  }
  const blob = dl.data;
  if (blob.size === 0) {
    await admin.storage.from("intake-uploads").remove([storagePath]);
    return NextResponse.json({ error: "Empty file." }, { status: 400 });
  }
  if (blob.size > MAX_BYTES) {
    await admin.storage.from("intake-uploads").remove([storagePath]);
    return NextResponse.json(
      { error: "File exceeds the 25 MB smart-fill limit." },
      { status: 413 }
    );
  }

  const buf = Buffer.from(await blob.arrayBuffer());
  const data = buf.toString("base64");

  const client = new Anthropic({ apiKey: key });

  const fileBlock =
    mime === "application/pdf"
      ? {
          type: "document" as const,
          source: {
            type: "base64" as const,
            media_type: "application/pdf" as const,
            data,
          },
        }
      : {
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: mime as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
            data,
          },
        };

  let raw = "";
  try {
    const resp = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 4000,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            fileBlock,
            {
              type: "text",
              text: "Extract brand info from this document. Return only the JSON inside <json>...</json> tags, following the schema exactly.",
            },
          ],
        },
      ],
    });
    // Collect every text block Claude produced — thinking blocks or other
    // non-text blocks are just skipped. We never fail the whole request
    // because the first block happened to be something else.
    for (const part of resp.content) {
      if (part.type === "text") raw += part.text;
    }
    if (!raw.trim()) {
      console.error("[extract] empty response, stop_reason:", resp.stop_reason);
      await admin.storage.from("intake-uploads").remove([storagePath]);
      return NextResponse.json(
        { error: "The model returned an empty response. Try a different file." },
        { status: 502 }
      );
    }
  } catch (e) {
    await admin.storage.from("intake-uploads").remove([storagePath]);
    const msg = e instanceof Error ? e.message : "Extract failed.";
    console.error("[extract] anthropic error:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  await admin.storage.from("intake-uploads").remove([storagePath]);

  // Prefer the content between <json>...</json>, but fall back to the
  // first/last brace pair if the model forgot the wrapper.
  let jsonText = "";
  const tagMatch = raw.match(/<json>\s*([\s\S]*?)\s*<\/json>/i);
  if (tagMatch) {
    jsonText = tagMatch[1].trim();
  } else {
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first !== -1 && last > first) {
      jsonText = raw.slice(first, last + 1);
    } else {
      jsonText = raw.trim();
    }
  }
  // Strip any lingering code fences just in case.
  jsonText = jsonText.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    console.error("[extract] JSON parse failed:", (e as Error).message, "\nraw snippet:", jsonText.slice(0, 400));
    return NextResponse.json(
      { error: "The model's output wasn't valid JSON. Try another file." },
      { status: 502 }
    );
  }

  return NextResponse.json(normalize(parsed));
}

type ExtractedColor = { name: string; hex: string; role: "primary" | "secondary" | "accent" | "other" };
type ExtractedFont = { name: string; role: "primary" | "secondary" | "accent" | "other"; use_case: string };

export type IntakeExtraction = {
  business_name: string | null;
  tagline: string | null;
  website: string | null;
  vertical: string | null;
  overview_client_raw: string | null;
  look_and_feel: string | null;
  audience_type: string | null;
  audience_age: string | null;
  audience_gender: string | null;
  colors: ExtractedColor[];
  fonts: ExtractedFont[];
  instagram: string | null;
  facebook: string | null;
  youtube: string | null;
  tiktok: string | null;
  linkedin: string | null;
};

// Harden whatever the model gave us — coerce types, trim strings, drop
// malformed hex codes, clamp array sizes, so the client never has to
// defend against junk.
function normalize(x: unknown): IntakeExtraction {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  const str = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t.length > 0 ? t : null;
  };
  const role = (v: unknown): "primary" | "secondary" | "accent" | "other" =>
    v === "primary" || v === "secondary" || v === "accent" ? v : "other";
  const colors: ExtractedColor[] = Array.isArray(o.colors)
    ? (o.colors as unknown[])
        .map((c): ExtractedColor | null => {
          if (!c || typeof c !== "object") return null;
          const row = c as Record<string, unknown>;
          const hex = typeof row.hex === "string" ? row.hex.trim() : "";
          if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) return null;
          return {
            name: (str(row.name) ?? "").slice(0, 60),
            hex: hex.toUpperCase(),
            role: role(row.role),
          };
        })
        .filter((c): c is ExtractedColor => c !== null)
        .slice(0, 12)
    : [];
  const fonts: ExtractedFont[] = Array.isArray(o.fonts)
    ? (o.fonts as unknown[])
        .map((f): ExtractedFont | null => {
          if (!f || typeof f !== "object") return null;
          const row = f as Record<string, unknown>;
          const name = str(row.name);
          if (!name) return null;
          return {
            name: name.slice(0, 80),
            role: role(row.role),
            use_case: (str(row.use_case) ?? "").slice(0, 120),
          };
        })
        .filter((f): f is ExtractedFont => f !== null)
        .slice(0, 8)
    : [];
  return {
    business_name: str(o.business_name),
    tagline: str(o.tagline),
    website: str(o.website),
    vertical: str(o.vertical),
    overview_client_raw: str(o.overview_client_raw),
    look_and_feel: str(o.look_and_feel),
    audience_type: str(o.audience_type),
    audience_age: str(o.audience_age),
    audience_gender: str(o.audience_gender),
    colors,
    fonts,
    instagram: str(o.instagram),
    facebook: str(o.facebook),
    youtube: str(o.youtube),
    tiktok: str(o.tiktok),
    linkedin: str(o.linkedin),
  };
}
