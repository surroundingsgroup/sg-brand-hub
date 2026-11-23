// Nudge when Muse fulfills a "find more" request (marks it done via the
// connector). Fires Google Chat + email, each best-effort and each a no-op if
// its env isn't set, so it never blocks Muse's done call.
//
// Chat falls back to the existing GOOGLE_CHAT_INTAKE_WEBHOOK_URL, so it works
// out of the box. To aim it at just yourself instead, set:
//   • GOOGLE_CHAT_MUSE_WEBHOOK_URL — an incoming webhook for your own Chat space
//   • MUSE_NOTIFY_EMAILS           — comma-separated recipients (email path also
//     needs RESEND_API_KEY + INTAKE_NOTIFY_FROM configured on the hub)

type RequestFulfilledInput = {
  brandId: string;
  clientName: string;
  ask: string;
  requestedBy: string | null;
  resultCount: number | null;
  note: string | null;
};

const socialdeskUrl = () => (process.env.SOCIALDESK_URL || "https://socialdesk-lac.vercel.app").replace(/\/$/, "");
const countLabel = (n: number | null) => (n != null ? `${n} new item${n === 1 ? "" : "s"}` : "new items");

export async function notifyRequestFulfilled(input: RequestFulfilledInput): Promise<void> {
  await Promise.allSettled([sendChat(input), sendEmail(input)]);
}

async function sendChat(input: RequestFulfilledInput): Promise<void> {
  const webhook = process.env.GOOGLE_CHAT_MUSE_WEBHOOK_URL || process.env.GOOGLE_CHAT_INTAKE_WEBHOOK_URL;
  if (!webhook) return;
  const card = {
    cardsV2: [
      {
        cardId: `muse-done-${input.brandId}-${Date.now()}`,
        card: {
          header: { title: "✨ Muse found what you asked for", subtitle: input.clientName },
          sections: [
            {
              widgets: [
                { decoratedText: { topLabel: "Request", text: input.ask } },
                { decoratedText: { topLabel: "Found", text: countLabel(input.resultCount) } },
                ...(input.note ? [{ decoratedText: { topLabel: "Muse's note", text: input.note } }] : []),
                { decoratedText: { text: "Open SocialDesk → the client's Inspiration panel → Refresh." } },
                { buttonList: { buttons: [{ text: "Open SocialDesk →", onClick: { openLink: { url: socialdeskUrl() } } }] } },
              ],
            },
          ],
        },
      },
    ],
  };
  try {
    const res = await fetch(webhook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(card) });
    if (!res.ok) console.error(`[muse-notify] chat ${res.status}: ${await res.text().catch(() => "")}`);
  } catch (e) {
    console.error(`[muse-notify] chat failed: ${(e as Error).message}`);
  }
}

async function sendEmail(input: RequestFulfilledInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.INTAKE_NOTIFY_FROM;
  const to = (process.env.MUSE_NOTIFY_EMAILS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!apiKey || !from || !to.length) return;
  const sd = socialdeskUrl();
  const html = `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; background:#f5f5f4; padding:32px; color:#2a2a2a;">
  <div style="max-width:560px; margin:0 auto; background:white; border-radius:12px; padding:32px; border:1px solid #e7e5e4;">
    <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.1em; color:#a8a29e; margin-bottom:8px;">SocialDesk · Muse</div>
    <h1 style="font-size:22px; margin:0 0 4px 0; font-weight:600;">✨ Muse found what you asked for</h1>
    <h2 style="font-size:26px; margin:0 0 20px 0; font-weight:700; color:#1c1917;">${escapeHtml(input.clientName)}</h2>
    <p><strong>Request:</strong> ${escapeHtml(input.ask)}</p>
    <p><strong>Found:</strong> ${escapeHtml(countLabel(input.resultCount))}</p>
    ${input.note ? `<p><strong>Muse's note:</strong> ${escapeHtml(input.note)}</p>` : ""}
    <div style="margin-top:28px;">
      <a href="${sd}" style="display:inline-block; background:#2563eb; color:white; padding:12px 24px; border-radius:8px; text-decoration:none; font-weight:500;">Open SocialDesk →</a>
    </div>
    <p style="margin-top:28px; font-size:12px; color:#a8a29e;">Open the client's Inspiration panel and hit Refresh to pull the new finds in.</p>
  </div>
</body></html>`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject: `Muse found ${countLabel(input.resultCount)} for ${input.clientName}`, html }),
    });
    if (!res.ok) console.error(`[muse-notify] resend ${res.status}: ${await res.text().catch(() => "")}`);
  } catch (e) {
    console.error(`[muse-notify] resend failed: ${(e as Error).message}`);
  }
}

function escapeHtml(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
