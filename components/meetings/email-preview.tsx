"use client";

// The follow-up email as it will read: greeting, opener, small letter-spaced
// section labels with one-line bullets, closing, sign-off. Parsed from the
// plain-text body (so hand edits show up), and copied as formatted HTML so it
// pastes into Gmail looking the same.

type Block = { kind: "p"; text: string } | { kind: "label"; text: string } | { kind: "list"; items: string[] };

const isLabel = (l: string) => /^[A-Z][A-Z '&/]{2,30}$/.test(l.trim());

export function parseEmail(body: string): Block[] {
  const out: Block[] = [];
  for (const raw of body.replace(/\r/g, "").split("\n")) {
    const l = raw.trim();
    if (!l) continue;
    if (/^[•*-]\s+/.test(l)) {
      const item = l.replace(/^[•*-]\s+/, "");
      const last = out[out.length - 1];
      if (last?.kind === "list") last.items.push(item);
      else out.push({ kind: "list", items: [item] });
    } else if (isLabel(l)) out.push({ kind: "label", text: l });
    else out.push({ kind: "p", text: l });
  }
  return out;
}

const title = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

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
        ) : b.kind === "list" ? (
          <ul key={i} className="space-y-1">
            {b.items.map((it, j) => {
              const m = it.match(/^([^:]{2,40}):\s*(.+)$/);
              return (
                <li key={j} className="flex gap-2.5">
                  <span className="mt-[0.6em] h-1 w-1 flex-shrink-0 rounded-full bg-foreground/40" />
                  <span>
                    {m ? (
                      <>
                        <span className="font-semibold text-foreground">{m[1]}:</span> {m[2]}
                      </>
                    ) : (
                      it
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p key={i} className={i === 0 ? "" : "mt-3"}>
            {b.text}
          </p>
        )
      )}
    </div>
  );
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Email-safe HTML (inline styles) for pasting into Gmail or Outlook. */
export function emailHtml(body: string): string {
  const font = "font-family:Helvetica,Arial,sans-serif;";
  const parts = parseEmail(body).map((b) => {
    if (b.kind === "label")
      return `<div style="${font}font-size:11px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:#8a8178;margin:20px 0 6px;">${esc(title(b.text))}</div>`;
    if (b.kind === "list")
      return `<ul style="${font}font-size:14px;line-height:1.55;color:#111111;margin:0 0 0 18px;padding:0;">${b.items
        .map((it) => {
          const m = it.match(/^([^:]{2,40}):\s*(.+)$/);
          return `<li style="margin:0 0 4px;">${m ? `<strong>${esc(m[1])}:</strong> ${esc(m[2])}` : esc(it)}</li>`;
        })
        .join("")}</ul>`;
    return `<p style="${font}font-size:14px;line-height:1.55;color:#111111;margin:0 0 12px;">${esc(b.text)}</p>`;
  });
  return `<div>${parts.join("")}</div>`;
}

/** Copy the email formatted (HTML) with plain text as the fallback. */
export async function copyEmail(body: string): Promise<boolean> {
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([emailHtml(body)], { type: "text/html" }),
          "text/plain": new Blob([body], { type: "text/plain" }),
        }),
      ]);
      return true;
    }
    await navigator.clipboard.writeText(body);
    return true;
  } catch {
    return false;
  }
}
