// Notify the SG team when a public intake form is submitted. Currently
// supports two channels — both fire in parallel, both no-op silently if
// their env var isn't set:
//
//   • Google Chat: GOOGLE_CHAT_INTAKE_WEBHOOK_URL — incoming webhook URL
//     for a Chat Space. Set up via Manage Webhooks in the space settings.
//
//   • Email via Resend: RESEND_API_KEY + INTAKE_NOTIFY_EMAILS (comma-
//     separated recipient list) + INTAKE_NOTIFY_FROM (sender email, must
//     be on a Resend-verified domain).
//
// All failures are caught and logged — the user's form submit never blocks
// on a notification problem.

type IntakeNotificationInput = {
  brandId: string;
  businessName: string;
  submitterName: string;
  submitterEmail: string;
  vertical: string | null;
  hasColors: boolean;
  appUrl: string;
};

export async function notifyIntakeSubmission(input: IntakeNotificationInput): Promise<void> {
  // Fire both channels in parallel — neither blocks the other.
  await Promise.allSettled([sendGoogleChat(input), sendEmail(input)]);
}

// ────────────────────────────────────────────────────────────────────────────
// Google Chat
// ────────────────────────────────────────────────────────────────────────────

async function sendGoogleChat(input: IntakeNotificationInput): Promise<void> {
  const webhook = process.env.GOOGLE_CHAT_INTAKE_WEBHOOK_URL;
  if (!webhook) return;

  const brandUrl = `${input.appUrl}/brand/${input.brandId}`;
  const completeness = input.hasColors ? "✅ Colors attached" : "⚠️ No colors attached";

  const card = {
    cardsV2: [
      {
        cardId: `intake-${input.brandId}`,
        card: {
          header: {
            title: "🌟 New brand intake",
            subtitle: input.businessName,
          },
          sections: [
            {
              widgets: [
                {
                  decoratedText: {
                    topLabel: "Submitter",
                    text: `${input.submitterName} <${input.submitterEmail}>`,
                  },
                },
                {
                  decoratedText: {
                    topLabel: "Vertical",
                    text: input.vertical ?? "—",
                  },
                },
                {
                  decoratedText: {
                    topLabel: "Status",
                    text: "Submitted, awaiting review",
                  },
                },
                {
                  decoratedText: { text: completeness },
                },
                {
                  buttonList: {
                    buttons: [
                      {
                        text: "Review in Surroundings →",
                        onClick: { openLink: { url: brandUrl } },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      },
    ],
  };

  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(card),
    });
    if (!res.ok) {
      console.error(
        `Google Chat webhook returned ${res.status}: ${await res.text().catch(() => "")}`
      );
    }
  } catch (e) {
    console.error(`Google Chat webhook failed: ${(e as Error).message}`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Email via Resend
// ────────────────────────────────────────────────────────────────────────────

async function sendEmail(input: IntakeNotificationInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const recipientsRaw = process.env.INTAKE_NOTIFY_EMAILS;
  const from = process.env.INTAKE_NOTIFY_FROM;
  if (!apiKey || !recipientsRaw || !from) return;

  const to = recipientsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (to.length === 0) return;

  const brandUrl = `${input.appUrl}/brand/${input.brandId}`;
  const verticalLine = input.vertical ? `<p><strong>Vertical:</strong> ${escapeHtml(input.vertical)}</p>` : "";

  const html = `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; background:#f5f5f4; padding:32px; color:#2a2a2a;">
  <div style="max-width:560px; margin:0 auto; background:white; border-radius:12px; padding:32px; border:1px solid #e7e5e4;">
    <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.1em; color:#a8a29e; margin-bottom:8px;">Surroundings</div>
    <h1 style="font-size:22px; margin:0 0 4px 0; font-weight:600;">🌟 New brand intake</h1>
    <h2 style="font-size:28px; margin:0 0 24px 0; font-weight:700; color:#1c1917;">${escapeHtml(input.businessName)}</h2>

    <p><strong>Submitter:</strong> ${escapeHtml(input.submitterName)} &lt;<a href="mailto:${escapeHtml(input.submitterEmail)}" style="color:#6d28d9;">${escapeHtml(input.submitterEmail)}</a>&gt;</p>
    ${verticalLine}
    <p><strong>Status:</strong> Submitted, awaiting review</p>
    <p>${input.hasColors ? "✅ Colors attached" : "⚠️ No colors attached — may need follow-up."}</p>

    <div style="margin-top:32px;">
      <a href="${brandUrl}" style="display:inline-block; background:#6d28d9; color:white; padding:12px 24px; border-radius:8px; text-decoration:none; font-weight:500;">Review in Surroundings →</a>
    </div>

    <p style="margin-top:32px; font-size:12px; color:#a8a29e;">Sent automatically by Surroundings. Reply directly to the submitter to follow up.</p>
  </div>
</body></html>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        reply_to: input.submitterEmail, // hitting reply goes straight to the client
        subject: `🌟 New brand intake: ${input.businessName}`,
        html,
      }),
    });
    if (!res.ok) {
      console.error(`Resend returned ${res.status}: ${await res.text().catch(() => "")}`);
    }
  } catch (e) {
    console.error(`Resend send failed: ${(e as Error).message}`);
  }
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
