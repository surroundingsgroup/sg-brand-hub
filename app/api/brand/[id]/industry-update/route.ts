// Industry Update generator — Claude writes 3–4 quick notes about
// what's happening in the client's vertical (inspiration + competitor
// moves). Cached on brands.industry_update so the client profile
// renders instantly on page load; refreshed by the "Refresh" button
// in the Industry Update tile.
//
// This is a pure synthesis: Claude writes what it knows about the
// vertical and the client, with no web search. For v2 we can bolt on
// retrieval or a vertical-specific RSS feed.
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type IndustryItem = {
  kind: "inspiration" | "competitor";
  headline: string;
  body: string;
};

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "Not configured." }, { status: 503 });
  }

  const supabase = createSupabaseServerClient();
  const { data: brand, error } = await supabase
    .from("brands")
    .select("business_name, vertical, look_and_feel, audience_type")
    .eq("id", params.id)
    .single();
  if (error || !brand) {
    return NextResponse.json({ error: "Brand not found." }, { status: 404 });
  }

  const vertical = (brand.vertical as string | null)?.replace(/_/g, " ") ?? "their industry";
  const client = brand.business_name as string;

  const system = `You brief the Surroundings Group creative team on what's happening in a client's industry — fresh inspiration, competitor moves, aesthetic trends. Tone: senior creative director. Direct, specific, no fluff. No corporate buzzwords ("synergy", "leverage", "unleash"). Each item should feel like a tip, not a press release.`;

  const prompt = `Client: ${client}
Vertical: ${vertical}
${brand.look_and_feel ? `Visual direction: ${brand.look_and_feel}\n` : ""}${brand.audience_type ? `Audience: ${brand.audience_type}\n` : ""}
Write 4 industry notes for this client's next monthly sync. Mix of:
  - 2 "inspiration" items — a trend, aesthetic, format, or creative approach gaining traction in this vertical (or an adjacent one). Something the AM can riff on to pitch the client a fresh direction.
  - 2 "competitor" items — specific brand moves, campaigns, or content strategies competitors in this vertical are known for. Name real competitors where you can.

Each item is:
- headline: punchy, max 8 words
- body: 2–3 sentences. Specific. If you name a brand/campaign, name it.

Return ONLY a JSON object inside <json>...</json> tags:

{
  "items": [
    { "kind": "inspiration" | "competitor", "headline": "...", "body": "..." }
  ]
}`;

  const client_api = new Anthropic({ apiKey: key });

  let raw = "";
  try {
    const resp = await client_api.messages.create({
      model: "claude-opus-5",
      max_tokens: 1500,
      system,
      messages: [{ role: "user", content: prompt }],
    });
    for (const part of resp.content) {
      if (part.type === "text") raw += part.text;
    }
  } catch (e) {
    console.error("[industry-update] claude error:", (e as Error).message);
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 502 }
    );
  }

  const tagMatch = raw.match(/<json>\s*([\s\S]*?)\s*<\/json>/i);
  let jsonText = tagMatch ? tagMatch[1].trim() : raw;
  const first = jsonText.indexOf("{");
  const last = jsonText.lastIndexOf("}");
  if (first !== -1 && last > first) jsonText = jsonText.slice(first, last + 1);
  jsonText = jsonText.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    console.error("[industry-update] JSON parse failed:", (e as Error).message, "\nraw snippet:", raw.slice(0, 300));
    return NextResponse.json(
      { error: "Model output wasn't valid JSON." },
      { status: 502 }
    );
  }

  const items: IndustryItem[] = Array.isArray(
    (parsed as { items?: unknown }).items
  )
    ? ((parsed as { items: unknown[] }).items)
        .map((it): IndustryItem | null => {
          if (!it || typeof it !== "object") return null;
          const row = it as Record<string, unknown>;
          const kind =
            row.kind === "inspiration" || row.kind === "competitor"
              ? row.kind
              : "inspiration";
          const headline = typeof row.headline === "string" ? row.headline.trim() : "";
          const body = typeof row.body === "string" ? row.body.trim() : "";
          if (!headline || !body) return null;
          return { kind, headline: headline.slice(0, 120), body: body.slice(0, 600) };
        })
        .filter((x): x is IndustryItem => x !== null)
        .slice(0, 6)
    : [];

  if (items.length === 0) {
    return NextResponse.json(
      { error: "Model returned no items." },
      { status: 502 }
    );
  }

  const payload = {
    generated_at: new Date().toISOString(),
    items,
  };

  const { error: writeErr } = await supabase
    .from("brands")
    .update({ industry_update: payload })
    .eq("id", params.id);
  if (writeErr) {
    console.error("[industry-update] write error:", writeErr.message);
    return NextResponse.json({ error: writeErr.message }, { status: 500 });
  }

  return NextResponse.json(payload);
}
