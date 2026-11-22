// Fill-your-profile nudge — a quiet amber banner that shows on every
// internal page until the signed-in user's own profile has the basics
// filled in (phone, birthday, start_date, title). Dismissed via
// localStorage until the end of the day; comes back tomorrow if the
// profile is still incomplete.

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X, UserCheck } from "lucide-react";

type Props = {
  email: string | null;
  needs: string[];
};

export function ProfileNudge({ email, needs }: Props) {
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    if (!email || needs.length === 0) return;
    try {
      const key = `profile-nudge-dismissed:${email}:${new Date().toISOString().slice(0, 10)}`;
      if (localStorage.getItem(key)) return;
      setHidden(false);
    } catch {
      setHidden(false);
    }
  }, [email, needs.length]);

  function dismiss() {
    if (!email) return;
    try {
      const key = `profile-nudge-dismissed:${email}:${new Date().toISOString().slice(0, 10)}`;
      localStorage.setItem(key, "1");
    } catch {}
    setHidden(true);
  }

  if (hidden || !email || needs.length === 0) return null;

  return (
    <div className="border-b border-amber-200 bg-amber-50">
      <div className="mx-auto flex w-full max-w-[1280px] items-center justify-between gap-4 px-6 py-2.5 text-[12.5px] text-amber-900">
        <div className="flex items-center gap-2">
          <UserCheck className="h-3.5 w-3.5 flex-shrink-0" />
          <span>
            <span className="font-medium">Finish your profile:</span>{" "}
            <span className="text-amber-900/85">
              add your {needs.slice(0, 3).join(", ")}
              {needs.length > 3 ? ` + ${needs.length - 3} more` : ""}
            </span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/my/profile"
            className="rounded-md bg-amber-900 px-2.5 py-1 text-[11px] font-medium text-amber-50 transition-opacity hover:opacity-90"
          >
            Open profile
          </Link>
          <button
            type="button"
            onClick={dismiss}
            className="rounded-md p-1 text-amber-900/70 transition-colors hover:bg-amber-100 hover:text-amber-900"
            title="Dismiss until tomorrow"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
