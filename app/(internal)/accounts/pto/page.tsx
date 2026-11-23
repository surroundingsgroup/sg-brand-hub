// Time off balances, everyone: the number Surroundings works out for each
// person (the individual Monday PTO boards were retired 2026-11-23; Monday's
// copy is the PTO Balances board). Admin only, like the rest of Account
// health (see ../layout.tsx). The request form itself is on /my/pto.

import Link from "next/link";
import { PageContainer, PageHeader } from "@/components/shell/page-container";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PtoBalances } from "@/components/pto/balances";
import { RowFilter } from "@/components/shell/row-filter";
import { buildPtoTeam, fetchPtoEntries, type ProfileRow } from "@/lib/pto/team";
import { auditEveryone, fetchLedgers } from "@/lib/pto/ledgers";
import { PTO_BOARD_URL } from "@/lib/monday/pto";
import { PTO_BALANCES_URL } from "@/lib/pto/monday-board";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export default async function PtoBalancesPage() {
  const supabase = createSupabaseServerClient();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const [{ data: profileRows }, usage, ledgers] = await Promise.all([supabase.from("team_profiles").select("email, name, manager_email, start_date"), fetchPtoEntries(), fetchLedgers()]);
  const profiles = (profileRows ?? []) as unknown as ProfileRow[];
  const team = usage.ok ? buildPtoTeam(profiles, usage.entries, today) : null;
  const audits = usage.ok && ledgers.ok ? auditEveryone(ledgers.ledgers, profiles, usage.entries, today) : [];

  return (
    <PageContainer>
      <PageHeader title="Time off balances" description="Everyone's balance, worked out from the policy and the approved requests. The same numbers are on the PTO Balances board on Monday." />

      <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px]">
        <Link href="/my/pto" className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
          The request form
        </Link>
        <a href={PTO_BOARD_URL} target="_blank" rel="noopener noreferrer" className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
          Time Off Request board
        </a>
        <a href={PTO_BALANCES_URL} target="_blank" rel="noopener noreferrer" className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
          PTO Balances board
        </a>
        <Link href="/accounts" className="ml-auto text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
          Account health
        </Link>
      </div>

      {!team ? (
        <p className="text-[13px] text-muted-foreground">The time-off boards on Monday could not be read just now. Reload in a moment.</p>
      ) : (
        <>
          <RowFilter scope="pto" placeholder="Search people" />
          <PtoBalances people={team.people} audits={audits} unmatched={team.unmatched} everyone asOf={today} />
        </>
      )}
    </PageContainer>
  );
}
