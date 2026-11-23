// My Surroundings: the personal dashboard. Every card is a working widget:
// your day and your to-dos first, then what is moving on your accounts, a New
// deal form that files straight to Monday, updates, shoutouts and case studies.

import { Suspense } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Briefcase,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  GitBranch,
  Handshake,
  Heart,
  ListChecks,
  Megaphone,
  Trophy,
  MessagesSquare,
  Pin,
  User as UserIcon,
  Users,
  Video,
} from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageContainer } from "@/components/shell/page-container";
import { Tile } from "@/components/client-profile/tile";
import { NewDealWidget } from "@/components/my/new-deal-widget";
import { TodosWidget } from "@/components/my/todos-widget";
import { CaseStudyWidget } from "@/components/my/case-study-widget";
import { ChatWidget } from "@/components/my/chat-widget";
import { fetchConversations } from "@/lib/chat/client";
import { fetchMyDay, type DayEvent } from "@/lib/meetings/my-day";
import { fetchMyTasks } from "@/lib/monday/my-tasks";
import { fetchMyL10Todos } from "@/lib/monday/l10";
import { fetchMyPtoApprovals } from "@/lib/monday/pto";
import { findAmByEmail } from "@/lib/monday/teams";
import { findMondayPerson } from "@/lib/monday/deal-intake";
import { bucketProjects, fetchProjectsForClient } from "@/lib/monday/projects";
import { fetchShoutouts } from "@/lib/monday/shoutouts";
import { loadAccountHealth, type AccountRow } from "@/lib/scope/accounts";
import type { Level } from "@/lib/scope/summary";
import { scopeHasContent, type BrandScope } from "@/lib/scope/types";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const TZ = "America/New_York";

export default async function MyHubPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = user?.email ?? null;

  // Who this is, as their name appears on client records. Some people sign in
  // with one address and sit on Monday under another, hence the second lookup.
  const me = email ? ((await findAmByEmail(email)) ?? (await findMondayPerson(email).catch(() => null))) : null;

  const [{ data: updates }, shoutoutsFromMonday, { data: upcomingEvents }, { data: myProfile }, { data: clientRows }] = await Promise.all([
    supabase
      .from("team_updates")
      .select("id, title, kind, pinned, created_at, created_by_name")
      .order("pinned", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(5),
    fetchShoutouts().catch(() => ({ items: [] as Awaited<ReturnType<typeof fetchShoutouts>>["items"] })),
    supabase
      .from("team_events")
      .select("id, title, kind, starts_at, location")
      .gte("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: true })
      .limit(4),
    email
      ? supabase.from("team_profiles").select("name, avatar_url").eq("email", email.toLowerCase()).maybeSingle()
      : Promise.resolve({ data: null as { name: string | null; avatar_url: string | null } | null }),
    supabase.from("brands").select("business_name").eq("status", "approved").order("business_name"),
  ]);
  const clientNames = (clientRows ?? []).map((b) => b.business_name as string).filter(Boolean);
  const recentShoutouts = shoutoutsFromMonday.items.slice(0, 3);
  const avatarUrl = myProfile?.avatar_url ?? null;
  const myName = me?.name ?? myProfile?.name?.trim() ?? null;
  const displayName = myName ?? (email ? email.split("@")[0] : "there");
  const pinned = (updates ?? []).filter((u) => u.pinned).length;

  return (
    <PageContainer>
      <header className="mb-6 flex items-start justify-between gap-4 border-b border-border/70 pb-6 md:mb-8">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            My Surroundings <span className="mx-1 text-foreground/25">/</span> {todayLabel()}
          </div>
          <h1 className="mt-1.5 text-3xl font-bold tracking-tight text-foreground md:text-[2.25rem]">
            {greet()}, {firstName(displayName)}.
          </h1>
        </div>
        <Link
          href="/my/profile"
          className="inline-flex flex-shrink-0 items-center gap-2 rounded-md border border-border bg-panel px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-secondary"
          title="Edit your profile"
        >
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt={displayName} className="h-5 w-5 rounded-full object-cover" />
          ) : (
            <UserIcon className="h-3.5 w-3.5" />
          )}
          Profile
        </Link>
      </header>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-5 lg:grid-cols-6">
        {/* Row 1: your day and your to-dos */}
        <Suspense fallback={<WidgetLoading label="My day" icon={<CalendarDays />} sub="Reading your calendar" />}>
          <MyDayWidget email={email} />
        </Suspense>
        <Suspense fallback={<WidgetLoading label="To-dos" icon={<ListChecks />} sub="Reading your tasks" />}>
          <TodosTile email={email} />
        </Suspense>

        {/* Row 2: what is moving on your accounts */}
        <Suspense fallback={<WidgetLoading label="On your accounts" icon={<Briefcase />} sub="Reading your accounts" wide />}>
          <OnMyAccountsWidget amName={myName} />
        </Suspense>

        {/* Google Chat, once the workspace has it connected (nothing shows until then) */}
        <Suspense fallback={null}>
          <ChatTile email={email} name={myName} />
        </Suspense>

        {/* Row 3: add a deal, and what is going on */}
        <Tile label="New deal or prospect" icon={<Handshake />} sublabel="Straight to Monday. Scan a card or a screenshot to fill it in." className="lg:col-span-3">
          <NewDealWidget />
        </Tile>

        <div className="flex flex-col gap-3 md:gap-5 lg:col-span-3">
          <Tile
            label="Updates"
            icon={<Megaphone />}
            sublabel={pinned ? `${pinned} pinned` : "From the team"}
            href="/my/updates"
            className="flex-1"
          >
            {!updates || updates.length === 0 ? (
              <Empty>No team updates yet.</Empty>
            ) : (
              <ul className="divide-y divide-border/50">
                {updates.slice(0, 4).map((u) => (
                  <li key={u.id}>
                    <Link href="/my/updates" className="group/row flex items-start gap-2.5 py-2.5 first:pt-0 last:pb-0">
                      <span
                        className={cn(
                          "mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md",
                          u.pinned ? "bg-accent-soft text-accent-foreground" : "bg-secondary text-foreground/45"
                        )}
                      >
                        {u.pinned ? <Pin className="h-3 w-3" /> : <Megaphone className="h-3 w-3" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 text-[13px] font-medium leading-snug text-foreground group-hover/row:underline">{u.title}</span>
                        <span className="mt-0.5 block text-[11px] text-muted-foreground">
                          {kindLabel(u.kind)}
                          {u.created_by_name ? `, ${firstName(u.created_by_name)}` : ""}
                          <span className="mx-1 text-foreground/25">/</span>
                          {relative(u.created_at)}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Tile>

          <Tile label="Coming up" icon={<CalendarCheck />} sublabel="Team events and meetings" href="/my/events" className="flex-1">
            {!upcomingEvents || upcomingEvents.length === 0 ? (
              <Empty>Nothing on the team calendar.</Empty>
            ) : (
              <ul className="space-y-2.5">
                {upcomingEvents.map((e) => {
                  const d = new Date(e.starts_at);
                  return (
                    <li key={e.id}>
                      <Link href="/my/events" className="group/row flex items-center gap-3">
                        <span className="flex h-11 w-11 flex-shrink-0 flex-col items-center justify-center rounded-xl border border-border/70 bg-secondary/50 leading-none">
                          <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-accent-foreground/80">
                            {d.toLocaleDateString("en-US", { month: "short", timeZone: TZ })}
                          </span>
                          <span className="mt-0.5 text-[15px] font-bold tabular-nums text-foreground">
                            {d.toLocaleDateString("en-US", { day: "numeric", timeZone: TZ })}
                          </span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-foreground group-hover/row:underline">{e.title}</span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {d.toLocaleDateString("en-US", { weekday: "short", timeZone: TZ })},{" "}
                            {d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ })}
                            {e.location ? `, ${e.location}` : ""}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Tile>
        </div>

        {/* Row 4: shoutouts, and sending in a case study */}
        <Tile
          label="Shoutouts"
          icon={<Heart />}
          sublabel="Lately, from the team"
          href="/my/shoutouts"
          hrefLabel="Send one"
          className="lg:col-span-3"
        >
          {recentShoutouts.length === 0 ? (
            <Empty>No shoutouts yet. Be the first.</Empty>
          ) : (
            <ul className="space-y-4">
              {recentShoutouts.slice(0, 3).map((s) => (
                <li key={s.id} className="border-l-2 border-foreground/15 pl-3">
                  <p className="line-clamp-4 text-[12.5px] leading-relaxed text-foreground/85">{(s.message ?? "").trim()}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    <span className="font-semibold text-foreground/80">{s.to_name ? `For ${s.to_name}` : (s.kind ?? "Shoutout")}</span>
                    {s.from_name ? `, from ${s.from_name}` : ""}
                    {s.created_at ? (
                      <>
                        <span className="mx-1 text-foreground/25">/</span>
                        {relative(s.created_at)}
                      </>
                    ) : null}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Tile>

        <Tile label="Submit a case study" icon={<Trophy />} sublabel="Goes to Shout Outs & Showcases. The team is emailed when you submit." className="lg:col-span-3">
          <CaseStudyWidget clients={clientNames} />
        </Tile>

        {/* Row 5: the rest of the building */}
        <div className="grid grid-cols-2 gap-3 md:col-span-2 md:gap-5 lg:col-span-6 lg:grid-cols-5">
          <Shortcut href="https://mail.google.com/chat/" external icon={<MessagesSquare className="h-4 w-4" />} title="Google Chat" line="Open team chat" />
          <Shortcut href="/my/team" icon={<Users className="h-4 w-4" />} title="Team directory" line="Phones, titles, birthdays" />
          <Shortcut href="/my/org" icon={<GitBranch className="h-4 w-4" />} title="Org chart" line="Who does what" />
          <Shortcut href="/my/resources" icon={<BookOpen className="h-4 w-4" />} title="Resources" line="Handbook, SOPs, templates" soon />
          <Shortcut href="/my/pto" icon={<CalendarClock className="h-4 w-4" />} title="Time off" line="Request time off and see your requests" />
        </div>
      </div>
    </PageContainer>
  );
}

// ── On your accounts: not the list of clients (that is the Clients page), only
// what is moving on the signed-in person's accounts: shoots in the next two
// weeks, briefs still to write, and anything flagged. Streams in on its own.

const DOT: Record<Level, string> = { green: "bg-emerald-500", yellow: "bg-amber-400", red: "bg-red-500" };
const rank = (l: Level | null) => (l === "red" ? 0 : l === "yellow" ? 1 : l === "green" ? 2 : 3);

type RosterRow = { id: string; business_name: string; account_manager: string | null; engagement_type: string | null; status: string | null; scope: BrandScope | null };

// One plain line on where the account stands, worded like the Account health page.
function statusFor(row: AccountRow): string {
  if (row.renewalStage === "overdue") return `Term ended ${shortDate(row.endDate ?? row.renewalDate ?? "", true)}`;
  const light = [row.month, row.contract].filter((l): l is NonNullable<typeof l> => !!l).sort((a, b) => rank(a.level) - rank(b.level))[0];
  if (light && light.level !== "green") return light.label;
  if ((row.renewalStage === "this_week" || row.renewalStage === "this_month") && row.daysToRenewal != null) {
    return row.daysToRenewal === 0 ? "Renews today" : `Renews in ${row.daysToRenewal} ${row.daysToRenewal === 1 ? "day" : "days"}`;
  }
  return light?.label ?? "On track";
}

async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

// "Client | Project" on Monday: drop the client, it is shown on its own line.
const projectTitle = (name: string, client: string) => {
  const [head, ...rest] = name.split(/\s+\|\s+/);
  const same = rest.length > 0 && head.slice(0, 5).toLowerCase() === client.slice(0, 5).toLowerCase();
  return (same ? rest.join(" | ") : name).trim() || name;
};

type Shoot = { key: string; clientId: string; client: string; title: string; when: string };
type BriefDue = { key: string; clientId: string; client: string; title: string; when: string | null };
type Flag = { key: string; clientId: string; client: string; level: Level | null; note: string };

async function OnMyAccountsWidget({ amName }: { amName: string | null }) {
  const supabase = createSupabaseServerClient();
  const mine = amName?.trim().toLowerCase() ?? null;

  let roster: RosterRow[] = [];
  if (mine) {
    const { data } = await supabase.from("brands").select("id, business_name, account_manager, engagement_type, status, scope").order("business_name");
    roster = ((data ?? []) as RosterRow[]).filter(
      (b) => b.status === "approved" && b.engagement_type !== "inactive" && (b.account_manager ?? "").trim().toLowerCase() === mine
    );
  }

  // Flags: contract health in red or yellow, and scope drafts waiting for a yes.
  const flags: Flag[] = [];
  if (roster.some((b) => scopeHasContent(b.scope))) {
    try {
      const health = await loadAccountHealth(supabase, undefined, { am: amName });
      for (const r of health.rows) {
        if (r.level === "red" || r.level === "yellow") flags.push({ key: `h-${r.id}`, clientId: r.id, client: r.name, level: r.level, note: statusFor(r) });
      }
    } catch {
      // Health could not be read: the rest of the card still shows.
    }
  }
  for (const b of roster) {
    if (b.scope?.pending_draft) flags.push({ key: `d-${b.id}`, clientId: b.id, client: b.business_name, level: "yellow", note: "Scope drafted from the agreement, waiting for you to confirm" });
  }
  flags.sort((a, b) => rank(a.level) - rank(b.level) || a.client.localeCompare(b.client));

  // Shoots in the next two weeks, and projects still waiting on a brief.
  // Shoot dates on Monday are plain wall-clock values, so they are compared and
  // shown as written, never shifted between time zones.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  const horizon = new Date(new Date(`${today}T12:00:00Z`).getTime() + 14 * 86400000).toISOString().slice(0, 10);
  const shoots: Shoot[] = [];
  const briefs: BriefDue[] = [];
  await inBatches(roster, 6, async (b) => {
    const res = await fetchProjectsForClient(b.business_name).catch(() => null);
    const { upcoming, inFlight } = bucketProjects(res?.projects ?? []);
    for (const p of upcoming) {
      const day = (p.shootDateIso ?? "").slice(0, 10);
      if (day >= today && day <= horizon) shoots.push({ key: p.id, clientId: b.id, client: b.business_name, title: projectTitle(p.name, b.business_name), when: p.shootDateIso as string });
    }
    for (const p of [...upcoming, ...inFlight]) {
      if (/needs?.*brief/i.test(p.status ?? "")) {
        briefs.push({ key: p.id, clientId: b.id, client: b.business_name, title: projectTitle(p.name, b.business_name), when: p.shootDateIso });
      }
    }
  });
  shoots.sort((a, b) => a.when.localeCompare(b.when));
  briefs.sort((a, b) => (a.when ?? "9999").localeCompare(b.when ?? "9999"));

  const sub = !roster.length
    ? "Nothing under your name yet"
    : [
        `${shoots.length} ${shoots.length === 1 ? "shoot" : "shoots"} in the next two weeks`,
        briefs.length ? `${briefs.length} ${briefs.length === 1 ? "brief" : "briefs"} to write` : "",
        flags.length ? `${flags.length} to look at` : "",
      ]
        .filter(Boolean)
        .join(", ");

  return (
    <Tile
      label="On your accounts"
      icon={<Briefcase />}
      sublabel={sub}
      href="/dashboard?scope=mine"
      hrefLabel={roster.length ? `All ${roster.length} clients` : "Clients"}
      className="md:col-span-2 lg:col-span-6"
    >
      {!roster.length ? (
        <Empty>No accounts are under your name yet. This fills in as soon as you are set as the account manager on a client.</Empty>
      ) : (
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 md:grid-cols-3">
          <Column title="Shoots coming up" empty="No shoots in the next two weeks." count={shoots.length}>
            {shoots.slice(0, 5).map((x) => (
              <DigestRow key={x.key} href={`/client/${x.clientId}`} lead={<DateChip iso={x.when} />} title={x.title} sub={`${x.client}, ${shootTime(x.when)}`} />
            ))}
            <More n={shoots.length - 5} />
          </Column>
          <Column title="Briefs to write" empty="Every project has its brief." count={briefs.length}>
            {briefs.slice(0, 5).map((x) => (
              <DigestRow
                key={x.key}
                href={`/client/${x.clientId}`}
                lead={x.when ? <DateChip iso={x.when} /> : <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-secondary text-[9px] font-semibold uppercase text-muted-foreground">No date</span>}
                title={x.title}
                sub={x.client}
              />
            ))}
            <More n={briefs.length - 5} />
          </Column>
          <Column title="Worth a look" empty="Nothing flagged on your accounts." count={flags.length}>
            {flags.slice(0, 5).map((x) => (
              <DigestRow
                key={x.key}
                href={`/client/${x.clientId}`}
                lead={
                  <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center">
                    <span className={cn("h-2.5 w-2.5 rounded-full", x.level ? DOT[x.level] : "bg-foreground/15")} />
                  </span>
                }
                title={x.client}
                sub={x.note}
              />
            ))}
            <More n={flags.length - 5} />
          </Column>
        </div>
      )}
    </Tile>
  );
}

function Column({ title, empty, count, children }: { title: string; empty: string; count: number; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{title}</div>
      {count ? <ul className="divide-y divide-border/50">{children}</ul> : <p className="py-1.5 text-[12.5px] text-muted-foreground">{empty}</p>}
    </div>
  );
}

function DigestRow({ href, lead, title, sub }: { href: string; lead: React.ReactNode; title: string; sub: string }) {
  return (
    <li>
      <Link href={href} className="group/row flex items-center gap-3 py-2">
        {lead}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-foreground group-hover/row:underline">{title}</span>
          <span className="block truncate text-[11.5px] text-muted-foreground">{sub}</span>
        </span>
      </Link>
    </li>
  );
}

function DateChip({ iso }: { iso: string }) {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return (
    <span className="flex h-9 w-9 flex-shrink-0 flex-col items-center justify-center rounded-lg border border-border/70 bg-secondary/50 leading-none">
      <span className="text-[8px] font-bold uppercase tracking-[0.08em] text-muted-foreground">{d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}</span>
      <span className="mt-0.5 text-[13px] font-bold tabular-nums text-foreground">{d.toLocaleDateString("en-US", { day: "numeric", timeZone: "UTC" })}</span>
    </span>
  );
}

function More({ n }: { n: number }) {
  return n > 0 ? <li className="py-1.5 text-[11.5px] text-muted-foreground">{n} more</li> : null;
}

// "Thu at 5:30 PM"; just the weekday when the project has a date but no time.
function shootTime(iso: string): string {
  const day = new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  if (!m || (m[1] === "00" && m[2] === "00")) return day;
  const h = Number(m[1]);
  return `${day} at ${h % 12 || 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

// ── My day: the signed-in person's own Google Calendar, today and tomorrow.

const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });

function EventRow({ e, now }: { e: DayEvent; now: number }) {
  const start = e.start ? new Date(e.start).getTime() : null;
  const end = e.end ? new Date(e.end).getTime() : null;
  const over = e.day === "today" && !e.allDay && end != null && end < now;
  const live = e.day === "today" && !e.allDay && start != null && start <= now && (end == null || end >= now);
  const details = [e.end && !e.allDay ? `to ${clock(e.end)}` : "", e.location && !/^https?:/i.test(e.location) ? e.location : "", e.guests ? `${e.guests} ${e.guests === 1 ? "guest" : "guests"}` : ""]
    .filter(Boolean)
    .join(", ");
  return (
    <li className={cn("flex items-center gap-3 py-2", over && "opacity-45")}>
      <span className={cn("w-[62px] flex-shrink-0 text-[12px] font-semibold tabular-nums", live ? "text-foreground" : "text-foreground/80")}>
        {e.allDay || !e.start ? "All day" : clock(e.start)}
      </span>
      <span className={cn("h-8 w-0.5 flex-shrink-0 rounded-full", live ? "bg-emerald-500" : "bg-border")} />
      <span className="min-w-0 flex-1">
        <a
          href={e.url ?? "https://calendar.google.com/calendar/r/day"}
          target="_blank"
          rel="noopener noreferrer"
          className="block truncate text-[13px] font-medium text-foreground hover:underline"
        >
          {e.title}
        </a>
        <span className="block truncate text-[11.5px] text-muted-foreground">
          {live ? <span className="font-semibold text-emerald-700">Now</span> : null}
          {live && details ? ", " : ""}
          {details}
          {e.status === "needsAction" ? `${live || details ? ", " : ""}not answered yet` : ""}
        </span>
      </span>
      {e.joinUrl && !over ? (
        <a
          href={e.joinUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "tap-target inline-flex flex-shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1 text-[11.5px] font-semibold transition-colors",
            live ? "border-foreground bg-foreground text-background hover:opacity-90" : "border-border bg-panel text-foreground hover:bg-secondary"
          )}
        >
          <Video className="h-3 w-3" />
          Join
        </a>
      ) : null}
    </li>
  );
}

async function MyDayWidget({ email }: { email: string | null }) {
  const day = email ? await fetchMyDay(email) : null;
  const now = Date.now();
  const today = (day?.events ?? []).filter((e) => e.day === "today");
  const tomorrow = (day?.events ?? []).filter((e) => e.day === "tomorrow");
  const left = today.filter((e) => e.allDay || !e.end || new Date(e.end).getTime() >= now).length;
  const sub = !day?.ok
    ? "Could not read your calendar just now"
    : today.length
      ? left
        ? `${left} left today`
        : "Done for today"
      : "Nothing on today";
  return (
    <Tile
      label="My day"
      icon={<CalendarDays />}
      sublabel={sub}
      href="https://calendar.google.com/calendar/r/day"
      hrefLabel="Open calendar"
      hrefExternal
      className="lg:col-span-3"
    >
      {!day?.ok ? (
        <Empty>Your Google Calendar could not be read just now. It is still one tap away with Open calendar.</Empty>
      ) : (
        <div className="space-y-3">
          {today.length ? (
            <ul className="divide-y divide-border/50">
              {today.map((e) => (
                <EventRow key={e.id} e={e} now={now} />
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-muted-foreground">Nothing on your calendar today.</p>
          )}
          {tomorrow.length ? (
            <div>
              <div className="mb-0.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Tomorrow</div>
              <ul className="divide-y divide-border/50">
                {tomorrow.slice(0, today.length > 3 ? 3 : 6).map((e) => (
                  <EventRow key={e.id} e={e} now={now} />
                ))}
              </ul>
              {tomorrow.length > (today.length > 3 ? 3 : 6) ? (
                <p className="mt-1 text-[11.5px] text-muted-foreground">{tomorrow.length - (today.length > 3 ? 3 : 6)} more tomorrow</p>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </Tile>
  );
}

// ── Chat: the signed-in person's own Google Chat. The card only exists once
// the workspace admin has connected Chat; before that there is nothing to show.

async function ChatTile({ email, name }: { email: string | null; name: string | null }) {
  if (!email) return null;
  const first = await fetchConversations(email, name ?? "");
  if (!first.ok) return null;
  const unread = first.conversations.filter((c) => c.unread).length;
  return (
    <Tile
      label="Chat"
      icon={<MessagesSquare />}
      sublabel={unread ? `${unread} unread` : "Your Google Chat, right here"}
      href="https://mail.google.com/chat/"
      hrefLabel="Open Google Chat"
      hrefExternal
      className="md:col-span-2 lg:col-span-6"
    >
      <ChatWidget initial={first.conversations} />
    </Tile>
  );
}

// ── To-dos: your own list, and what is assigned to you on Monday and due soon.

async function TodosTile({ email }: { email: string | null }) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  const person = email ? await findMondayPerson(email).catch(() => null) : null;
  const [mine, l10, approvals] = person
    ? await Promise.all([fetchMyTasks(person.id, today), fetchMyL10Todos(person.id), fetchMyPtoApprovals(person.id)])
    : [{ ok: false, tasks: [], other: 0 }, { ok: false, todos: [] }, { ok: false, items: [] }];
  const openL10 = l10.todos.filter((t) => !t.inReview);
  const late = mine.tasks.filter((t) => t.due < today).length + openL10.filter((t) => t.due && t.due < today).length;
  const dueToday = mine.tasks.filter((t) => t.due === today).length + openL10.filter((t) => t.due === today).length;
  const toApprove = approvals.items.length;
  const sub = toApprove
    ? `${toApprove} time-off ${toApprove === 1 ? "request" : "requests"} to approve${late ? `, ${late} past due` : ""}`
    : late
      ? `${late} past due`
      : dueToday
        ? `${dueToday} due today`
        : "Your own list, your L10s, and project tasks";
  return (
    <Tile label="To-dos" icon={<ListChecks />} sublabel={sub} className="lg:col-span-3">
      <TodosWidget tasks={mine.tasks} other={mine.other} mondayOk={mine.ok} today={today} l10={l10.todos} l10Ok={l10.ok} approvals={approvals.items} />
    </Tile>
  );
}

function WidgetLoading({ label, icon, sub, wide }: { label: string; icon: React.ReactNode; sub: string; wide?: boolean }) {
  return (
    <Tile label={label} icon={icon} sublabel={sub} className={wide ? "md:col-span-2 lg:col-span-6" : "lg:col-span-3"}>
      <ul className="space-y-3.5" aria-hidden>
        {[70, 52, 62, 46].map((w, i) => (
          <li key={i} className="h-3 animate-pulse rounded bg-foreground/10" style={{ width: `${w}%` }} />
        ))}
      </ul>
    </Tile>
  );
}

// ── Small pieces ────────────────────────────────────────────────────────────

function Shortcut({
  href,
  icon,
  title,
  line,
  soon,
  external,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  line: string;
  soon?: boolean;
  external?: boolean;
}) {
  return (
    <Link
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="tile-glow group flex items-center gap-3 rounded-2xl border border-border/60 bg-panel p-3.5 shadow-[0_1px_2px_rgba(16,10,0,0.04),0_8px_24px_-16px_rgba(16,10,0,0.08)] hover:border-foreground/25 md:p-4"
    >
      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-bold text-foreground">{title}</span>
          {soon ? (
            <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Soon</span>
          ) : null}
        </span>
        <span className="block truncate text-[11.5px] text-muted-foreground">{line}</span>
      </span>
      <ArrowRight className="hidden h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 sm:block" />
    </Link>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-3 text-[12.5px] text-muted-foreground">{children}</p>;
}

const KIND_LABELS: Record<string, string> = {
  announcement: "Announcement",
  policy: "Policy",
  signature: "Needs a signature",
  new_hire: "New hire",
  process: "Process",
  other: "Update",
};
const kindLabel = (k: string | null) => KIND_LABELS[k ?? "other"] ?? "Update";

// The server runs on UTC: read the hour and the date in Tampa time.
function greet(): string {
  const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: TZ }).format(new Date())) % 24;
  if (h < 5) return "Up late";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function todayLabel(): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: TZ }).format(new Date());
}

// "Dec 17"; with the year when asked and the date is not in this year.
function shortDate(iso: string, yearIfOther = false): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (isNaN(d.getTime())) return iso;
  const otherYear = yearIfOther && d.getUTCFullYear() !== new Date().getUTCFullYear();
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(otherYear ? { year: "numeric" } : {}), timeZone: "UTC" });
}

function firstName(name: string): string {
  const first = name.split(/\s+/)[0] ?? name;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

function relative(iso: string): string {
  const then = new Date(iso).getTime();
  if (isNaN(then)) return iso;
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: TZ });
}
