import { redirect } from "next/navigation";
import { createSupabaseServerClient, currentUser } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/auth/domain";
import { TopNav } from "@/components/shell/top-nav";
import { ProfileNudge } from "@/components/shell/profile-nudge";
import { MobileTabBar } from "@/components/shell/mobile-shell";
import { getViewer } from "@/lib/access";

export default async function InternalLayout({ children }: { children: React.ReactNode }) {
  const supabase = createSupabaseServerClient();
  const user = await currentUser(supabase);

  if (!user) redirect("/login");
  if (!isEmailAllowed(user.email ?? undefined)) redirect("/login?error=domain");

  // What's missing on the signed-in user's own profile (drives the nudge
  // banner), and whether they see everything: read side by side.
  const email = user.email ?? null;
  const [profile, viewer] = await Promise.all([
    email
      ? supabase.from("team_profiles").select("phone, birthday, start_date, title").eq("email", email).maybeSingle()
      : Promise.resolve({ data: null }),
    getViewer(supabase),
  ]);
  const me = profile.data as { phone?: string | null; birthday?: string | null; start_date?: string | null; title?: string | null } | null;
  const needs: string[] = [];
  if (email) {
    if (!me?.phone) needs.push("phone");
    if (!me?.birthday) needs.push("birthday");
    if (!me?.start_date) needs.push("start date");
    if (!me?.title) needs.push("title");
  }

  // Account health (and what sits under it) only shows for admins.
  const admin = viewer.everyone;

  return (
    <div className="min-h-screen bg-canvas">
      <TopNav email={email ?? ""} admin={admin} />
      <ProfileNudge email={email} needs={needs} />
      {/* On phones, leave room for the fixed bottom tab bar (+ home indicator). */}
      <main className="pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0">{children}</main>
      <MobileTabBar email={email ?? ""} admin={admin} />
    </div>
  );
}
