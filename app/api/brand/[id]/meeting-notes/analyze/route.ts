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
import { fetchBriefsForClient } from "@/lib/briefs/fetch";

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

// What to do about an action item, picked by the analyzer:
//   edit_request / project_request -> Brief tool request, filled in (links included)
//   revision_request -> the matching brief's Revisions tab
//   social_task -> the client's SocialDesk notebook (To Produce)
//   meeting -> proposed open times (also offered in the email)
//   todo -> just the owner's To-dos
export type ActionTool = "edit_request" | "project_request" | "revision_request" | "social_task" | "meeting" | "todo";
export type ActionItem = {
  task: string;
  owner?: string | null;
  due?: string | null;
  tool?: ActionTool;
  links?: string[];
  request_url?: string; // edit / project request, filled in
  revise_url?: string; // revision request on the matched brief
  revise_project?: string;
  meeting?: { title: string; minutes: number; with_client: boolean };
  slots?: { start: string; end: string; label: string }[];
};

export type MeetingAnalysis = {
  summary: string;
  action_items_us: ActionItem[];
  action_items_them: ActionItem[];
  followup_email_subject: string;
  followup_email_body: string;
  next_meeting_focus: string;
};

// Recent client email threads with their working links (Brief tool; empty
// until the service account may read Gmail).
type ClientEmail = { subject: string; date: string; from: string; snippet: string; links: { url: string; label: string }[] };
async function clientEmails(brandName: string): Promise<ClientEmail[]> {
  const base = (process.env.BRIEF_TOOL_URL ?? "https://briefs.surroundingsgroup.com").replace(/\/$/, "");
  const token = process.env.HUB_BRIEF_API_TOKEN;
  if (!token) return [];
  try {
    const url = new URL("/api/hub/client-context", base);
    url.searchParams.set("brand_name", brandName);
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(20000) });
    const body = (await res.json()) as { emails?: ClientEmail[] };
    return Array.isArray(body.emails) ? body.emails.slice(0, 12) : [];
  } catch {
    return [];
  }
}

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
  // The client's briefs (so a revision request can point at the right one) and
  // what the team has been emailing them about (links to galleries, boards,
  // files), fetched side by side.
  const [briefsRes, emails] = await Promise.all([
    fetchBriefsForClient(clientName).catch(() => ({ briefs: [] as Awaited<ReturnType<typeof fetchBriefsForClient>>["briefs"] })),
    clientEmails(clientName),
  ]);
  const briefList = briefsRes.briefs
    .slice(0, 40)
    .map((b) => ({ id: b.id, project: b.project, type: b.project_type, date: b.date, url: b.revisions_url ?? `${b.url}?tab=revisions` }));
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

The client's current briefs (for revision requests), as id | project | type | date:
${briefList.length ? briefList.map((b) => `${b.id} | ${b.project} | ${b.type ?? ""} | ${b.date ?? ""}`).join("\n") : "(none)"}

Recent emails between us and the client, newest first (date | subject | from | links | what the latest message says):
${emails.length ? emails.map((e) => `${e.date.slice(0, 10)} | ${e.subject} | ${e.from} | ${e.links.map((l) => (l.label ? `${l.label}: ${l.url}` : l.url)).join(" ; ") || "no links"} | ${e.snippet}`).join("\n") : "(none available)"}

Raw notes from the meeting:
"""
${rawNotes}
"""

Turn this into structured output. Return ONLY a JSON object inside <json>...</json> tags, no commentary, with this exact shape:

{
  "summary": "3 to 6 bullet lines, one per topic, each starting with '- ' and separated by a newline. Lead each with the topic and a colon, then what was decided, in 20 words or fewer (e.g. '- Emails: revisions on all five, lighter copy in sequence one'). Keep numbers, dates and names from the notes. No intro line, no paragraph.",
  "action_items_us": [
    {
      "task": "verb-first and SHORT, 8 words or fewer (the details go in the request below)",
      "owner": "SG team member if named, else null",
      "due": "date or relative like 'by Friday' if mentioned, else null",
      "tool": "one of: edit_request (editing existing photos or video, retouching, cutting), project_request (a new design, graphic, email build or production to make), revision_request (design changes to delivered work that has a brief in the list below: layout, copy, CTA, footer), social_task (social media posts and content updates the SMM handles, including swapping a model name, number or images across content while keeping the rest), meeting (a meeting to set up), todo (anything else)",
      "brief_id": "for revision_request: the id from the client's briefs list below that this is about, else null",
      "links": ["every URL from the notes that this item needs (e.g. a Milanote board for a design build)"],
      "request": { "project_name": "for edit_request / project_request: a clear project name, e.g. 'Email sequence two build'", "project_type": "Edit Request for anything made in post (video or photo edits, graphics, email designs and builds); a shoot type (Professional Content Shoot, Micro Content Shoot, Standard Listing) only for a new shoot; Custom / Other otherwise", "date": "YYYY-MM-DD when the due date is clear from the notes, else null", "context": "for edit_request / project_request: 1 to 3 sentences for the editor or designer: what to make, from what, and any detail from the notes" },
      "meeting": { "title": "for meeting: e.g. '2027 renewal meeting'", "from": "YYYY-MM-DD first day it could be (resolve phrases like 'second week of December' against the meeting date)", "to": "YYYY-MM-DD last day", "minutes": 60, "with_client": true }
    }
  ],
  "action_items_them": [
    { "task": "what the client needs to do", "owner": "person at the client if named, else null", "due": "date if mentioned, else null" }
  ],
  "followup_email_subject": "Ignored (the subject is set for you). Return an empty string.",
  "followup_email": {
    "first_name": "first name of ${pocName}",
    "opener": "1 to 2 warm sentences: thanks, then what the meeting covered in plain words (e.g. 'Thanks for the time today. Good progress on the email series, the t-shirt shoot and planning for year end.')",
    "decided": ["<topic>: one full sentence with the specifics (what exactly, numbers, names, dates, and why if it was said), 15 to 30 words"],
    "on_our_side": ["<what SG will do>, with who on our side and when if said, 10 to 25 words"],
    "from_you": ["<what the client will do>, with when and why it matters if said, 10 to 25 words"],
    "coming_up": ["<date or timing>: <next meeting, deadline or milestone and what it is for>"],
    "closing": "one warm closing sentence that points to the next step"
  },
  "next_meeting_focus": "One sentence: what the next sync should prioritize given what happened today."
}

Rules:
- Arrays are [] if nothing fits. Never invent action items.
- Leave out "request", "meeting" and "brief_id" when they do not apply to an item's tool.
- Use the emails as context. When an action item works from something already sent by email (a gallery the client picked favorites in, a board, a file, a folder), put that link in the item's "links" and say in request.context exactly what to pull from it (e.g. "Pull the hearted t-shirt images from the Pixieset gallery's t-shirt section"). Never attach an email link that is not about the item.
- For a meeting item, do NOT invent times in the email; the times are added for you. Still list the meeting in coming_up as "<title>: <the window>".
- The follow-up email should feel complete to someone who was not in the room: specific, concrete, nothing vague like "next steps discussed". Use every concrete detail in the notes; never add facts that are not there.
- action_items_us = things SG owes the client (shoots, edits, strategy, calendar, etc.)
- action_items_them = things the client owes SG (approvals, assets, feedback, intros, etc.)
- If the raw notes are thin or unclear, say so in the summary rather than padding.
- Notes may be a voice transcript with no punctuation and misheard words; read them for meaning and fix obvious mishearings (brand and model names, numbers) only when the context makes the right word clear.`;

  const client = new Anthropic({ apiKey: key });

  let raw = "";
  try {
    const resp = await client.messages.create({
      model: "claude-opus-5",
      // Room for the model's thinking as well as its answer (3,000 could cut the answer off).
      max_tokens: 16000,
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

  // The subject is set here, short and the same shape every time:
  // "Bertram Yachts | Monthly sync recap, Nov 24".
  const SHORT_LABEL: Record<string, string> = {
    monthly_external_sync: "Monthly sync",
    internal_strategy_collab: "Strategy",
    quarterly_business_review: "Quarterly review",
    annual_audit: "Annual audit",
  };
  const day = /^\d{4}-\d{2}-\d{2}$/.test(body.meeting_date ?? "")
    ? new Date(`${body.meeting_date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
  const subject = `${clientName} | ${SHORT_LABEL[meetingType] ?? "Meeting"} recap, ${day}`;
  void meetingTitle;
  // Meeting items: real open times from the calendars, offered in the email.
  const p = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const usRaw = Array.isArray(p.action_items_us) ? (p.action_items_us as Record<string, unknown>[]) : [];
  const fe = (p.followup_email && typeof p.followup_email === "object" ? p.followup_email : null) as Record<string, unknown> | null;
  const slotsFor = new Map<number, { start: string; end: string; label: string }[]>();
  await Promise.all(
    usRaw.map(async (r, i) => {
      const m = r?.tool === "meeting" ? (r.meeting as Record<string, unknown> | undefined) : undefined;
      if (!m || !/^\d{4}-\d{2}-\d{2}$/.test(String(m.from)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(m.to))) return;
      const slots = await freeSlots(clientName, String(m.from), String(m.to), Number(m.minutes) || 60);
      if (!slots.length) return;
      slotsFor.set(i, slots);
      if (fe && m.with_client !== false) {
        const title = String(m.title || "Our next meeting");
        // "Monday, Dec 7 at 10 AM; Tuesday, Dec 8 at 11 AM; or Wednesday, Dec 9 at 10 AM"
        const list = slots.map((s) => {
          const d = new Date(s.start);
          const day = d.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long", month: "short", day: "numeric" });
          const time = d.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).replace(":00", "");
          return `${day} at ${time}`;
        });
        const joined = list.length > 1 ? `${list.slice(0, -1).join("; ")}; or ${list[list.length - 1]}` : list[0];
        const offer = `${title}: would ${joined} work for you?`;
        const coming = (Array.isArray(fe.coming_up) ? (fe.coming_up as unknown[]) : []).filter(
          (x) => !(typeof x === "string" && x.toLowerCase().includes(title.toLowerCase().split(" ").slice(-2).join(" ")))
        );
        fe.coming_up = [...coming, offer];
      }
    })
  );

  const analysis = normalize(parsed, subject, amName === "the AM" ? "The Surroundings team" : amName.split(" ")[0]);
  // Tool details for the "us" items, in the order the model gave them.
  const briefTool = (process.env.BRIEF_TOOL_URL ?? "https://briefs.surroundingsgroup.com").replace(/\/$/, "");
  analysis.action_items_us = analysis.action_items_us.map((it, i) => {
    const r = usRaw.find((x) => typeof x?.task === "string" && scrubDashes(String(x.task).trim()).slice(0, 300) === it.task) ?? usRaw[i] ?? {};
    const tool = (["edit_request", "project_request", "revision_request", "social_task", "meeting", "todo"] as const).find((t) => t === r.tool) ?? "todo";
    const links = (Array.isArray(r.links) ? (r.links as unknown[]) : []).filter((l): l is string => typeof l === "string" && /^https?:\/\//.test(l)).slice(0, 5);
    const out: ActionItem = { ...it, tool, ...(links.length ? { links } : {}) };
    if (tool === "edit_request" || tool === "project_request") {
      const req = (r.request ?? {}) as Record<string, unknown>;
      const q = new URLSearchParams({
        client: clientName,
        project: String(req.project_name || it.task).slice(0, 160),
        type: String(req.project_type || (tool === "edit_request" ? "Edit Request" : "Custom / Other")),
        context: String(req.context || it.task).slice(0, 1500),
        from: "meeting",
      });
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(req.date ?? ""))) q.set("date", String(req.date));
      for (const l of links) q.append("link", l);
      out.request_url = `${briefTool}/request?${q.toString()}`;
    }
    if (tool === "revision_request") {
      const b = briefList.find((x) => x.id === r.brief_id);
      if (b) {
        out.revise_url = b.url;
        out.revise_project = b.project;
      }
    }
    if (tool === "meeting") {
      const m = (r.meeting ?? {}) as Record<string, unknown>;
      out.meeting = { title: String(m.title || it.task), minutes: Number(m.minutes) || 60, with_client: m.with_client !== false };
      const idx = usRaw.indexOf(r as Record<string, unknown>);
      const slots = slotsFor.get(idx >= 0 ? idx : i);
      if (slots) out.slots = slots;
    }
    return out;
  });
  // Which emails it read, so the page can say so.
  return NextResponse.json({ ...analysis, sources: emails.slice(0, 8).map((e) => ({ subject: e.subject, date: e.date })) });
}

// Strip em/en dashes server-side so the AI can never ship them even if
// it slips up. Replace em-dash with a period+space, en-dash with a
// plain hyphen. Then collapse any accidental double spaces.
function scrubDashes(s: string): string {
  return s
    .replace(/\s*—\s*/g, ". ")
    .replace(/–/g, "-")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\./g, ".");
}

// The follow-up email's layout is fixed here, not left to the model: a
// greeting, one opener line, labeled sections of one-line bullets, a closing
// line and the sign-off, with a blank line between every block.
const EMAIL_SECTIONS: [string, string][] = [
  ["decided", "DECIDED"],
  ["on_our_side", "ON OUR SIDE"],
  ["from_you", "FROM YOU"],
  ["coming_up", "COMING UP"],
];

function buildEmail(fe: Record<string, unknown>, signoff: string): string {
  const line = (v: unknown) => (typeof v === "string" ? scrubDashes(v.trim()).replace(/^[•*-]\s*/, "").replace(/\s+/g, " ") : "");
  const list = (v: unknown) => (Array.isArray(v) ? v.map(line).filter(Boolean).slice(0, 8) : []);
  const blocks: string[] = [`Hi ${line(fe.first_name) || "there"},`, line(fe.opener) || "Thanks for the time today. Here is where we landed."];
  for (const [key, label] of EMAIL_SECTIONS) {
    const items = list(fe[key]);
    if (items.length) blocks.push([label, ...items.map((i) => `• ${i}`)].join("\n"));
  }
  blocks.push(line(fe.closing) || "Talk soon.");
  blocks.push(signoff);
  return blocks.join("\n\n");
}

function normalize(x: unknown, shortSubject: string, signoff: string): MeetingAnalysis {
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
    summary: str(o.summary, "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => "- " + l.replace(/^[-•*]\s*/, ""))
      .join("\n"),
    action_items_us: items(o.action_items_us),
    action_items_them: items(o.action_items_them),
    followup_email_subject: shortSubject,
    followup_email_body:
      o.followup_email && typeof o.followup_email === "object"
        ? buildEmail(o.followup_email as Record<string, unknown>, signoff)
        : str(o.followup_email_body, ""),
    next_meeting_focus: str(o.next_meeting_focus, ""),
  };
}

// Open times on the client's AM's and Billy's calendars (Brief tool).
async function freeSlots(brandName: string, from: string, to: string, minutes: number) {
  const base = (process.env.BRIEF_TOOL_URL ?? "https://briefs.surroundingsgroup.com").replace(/\/$/, "");
  const token = process.env.HUB_BRIEF_API_TOKEN;
  if (!token) return [];
  try {
    const url = new URL("/api/hub/free-slots", base);
    url.searchParams.set("brand_name", brandName);
    url.searchParams.set("from", from);
    url.searchParams.set("to", to);
    url.searchParams.set("minutes", String(minutes));
    url.searchParams.set("count", "3");
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const body = (await res.json()) as { slots?: { start: string; end: string; label: string }[] };
    return Array.isArray(body.slots) ? body.slots : [];
  } catch {
    return [];
  }
}
