// Team Directory — searchable list + birthdays/anniversaries sidebar
// + who's-out-today strip (placeholder until PTO ships).

import Link from "next/link";
import { Cake, PartyPopper, Edit3, Umbrella } from "lucide-react";
import { PageContainer } from "@/components/shell/page-container";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchAllTeamMembers, fetchAccountManagers } from "@/lib/monday/teams";
import {
  type TeamProfile,
  fmtMMDD,
  daysUntilNextOccurrence,
  yearsSince,
} from "@/lib/team/profile";
import { TeamDirectoryList } from "./team-directory";
import type { DirectoryRow } from "./person-row";

export const dynamic = "force-dynamic";

export default async function TeamDirectoryPage() {
  const supabase = createSupabaseServerClient();

  const [all, amsRes, profilesRes, signedInRes] = await Promise.all([
    fetchAllTeamMembers().catch(() => []),
    fetchAccountManagers().catch(() => []),
    supabase.from("team_profiles").select("*"),
    supabase.auth.getUser(),
  ]);

  const amIds = amsRes.map((a) => a.id);
  const amIdSet = new Set(amIds);
  const profiles = (profilesRes.data ?? []) as TeamProfile[];
  const profileByEmail = new Map(profiles.map((p) => [p.email.toLowerCase(), p]));
  const signedInEmail = signedInRes.data.user?.email?.toLowerCase() ?? null;

  const rows: DirectoryRow[] = all
    .filter((m) => m.email)
    .map((m) => {
      const em = m.email!.toLowerCase();
      return {
        monday_id: m.id,
        email: em,
        name: m.name,
        profile: profileByEmail.get(em) ?? null,
      };
    });
  const seen = new Set(rows.map((r) => r.email));
  for (const p of profiles) {
    if (seen.has(p.email.toLowerCase())) continue;
    rows.push({
      monday_id: null,
      email: p.email.toLowerCase(),
      name: p.name ?? p.email.split("@")[0],
      profile: p,
    });
  }
  rows.sort((a, b) =>
    (a.profile?.name ?? a.name).localeCompare(b.profile?.name ?? b.name)
  );

  // Birthdays + anniversaries in the next 60 days.
  type Celebration = { name: string; email: string; mmdd: string; days: number; years?: number };
  const birthdays: Celebration[] = [];
  const anniversaries: Celebration[] = [];
  const now = new Date();
  for (const r of rows) {
    const p = r.profile;
    if (!p) continue;
    const bDays = daysUntilNextOccurrence(p.birthday, now);
    if (bDays !== null && bDays >= 0 && bDays <= 60) {
      birthdays.push({
        name: p.name ?? r.name,
        email: r.email,
        mmdd: fmtMMDD(p.birthday) ?? "",
        days: bDays,
      });
    }
    const aDays = daysUntilNextOccurrence(p.start_date, now);
    if (aDays !== null && aDays >= 0 && aDays <= 60 && p.start_date) {
      const years = yearsSince(p.start_date, now) + (aDays > 0 ? 1 : 0);
      anniversaries.push({
        name: p.name ?? r.name,
        email: r.email,
        mmdd: fmtMMDD(p.start_date) ?? "",
        days: aDays,
        years,
      });
    }
  }
  birthdays.sort((a, b) => a.days - b.days);
  anniversaries.sort((a, b) => a.days - b.days);

  return (
    <PageContainer>
      <header className="mb-8 flex items-end justify-between gap-4 border-b border-border/70 pb-6">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            My Surroundings · Team Directory
          </div>
          <h1 className="mt-1.5 text-3xl font-semibold tracking-tight text-foreground md:text-[2.25rem]">
            The team
          </h1>
          <p className="mt-2.5 max-w-prose text-[13px] leading-relaxed text-muted-foreground">
            Everyone at Surroundings Group. Names and emails come from Monday. Everything else is self-written — fill out your profile so your teammates can find you.
          </p>
        </div>
        <Link
          href="/my/profile"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-panel px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-secondary"
        >
          <Edit3 className="h-3.5 w-3.5" />
          Edit your profile
        </Link>
      </header>

      {/* Who's out today — stub until PTO ships */}
      <div className="mb-5 flex items-center gap-3 rounded-xl border border-border/70 bg-panel px-4 py-3 text-[12.5px]">
        <Umbrella className="h-4 w-4 text-muted-foreground" />
        <span className="text-foreground">
          <span className="font-medium">Out today:</span>
          <span className="ml-1 italic text-muted-foreground">
            Lights up once PTO is wired. For now, check Slack #out-of-office.
          </span>
        </span>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <TeamDirectoryList rows={rows} amIds={amIds} myEmail={signedInEmail} />
        <aside className="flex flex-col gap-4">
          <SideCard
            label="Birthdays"
            icon={<Cake className="h-3.5 w-3.5" />}
            emptyLabel="No upcoming birthdays in the next 60 days."
          >
            {birthdays.map((b) => (
              <li
                key={`b-${b.email}`}
                className="flex items-center justify-between gap-3 py-1.5 text-[12.5px]"
              >
                <span className="truncate text-foreground">{b.name}</span>
                <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                  {b.mmdd}
                  <span className="ml-1 text-accent-foreground">
                    · {b.days === 0 ? "today" : `${b.days}d`}
                  </span>
                </span>
              </li>
            ))}
          </SideCard>
          <SideCard
            label="Work anniversaries"
            icon={<PartyPopper className="h-3.5 w-3.5" />}
            emptyLabel="No upcoming anniversaries in the next 60 days."
          >
            {anniversaries.map((a) => (
              <li
                key={`a-${a.email}`}
                className="flex items-center justify-between gap-3 py-1.5 text-[12.5px]"
              >
                <span className="truncate text-foreground">
                  {a.name}
                  <span className="ml-1 text-muted-foreground">· {a.years}y</span>
                </span>
                <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                  {a.mmdd}
                  <span className="ml-1 text-accent-foreground">
                    · {a.days === 0 ? "today" : `${a.days}d`}
                  </span>
                </span>
              </li>
            ))}
          </SideCard>
        </aside>
      </div>
    </PageContainer>
  );
}

function SideCard({
  label,
  icon,
  emptyLabel,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  emptyLabel: string;
  children: React.ReactNode;
}) {
  const hasContent = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <section className="rounded-xl border border-border/70 bg-panel p-4">
      <header className="flex items-center gap-1.5 border-b border-border/60 pb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        <span className="text-foreground/50">{icon}</span>
        {label}
      </header>
      {hasContent ? (
        <ul className="mt-1 divide-y divide-border/50">{children}</ul>
      ) : (
        <p className="mt-2 text-[11.5px] italic text-muted-foreground">
          {emptyLabel}
        </p>
      )}
    </section>
  );
}
