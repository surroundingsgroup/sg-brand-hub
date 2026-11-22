"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

// Login is Google-only as of 2026-05-30. The team is fully on Google Workspace
// (both @surroundingsgroup.com and @nauticalnetwork.com) so the magic-link
// fallback wasn't worth the maintenance burden. If you ever need to add it
// back, the server-side signInWithOtp + /auth/callback PKCE handler are still
// in place — just re-add the email form UI.

export function LoginCard({ error, next }: { error?: string; next?: string }) {
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleGoogle() {
    setFormError(null);
    setLoading(true);
    const supabase = createSupabaseBrowserClient();
    const redirectTo = new URL("/auth/callback", window.location.origin);
    if (next) redirectTo.searchParams.set("next", next);

    // Domain allow-list is enforced server-side in /auth/callback — any
    // Google account can start the flow, but only @surroundingsgroup.com or
    // @nauticalnetwork.com addresses are accepted at callback.
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: redirectTo.toString(),
        queryParams: {
          access_type: "offline",
          prompt: "select_account",
        },
      },
    });
    if (oauthError) {
      setFormError(oauthError.message);
      setLoading(false);
    }
    // No need to clear loading on success — we're being redirected away.
  }

  return (
    <div className="panel w-full max-w-md p-10">
      <div className="flex flex-col items-center text-center">
        <Eyebrow>Surroundings Group</Eyebrow>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Surroundings</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your clients, your team, your processes.
        </p>
      </div>

      <div className="mt-8 flex flex-col gap-3">
        <Button
          type="button"
          size="lg"
          className="w-full"
          onClick={handleGoogle}
          disabled={loading}
        >
          <GoogleIcon className="mr-2 h-4 w-4" />
          {loading ? "Redirecting…" : "Continue with Google"}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          Restricted to @surroundingsgroup.com and @nauticalnetwork.com Google
          Workspace accounts.
        </p>
      </div>

      {(formError || error === "domain") && (
        <div className="mt-6 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {formError ?? "That Google account isn't on an approved domain."}
        </div>
      )}
      {error === "callback" && (
        <div className="mt-6 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Sign-in didn't complete. Try clicking Continue with Google again.
        </div>
      )}
    </div>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        fill="#EA4335"
        d="M12 10.2v3.92h5.45c-.23 1.4-1.66 4.12-5.45 4.12-3.28 0-5.95-2.71-5.95-6.06s2.67-6.06 5.95-6.06c1.86 0 3.11.79 3.83 1.48l2.6-2.52C16.74 3.6 14.6 2.6 12 2.6 6.83 2.6 2.65 6.78 2.65 12s4.18 9.4 9.35 9.4c5.4 0 8.96-3.79 8.96-9.14 0-.61-.06-1.08-.15-1.55H12z"
      />
      <path
        fill="#4285F4"
        d="M21.96 11.65c0-.59-.05-1.16-.15-1.7H12v3.91h5.6c-.24 1.3-.96 2.4-2.04 3.13v2.6h3.3c1.93-1.78 3.04-4.4 3.04-7.5l.06-.44z"
      />
      <path
        fill="#FBBC05"
        d="M5.62 14.42c-.24-.7-.38-1.45-.38-2.22s.14-1.52.38-2.22V7.32H2.18A9.78 9.78 0 001.1 12c0 1.56.37 3.04 1.08 4.34l2.44-1.92z"
      />
      <path
        fill="#34A853"
        d="M12 21.4c2.7 0 4.96-.89 6.62-2.42l-3.3-2.6c-.91.62-2.12 1.05-3.32 1.05-2.55 0-4.71-1.72-5.48-4.04L3.06 15.3C4.7 18.96 8.1 21.4 12 21.4z"
      />
    </svg>
  );
}
