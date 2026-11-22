// My Hub landing — the personal workspace. Cards link into updates,
// shoutouts, events, team directory, org, resources, PTO, profile.
// Also surfaces live previews from the three feed-style surfaces.

import Link from "next/link";
import {
  Users,
  BookOpen,
  CalendarClock,
  Briefcase,
  ArrowRight,
  Megaphone,
  Heart,
  CalendarCheck,
  GitBranch,
  User as UserIcon,
  Handshake,
} from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageContainer } from "@/components/shell/page-container";
import { findAmByEmail } from "@/lib/monday/teams";
import { fetchShoutouts } from "@/lib/monday/shoutouts";

export const dynamic = "force-dynamic";

export default async function MyHubPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = user?.email ?? null;

  const me = email ? await findAmByEmail(email) : null;
  const displayName = me?.name ?? (email ? email.split("@")[0] : "there");

  // Everything in parallel.
  const [
    { data: myBrands },
    { data: pinnedUpdates },
    shoutoutsFromMonday,
    { data: upcomingEvents },
    { data: myProfile },
  ] = await Promise.all([
    supabase
      .from("brands")
      .select("id, business_name")
      .eq("account_manager", me?.name ?? "__never__")
      .eq("status", "approved")
      .order("updated_at", { ascending: false })
      .limit(6),
    supabase
      .from("team_updates")
      .select("id, title, kind, pinned, created_at, created_by_name")
      .order("pinned", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(4),
    fetchShoutouts(),
    supabase
      .from("team_events")
      .select("id, title, kind, starts_at, location")
      .gte("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: true })
      .limit(4),
    email
      ? supabase
          .from("team_profiles")
          .select("avatar_url")
          .eq("email", email.toLowerCase())
          .maybeSingle()
      : Promise.resolve({ data: null as { avatar_url: string | null } | null }),
  ]);
  const recentShoutouts = shoutoutsFromMonday.items.slice(0, 3);

  const myBrandCount = myBrands?.length ?? 0;
  const avatarUrl = myProfile?.avatar_url ?? null;

  return (
    <PageContainer>
      <header className="mb-8 flex items-start justify-between gap-4 border-b border-border/70 pb-6">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            My Surroundings
          </div>
          <h1 className="mt-1.5 text-3xl font-semibold tracking-tight text-foreground md:text-[2.25rem]">
            {greet()}, {firstName(displayName)}.
          </h1>
          <p className="mt-2.5 max-w-prose text-[13px] leading-relaxed text-muted-foreground">
            Your workspace. {myBrandCount > 0 ? `${myBrandCount} active ${myBrandCount === 1 ? "client" : "clients"} on your roster. ` : ""}Team, updates, events, and your profile live here.
          </p>
        </div>
        <Link
          href="/my/profile"
          className="inline-flex flex-shrink-0 items-center gap-2 rounded-md border border-border bg-panel px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-secondary"
          title="Edit your profile"
        >
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt={displayName}
              className="h-5 w-5 rounded-full object-cover"
            />
          ) : (
            <UserIcon className="h-3.5 w-3.5" />
          )}
          Profile
        </Link>
      </header>

      {/* Row 1 — Your clients + Updates (both prominent) */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <SectionCard
          label="Your clients"
          icon={<Briefcase className="h-4 w-4" />}
          href="/dashboard?scope=mine"
          cta="Open client list"
          stat={myBrandCount > 0 ? `${myBrandCount}` : null}
        >
          {myBrandCount === 0 ? (
            <p className="text-[12px] italic text-muted-foreground">
              No clients assigned to you yet. Ariel or Camilla assigns new intakes.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {myBrands!.slice(0, 5).map((b) => (
                <li key={b.id}>
                  <Link
                    href={`/client/${b.id}`}
                    className="flex items-center justify-between gap-2 text-[13px] text-foreground transition-colors hover:text-accent-foreground"
                  >
                    <span className="truncate">{b.business_name}</span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          label="Updates"
          icon={<Megaphone className="h-4 w-4" />}
          href="/my/updates"
          cta="Open updates"
          stat={pinnedUpdates?.filter((u) => u.pinned).length ? `${pinnedUpdates.filter((u) => u.pinned).length} pinned` : null}
        >
          {!pinnedUpdates || pinnedUpdates.length === 0 ? (
            <p className="text-[12px] italic text-muted-foreground">
              No team updates yet. Post the first announcement.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {pinnedUpdates.slice(0, 4).map((u) => (
                <li key={u.id} className="flex items-start justify-between gap-2 text-[13px]">
                  <span className="truncate text-foreground">{u.title}</span>
                  <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                    {u.pinned ? "📌 " : ""}
                    {relative(u.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        {/* Row 2 — Team + Events */}
        <SectionCard
          label="Team directory"
          icon={<Users className="h-4 w-4" />}
          href="/my/team"
          cta="Open team"
        >
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            Everyone at Surroundings Group. Phones, titles, skills, birthdays, work anniversaries.
          </p>
        </SectionCard>

        <SectionCard
          label="Events & meetings"
          icon={<CalendarCheck className="h-4 w-4" />}
          href="/my/events"
          cta="Open events"
          stat={upcomingEvents?.length ? `${upcomingEvents.length}` : null}
        >
          {!upcomingEvents || upcomingEvents.length === 0 ? (
            <p className="text-[12px] italic text-muted-foreground">
              No upcoming team events.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {upcomingEvents.slice(0, 4).map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-2 text-[13px]">
                  <span className="truncate text-foreground">{e.title}</span>
                  <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                    {new Date(e.starts_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        {/* Row 3 — Shoutouts + Org */}
        <SectionCard
          label="Recent shoutouts"
          icon={<Heart className="h-4 w-4" />}
          href="/my/shoutouts"
          cta="Send a shoutout"
        >
          {recentShoutouts.length === 0 ? (
            <p className="text-[12px] italic text-muted-foreground">
              No shoutouts yet. Be the first — it&apos;s contagious.
            </p>
          ) : (
            <ul className="space-y-2">
              {recentShoutouts.slice(0, 2).map((s) => (
                <li key={s.id} className="text-[12px] leading-relaxed text-foreground/85">
                  <span className="text-muted-foreground">To </span>
                  <span className="font-medium text-foreground">{s.to_name ?? "the team"}:</span>{" "}
                  <span className="italic">&ldquo;{(s.message ?? "").slice(0, 110)}{(s.message ?? "").length > 110 ? "…" : ""}&rdquo;</span>
                  <span className="text-[10.5px] text-muted-foreground"> — {s.from_name ?? "anon"}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          label="Org chart"
          icon={<GitBranch className="h-4 w-4" />}
          href="/my/org"
          cta="Who does what"
        >
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            Team grouped by department. Find the right person without pinging Slack.
          </p>
        </SectionCard>

        {/* Row 4 — New deal (primary external quick action) + Resources */}
        <DealCard />
        <SectionCard
          label="Resources"
          icon={<BookOpen className="h-4 w-4" />}
          href="/my/resources"
          cta="Browse resources"
          badge="Soon"
        >
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            Handbook, SOPs, Canva templates, brand kit, sales assets.
          </p>
        </SectionCard>

        {/* Row 5 — PTO (soon) */}
        <SectionCard
          label="Paid time off"
          icon={<CalendarClock className="h-4 w-4" />}
          href="/my/pto"
          cta="Request PTO"
          badge="Soon"
        >
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            Request time off. Routes to Justin + lands on the shared calendar.
          </p>
        </SectionCard>
      </div>
    </PageContainer>
  );
}

// Deal card — external quick-action. Opens the existing Quick Add Deal
// form at surroundingsgroup.com/deal in a new tab. The form itself is
// already PIN-locked + wired to the Monday Deals board, so we don't
// need to duplicate the logic in the Hub.
function DealCard() {
  const url =
    process.env.NEXT_PUBLIC_DEAL_FORM_URL ?? "https://surroundingsgroup.com/deal";
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex flex-col rounded-xl border border-border/70 bg-panel p-5 transition-colors hover:border-accent/50"
    >
      <header className="mb-3 flex items-center justify-between gap-3 border-b border-border/60 pb-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft text-accent-foreground">
            <Handshake className="h-3.5 w-3.5" />
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground">
            New deal
          </span>
        </div>
      </header>
      <p className="flex-1 text-[12.5px] leading-relaxed text-muted-foreground">
        Log a prospect or add a deal. Routes straight into the Monday deals board.
      </p>
      <footer className="mt-4 flex items-center gap-1 text-[11px] text-muted-foreground transition-colors group-hover:text-foreground">
        Open deal form
        <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
      </footer>
    </a>
  );
}

function greet(): string {
  const h = new Date().getHours();
  if (h < 5) return "Up late";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function firstName(name: string): string {
  const first = name.split(/\s+/)[0] ?? name;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

function relative(iso: string): string {
  const then = new Date(iso).getTime();
  if (isNaN(then)) return iso;
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function SectionCard({
  label,
  icon,
  href,
  cta,
  stat,
  badge,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  href: string;
  cta: string;
  stat?: string | null;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col rounded-xl border border-border/70 bg-panel p-5 transition-colors hover:border-foreground/20"
    >
      <header className="mb-3 flex items-center justify-between gap-3 border-b border-border/60 pb-3">
        <div className="flex items-center gap-2">
          <span className="text-foreground/50">{icon}</span>
          <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {label}
          </span>
          {badge ? (
            <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
              {badge}
            </span>
          ) : null}
        </div>
        {stat ? (
          <span className="text-[13px] font-semibold tabular-nums text-foreground">
            {stat}
          </span>
        ) : null}
      </header>
      <div className="flex-1">{children}</div>
      <footer className="mt-4 flex items-center gap-1 text-[11px] text-muted-foreground transition-colors group-hover:text-foreground">
        {cta}
        <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
      </footer>
    </Link>
  );
}
