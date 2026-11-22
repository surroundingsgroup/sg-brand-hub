// Meeting-notes AI analyzer. Takes the raw dump an AM typed (or pasted
// from a transcript) and returns structured output: summary, action
// items for both sides, a draft follow-up email to the client, and a
// one-liner on what to focus on at the next sync.
//
// No persistence here — the caller gets the structured JSON back and
// decides when to save (POST /api/brand/[id]/meeting-notes). Keeping
// analyze read-only means an AM can iterate on the raw notes and
// re-run the AI without accidentally overwriting a saved record.
//
// Prompt-driven JSON in <json> tags — same bulletproof pattern as the
// intake smart-fill and industry-update routes.
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 90;
export const dynamic = "force-dynamic";

const MEETING_LABEL: Record<string, string> = {
  monthly_external_sync: "Monthly External Client Sync",
  internal_strategy_collab: "Internal Strategy Collab",
  quarterly_business_review: "Quarterly Business Review",
  annual_audit: "Annual Audit",
  other: "Client Meeting",
};

type AnalyzeBody = {
  meeting_type?: string;
  meeting_date?: string;
  meeting_title?: string;
  raw_notes?: string;
};

export type ActionItem = {
  task: string;
  owner?: string | null;
  due?: string | null;
};

export type MeetingAnalysis = {
  summary: string;
  action_items_us: ActionItem[];
  action_items_them: ActionItem[];
  followup_email_subject: string;
  followup_email_body: string;
  next_meeting_focus: string;
};

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "Not configured." }, { status: 503 });
  }

  let body: AnalyzeBody;
  try {
    body = (await req.json()) as AnalyzeBody;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const meetingType = (body.meeting_type ?? "other").trim();
  const rawNotes = (body.raw_notes ?? "").trim();
  if (rawNotes.length < 10) {
    return NextResponse.json(
      { error: "Add a few sentences of notes before analyzing." },
      { status: 400 }
    );
  }

  const supabase = createSupabaseServerClient();
  const { data: brand, error } = await supabase
    .from("brands")
    .select("business_name, submitter_name, submitter_email, account_manager, vertical")
    .eq("id", params.id)
    .single();
  if (error || !brand) {
    return NextResponse.json({ error: "Brand not found." }, { status: 404 });
  }

  const clientName = brand.business_name as string;
  const pocName = (brand.submitter_name as string | null) || "the client";
  const pocEmail = brand.submitter_email as string | null;
  const amName = (brand.account_manager as string | null) || "the AM";
  const meetingLabel =
    MEETING_LABEL[meetingType] ?? MEETING_LABEL.other;
  const meetingTitle = body.meeting_title?.trim() || meetingLabel;

  const system = `You are a sharp executive assistant for the Surroundings Group creative team. You turn messy meeting notes into structured output. Tone: senior, direct, no fluff, no filler words. Write in natural plain English, never corporate buzzwords like "circle back", "touch base", "leverage", "synergy". Make action items concrete and verb-first.

PUNCTUATION RULES (strict):
- NEVER use em dashes (—) anywhere in your output. Not in the summary, not in the action items, not in the email. Use a period, comma, colon, or parentheses instead.
- NEVER use en dashes (–). Use a hyphen (-) for compound words only.
- Keep sentences short. Multiple short sentences beat one long sentence with dashes.`;

  const userMsg = `Context:
Client: ${clientName}
Point of contact: ${pocName}${pocEmail ? ` (${pocEmail})` : ""}
Account Manager: ${amName}
Meeting type: ${meetingLabel}
Meeting date: ${body.meeting_date || "today"}

Raw notes from the meeting:
"""
${rawNotes}
"""

Turn this into structured output. Return ONLY a JSON object inside <json>...</json> tags, no commentary, with this exact shape:

{
  "summary": "3-5 sentence recap of what happened. Specific. If numbers, dates, or names came up in the raw notes, keep them.",
  "action_items_us": [
    { "task": "verb-first, concrete", "owner": "SG team member if named, else null", "due": "date or relative like 'by Friday' if mentioned, else null" }
  ],
  "action_items_them": [
    { "task": "what the client needs to do", "owner": "person at the client if named, else null", "due": "date if mentioned, else null" }
  ],
  "followup_email_subject": "Short, specific — never generic like 'Meeting follow-up'. Mention the meeting type and date.",
  "followup_email_body": "A client-ready follow-up email body. Warm but professional. Address ${pocName} by first name. Include a quick thank-you, the top 2-3 decisions/takeaways from the meeting, the action items THEY own (not ours), and a close. Plain text, no markdown. Sign off as '${amName}' or similar.",
  "next_meeting_focus": "One sentence: what the next sync should prioritize given what happened today."
}

Rules:
- Arrays are [] if nothing fits. Never invent action items.
- action_items_us = things SG owes the client (shoots, edits, strategy, calendar, etc.)
- action_items_them = things the client owes SG (approvals, assets, feedback, intros, etc.)
- If the raw notes are thin or unclear, say so in the summary rather than padding.`;

  const client = new Anthropic({ apiKey: key });

  let raw = "";
  try {
    const resp = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 3000,
      system,
      messages: [{ role: "user", content: userMsg }],
    });
    for (const part of resp.content) {
      if (part.type === "text") raw += part.text;
    }
  } catch (e) {
    console.error("[meeting-notes.analyze] claude error:", (e as Error).message);
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
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
  } catch {
    console.error("[meeting-notes.analyze] JSON parse failed:", raw.slice(0, 400));
    return NextResponse.json(
      { error: "Model output wasn't valid JSON — try again." },
      { status: 502 }
    );
  }

  const analysis = normalize(parsed, meetingTitle);
  return NextResponse.json(analysis);
}

// Strip em/en dashes server-side so the AI can never ship them even if
// it slips up. Replace em-dash with a period+space, en-dash with a
// plain hyphen. Then collapse any accidental double spaces.
function scrubDashes(s: string): string {
  return s
    .replace(/\s*—\s*/g, ". ")
    .replace(/–/g, "-")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+\./g, ".");
}

function normalize(x: unknown, fallbackTitle: string): MeetingAnalysis {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  const str = (v: unknown, fb = ""): string => {
    if (typeof v !== "string") return fb;
    return scrubDashes(v.trim());
  };
  const strOrNull = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const t = scrubDashes(v.trim());
    return t.length > 0 ? t : null;
  };
  const items = (arr: unknown): ActionItem[] =>
    Array.isArray(arr)
      ? (arr as unknown[])
          .map((a): ActionItem | null => {
            if (!a || typeof a !== "object") return null;
            const r = a as Record<string, unknown>;
            const task = str(r.task);
            if (!task) return null;
            return {
              task: task.slice(0, 300),
              owner: strOrNull(r.owner),
              due: strOrNull(r.due),
            };
          })
          .filter((a): a is ActionItem => a !== null)
          .slice(0, 20)
      : [];
  return {
    summary: str(o.summary, ""),
    action_items_us: items(o.action_items_us),
    action_items_them: items(o.action_items_them),
    followup_email_subject: str(o.followup_email_subject, fallbackTitle),
    followup_email_body: str(o.followup_email_body, ""),
    next_meeting_focus: str(o.next_meeting_focus, ""),
  };
}
