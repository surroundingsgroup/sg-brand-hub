"use client";

// The follow-up email as it will read: greeting, opener, a bold heading per
// project with bullets (sub-bullets and **bold** phrases inside), closing,
// sign-off. Parsed from the plain-text body (so hand edits show up), and
// copied as formatted HTML so it pastes into Gmail looking the same.
//
// Plain-text shape:
//   Hi Alex,
//
//   Great catching up today! Below is a recap of our discussion and next steps.
//
//   34CC Content Review & Revisions
//   • I'll make **revisions to a handful of images** based on your feedback.
//   • **Pinned IG Post Series:**
//     ◦ We'll create a **3-post series** leading up to the show.
//
// Older emails used UPPERCASE labels ("DECIDED"); those still render.

type Item = { text: string; sub: string[] };
type Block =
  | { kind: "p"; text: string }
  | { kind: "label"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "list"; items: Item[] };

const BULLET = /^[•*-]\s+/;
const SUB = /^(?:\s{2,}|\t)[◦•*-]\s+|^◦\s+/;
const isLabel = (l: string) => /^[A-Z][A-Z '&/]{2,30}$/.test(l.trim());

export function parseEmail(body: string): Block[] {
  const lines = body.replace(/\r/g, "").split("\n");
  const out: Block[] = [];
  const nextText = (i: number) => {
    for (let j = i + 1; j < lines.length; j++) if (lines[j].trim()) return lines[j];
    return "";
  };
  lines.forEach((raw, i) => {
    const l = raw.trim();
    if (!l) return;
    if (SUB.test(raw)) {
      const text = raw.replace(SUB, "").trim();
      const last = out[out.length - 1];
      if (last?.kind === "list" && last.items.length) last.items[last.items.length - 1].sub.push(text);
      else out.push({ kind: "list", items: [{ text, sub: [] }] });
      return;
    }
    if (BULLET.test(l)) {
      const item = { text: l.replace(BULLET, ""), sub: [] };
      const last = out[out.length - 1];
      if (last?.kind === "list") last.items.push(item);
      else out.push({ kind: "list", items: [item] });
      return;
    }
    if (isLabel(l)) {
      out.push({ kind: "label", text: l });
      return;
    }
    // A short line with no closing punctuation, right above bullets, is a heading.
    const next = nextText(i);
    if (l.length <= 90 && !/[.!?,:;]$/.test(l) && (BULLET.test(next.trim()) || SUB.test(next))) {
      out.push({ kind: "heading", text: l.replace(/\*\*/g, "") });
      return;
    }
    out.push({ kind: "p", text: l });
  });
  return out;
}

const title = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

// "**bold**" spans; older one-line bullets bold their "Topic:" lead instead.
function spans(text: string): { bold: boolean; text: string }[] {
  if (text.includes("**")) {
    return text
      .split(/\*\*/)
      .map((t, i) => ({ bold: i % 2 === 1, text: t }))
      .filter((s) => s.text);
  }
  const m = text.match(/^([^:]{2,40}):\s*(.+)$/);
  if (m && m[1].split(/\s+/).length <= 5) return [{ bold: true, text: `${m[1]}:` }, { bold: false, text: ` ${m[2]}` }];
  return [{ bold: false, text }];
}

function Rich({ text }: { text: string }) {
  return (
    <>
      {spans(text).map((s, i) =>
        s.bold ? (
          <strong key={i} className="font-semibold text-foreground">
            {s.text}
          </strong>
        ) : (
          <span key={i}>{s.text}</span>
        )
      )}
    </>
  );
}

export function EmailPreview({ body }: { body: string }) {
  const blocks = parseEmail(body);
  return (
    <div className="rounded-xl border border-border/70 bg-background px-5 py-5 text-[13.5px] leading-relaxed text-foreground/90">
      {blocks.map((b, i) =>
        b.kind === "label" ? (
          <div key={i} className="mb-1.5 mt-5 flex items-center gap-2 first:mt-0">
            <span className="h-px w-4 bg-[#FFBD83]" />
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{title(b.text)}</span>
          </div>
        ) : b.kind === "heading" ? (
          <h4 key={i} className="mb-1.5 mt-5 text-[14.5px] font-semibold text-foreground first:mt-0">
            {b.text}
          </h4>
        ) : b.kind === "list" ? (
          <ul key={i} className="ml-5 list-disc space-y-1 marker:text-foreground/40">
            {b.items.map((it, j) => (
              <li key={j}>
                <Rich text={it.text} />
                {it.sub.length ? (
                  <ul className="ml-5 mt-1 list-[circle] space-y-1 marker:text-foreground/40">
                    {it.sub.map((s, k) => (
                      <li key={k}>
                        <Rich text={s} />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p key={i} className={i === 0 ? "" : "mt-3"}>
            <Rich text={b.text} />
          </p>
        )
      )}
    </div>
  );
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const richHtml = (text: string) => spans(text).map((s) => (s.bold ? `<strong>${esc(s.text)}</strong>` : esc(s.text))).join("");

/** Email-safe HTML (inline styles) for pasting into Gmail or Outlook. */
export function emailHtml(body: string): string {
  const font = "font-family:Arial,Helvetica,sans-serif;";
  const text = `${font}font-size:14px;line-height:1.55;color:#222222;`;
  const parts = parseEmail(body).map((b) => {
    if (b.kind === "label")
      return `<div style="${font}font-size:11px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:#8a8178;margin:20px 0 6px;">${esc(title(b.text))}</div>`;
    if (b.kind === "heading") return `<div style="${font}font-size:15px;font-weight:700;color:#111111;margin:18px 0 8px;">${esc(b.text)}</div>`;
    if (b.kind === "list")
      return `<ul style="${text}margin:0 0 12px 22px;padding:0;list-style-type:disc;">${b.items
        .map(
          (it) =>
            `<li style="margin:0 0 4px;">${richHtml(it.text)}${
              it.sub.length
                ? `<ul style="${text}margin:6px 0 6px 22px;padding:0;list-style-type:circle;">${it.sub
                    .map((s) => `<li style="margin:0 0 4px;">${richHtml(s)}</li>`)
                    .join("")}</ul>`
                : ""
            }</li>`
        )
        .join("")}</ul>`;
    return `<p style="${text}margin:0 0 12px;">${richHtml(b.text)}</p>`;
  });
  return `<div>${parts.join("")}</div>`;
}

/** The body as plain text for mail apps that drop formatting (no ** marks). */
export function emailPlain(body: string): string {
  return body.replace(/\*\*/g, "");
}

/** Copy the email formatted (HTML) with plain text as the fallback. */
export async function copyEmail(body: string): Promise<boolean> {
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([emailHtml(body)], { type: "text/html" }),
          "text/plain": new Blob([emailPlain(body)], { type: "text/plain" }),
        }),
      ]);
      return true;
    }
    await navigator.clipboard.writeText(emailPlain(body));
    return true;
  } catch {
    return false;
  }
}
