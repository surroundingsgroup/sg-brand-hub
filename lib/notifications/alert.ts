// Critical-error alerts to Google Chat. Use when a user-facing flow
// (approve, intake, etc.) fails in a way the AM would want to know
// about immediately — Vercel logs catch everything else, but those
// require somebody to actively look.
//
// Driven by GOOGLE_CHAT_ALERTS_WEBHOOK_URL. Falls back to the intake
// webhook (GOOGLE_CHAT_INTAKE_WEBHOOK_URL) if no separate alerts
// channel is configured — better to ping the team than to swallow
// the error.
//
// Best-effort: if the webhook itself fails, the error is logged to
// console.error so it still shows up in Vercel logs.

type AlertInput = {
  /** Short name for the failing flow: 'approve', 'intake', 'dropbox', etc. */
  flow: string;
  /** Optional brand context so the alert is actionable. */
  brandId?: string | null;
  brandName?: string | null;
  /** The error itself. */
  error: unknown;
  /** Optional structured extras for debugging. */
  extras?: Record<string, unknown>;
};

export async function alertError(input: AlertInput): Promise<void> {
  const webhook =
    process.env.GOOGLE_CHAT_ALERTS_WEBHOOK_URL ||
    process.env.GOOGLE_CHAT_INTAKE_WEBHOOK_URL;

  const errMsg = errorMessage(input.error);
  const stack = errorStack(input.error);

  // Always log to console — Vercel captures this regardless of webhook state.
  console.error(
    `[ALERT] flow=${input.flow}` +
      (input.brandId ? ` brand=${input.brandId}` : "") +
      ` error=${errMsg}` +
      (input.extras ? ` extras=${JSON.stringify(input.extras)}` : ""),
    stack ?? ""
  );

  if (!webhook) return;

  const fields: Array<{ topLabel: string; text: string }> = [
    { topLabel: "Flow", text: input.flow },
    { topLabel: "Error", text: errMsg },
  ];
  if (input.brandName) fields.push({ topLabel: "Brand", text: input.brandName });
  if (input.brandId) fields.push({ topLabel: "Brand ID", text: input.brandId });
  if (input.extras) {
    for (const [k, v] of Object.entries(input.extras)) {
      fields.push({ topLabel: k, text: String(v) });
    }
  }

  const card = {
    cardsV2: [
      {
        cardId: `alert-${Date.now()}`,
        card: {
          header: {
            title: `🚨 Surroundings error — ${input.flow}`,
            subtitle: input.brandName ?? errMsg.slice(0, 80),
          },
          sections: [
            {
              widgets: fields.map((f) => ({
                decoratedText: { topLabel: f.topLabel, text: f.text },
              })),
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
        `Alert webhook returned ${res.status}: ${await res.text().catch(() => "")}`
      );
    }
  } catch (e) {
    console.error(`Alert webhook failed: ${(e as Error).message}`);
  }
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

function errorStack(e: unknown): string | undefined {
  if (e instanceof Error) return e.stack;
  return undefined;
}
