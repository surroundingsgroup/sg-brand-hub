import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/auth/domain";
import { TopNav } from "@/components/shell/top-nav";
import { ProfileNudge } from "@/components/shell/profile-nudge";
import { MobileTabBar } from "@/components/shell/mobile-shell";

export default async function InternalLayout({ children }: { children: React.ReactNode }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  if (!isEmailAllowed(user.email)) redirect("/login?error=domain");

  // What's missing on the signed-in user's own profile? Drives the
  // top-of-page nudge banner that dismisses per day.
  const email = user.email ?? null;
  const needs: string[] = [];
  if (email) {
    const { data: me } = await supabase
      .from("team_profiles")
      .select("phone, birthday, start_date, title")
      .eq("email", email.toLowerCase())
      .maybeSingle();
    if (!me?.phone) needs.push("phone");
    if (!me?.birthday) needs.push("birthday");
    if (!me?.start_date) needs.push("start date");
    if (!me?.title) needs.push("title");
  }

  return (
    <div className="min-h-screen bg-canvas">
      <TopNav email={email ?? ""} />
      <ProfileNudge email={email} needs={needs} />
      {/* On phones, leave room for the fixed bottom tab bar (+ home indicator). */}
      <main className="pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0">{children}</main>
      <MobileTabBar email={email ?? ""} />
    </div>
  );
}
