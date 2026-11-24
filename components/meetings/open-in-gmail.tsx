"use client";

// "Open in Gmail": a mailto link does nothing without a desktop mail app, and
// a link can't carry formatting. So this copies the formatted email, opens a
// Gmail compose window (to + subject filled in) in a new tab, and says to
// paste the body.

import { Mail } from "lucide-react";
import { toast } from "sonner";
import { copyEmail } from "./email-preview";

export function OpenInGmail({ to, subject, body }: { to: string | null; subject: string; body: string }) {
  async function open() {
    const copied = await copyEmail(body);
    const params = new URLSearchParams({ view: "cm", fs: "1", su: subject });
    if (to) params.set("to", to);
    // If the copy failed, put the plain text in so nothing is lost.
    if (!copied) params.set("body", body);
    window.open(`https://mail.google.com/mail/?${params.toString()}`, "_blank", "noopener");
    if (copied) toast.success("Gmail is opening. The formatted email is copied: click in the body and press ⌘V.");
  }
  return (
    <button
      type="button"
      onClick={open}
      className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
    >
      <Mail className="h-3 w-3" />
      Open in Gmail
    </button>
  );
}
