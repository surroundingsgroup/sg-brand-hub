// "Edit your profile" page — self-serve surface for team members to
// fill in the data that powers the directory + birthdays feed.

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ProfileForm } from "./profile-form";
import { findAmByEmail, fetchAllTeamMembers } from "@/lib/monday/teams";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

async function seedNameFromMonday(email: string): Promise<string | null> {
  try {
    const am = await findAmByEmail(email);
    if (am?.name) return am.name;
    const all = await fetchAllTeamMembers();
    return all.find((m) => m.email?.toLowerCase() === email.toLowerCase())?.name ?? null;
  } catch {
    return null;
  }
}

export default async function ProfilePage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) redirect("/login");
  const email = user.email.toLowerCase();

  // Fetch (or seed) this user's profile row.
  let { data: profile } = await supabase
    .from("team_profiles")
    .select("*")
    .eq("email", email)
    .maybeSingle();

  if (!profile) {
    const seedName = await seedNameFromMonday(email);
    const { data: inserted } = await supabase
      .from("team_profiles")
      .insert({ email, name: seedName })
      .select("*")
      .single();
    profile = inserted ?? null;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border/70 bg-panel">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-3">
          <Link
            href="/my"
            className="inline-flex items-center gap-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Back to My Surroundings
          </Link>
          <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Your profile
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-3xl px-6 py-8">
        <header className="mb-8">
          <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Your profile
          </div>
          <h1 className="mt-1.5 text-3xl font-semibold tracking-tight text-foreground md:text-[2.25rem]">
            About you
          </h1>
          <p className="mt-2.5 max-w-prose text-[13px] leading-relaxed text-muted-foreground">
            This is what your teammates see when they look you up in the directory. Birthdays feed the birthday notifications; start date powers work anniversaries.
          </p>
        </header>
        <ProfileForm initialProfile={profile} email={email} />
      </div>
    </div>
  );
}
