// Client profile — the Hub's primary surface for an AM. One page, one
// client, a grid of tiles that each surface a slice of the client's
// state across Hub + Monday + SocialDesk + Dropbox.
//
// Today most tiles are placeholders / shells; they get wired over the
// next two weeks:
//   • Brand summary  — from brands + brand_logos (LIVE below)
//   • Projects       — reads Monday "All Projects" board, filtered to
//                      this brand/client (placeholder)
//   • Content pulse  — reads SocialDesk's per-client API (placeholder)
//   • Scope + health — contract scope form + delivered-vs-owed graph
//                      (placeholder)
//   • Internal notes — AM scratchpad (placeholder — reuses the
//                      existing internal_notes column for now)
//   • Dropbox        — deep link to the brand's parent folder (LIVE if
//                      dropbox_folder_url is set)

import { notFound } from "next/navigation";
import Link from "next/link";
import {
  FileText,
  FolderOpen,
  ChevronLeft,
} from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Tile, TileEmpty } from "@/components/client-profile/tile";
import { ProjectsTile } from "@/components/client-profile/projects-tile";
import { SocialDeskTile } from "@/components/client-profile/socialdesk-tile";
import { ScopeTile } from "@/components/client-profile/scope-tile";
import { SectionNav } from "@/components/client-profile/section-nav";
import { fetchAccountManagers } from "@/lib/monday/teams";
import { ContactTile } from "@/components/client-profile/contact-tile";
import { NeedsYouBar } from "@/components/client-profile/needs-you-bar";
import { OnboardingTile } from "@/components/client-profile/onboarding-tile";
import { loadOnboardingChecklist } from "@/lib/onboarding/checklist";
import { fetchClientLifecycle } from "@/lib/meetings/calendar";
import { AllocationTile } from "@/components/client-profile/allocation-tile";
import { boardHoursFor, fetchBoardAllocations } from "@/lib/allocations/board-hours";
import { fetchInvoices, invoicesFor } from "@/lib/monday/invoicing";
import { getViewer } from "@/lib/access";
import { MeetingsTile } from "@/components/client-profile/meetings-tile";
import { InvoicingTile, overdueInvoiceCount } from "@/components/client-profile/invoicing-tile";
import { IndustryUpdateTile } from "@/components/client-profile/industry-update-tile";
import { ClientHero } from "@/components/client-profile/client-hero";
import { fetchClientBoardData, fetchAllocationSetup } from "@/lib/monday/client-board";
import { RequestVideoAssetsButton } from "@/components/brand/request-video-assets-button";
import { fetchBoardRecordsFrom, fetchProjectsForClient } from "@/lib/monday/projects";
import { fetchProjectStatusLabels } from "@/lib/monday/projects-mutate";
import { fetchContentPulse } from "@/lib/socialdesk/fetch";
import { fetchBriefsForClient } from "@/lib/briefs/fetch";
import { fetchClientMeetings } from "@/lib/meetings/calendar";
import type { BrandScope } from "@/lib/scope/types";
import { projectKind, type DatedProject } from "@/lib/scope/pace";
import { easternToday, effectiveScope } from "@/lib/scope/summary";
import type { Brand, BrandLogo } from "@/types/brand";

export const dynamic = "force-dynamic";

export default async function ClientProfilePage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createSupabaseServerClient();
  const [{ data: brand }, { data: logos }] = await Promise.all([
    supabase.from("brands").select("*").eq("id", params.id).single(),
    supabase
      .from("brand_logos")
      .select("id, logo_type, file_name")
      .eq("brand_id", params.id),
  ]);

  if (!brand) notFound();
  const b = brand as Brand;
  const logoCount = (logos ?? []).length;

  // AM options for the hero's inline picker — the Monday "Account Managers"
  // team (cached ~5 min). Never let a Monday hiccup break the client page.
  let amOptions: string[] = [];
  try {
    amOptions = (await fetchAccountManagers()).map((m) => m.name).filter(Boolean);
  } catch {
    amOptions = [];
  }
  // Activity log is still written to (Monday project edits, status
  // changes, etc.) — just no longer rendered as a primary tile. If we
  // bring back a "History" view, read brand_activity_log here.
  void ([] as BrandLogo[]);

  // Fetch the cross-app data (Monday projects + SocialDesk pulse + Brief
  // Tool briefs) in parallel, once. Each tile receives its slice as
  // props; the Activity feed aggregates across everything.
  const typedScope = (b as unknown as { scope?: BrandScope | null }).scope ?? null;
  // Hours on the Monday Allocation board, for the rate math on the Allocation card.
  const boardAllocationsPromise = fetchBoardAllocations();
  // Lifecycle meetings for the onboarding checklist (calendar, ~a year ahead);
  // started now so it runs alongside everything else.
  const lifecyclePromise = fetchClientLifecycle(b.business_name);
  // Invoices for this client, from the Monday Invoicing board.
  const invoicesPromise = fetchInvoices();
  const viewerPromise = getViewer(supabase);
  const [projectsData, pulseData, briefsData, statusLabels, clientBoardData, recordsFrom, calendarMeetings] = await Promise.all([
    fetchProjectsForClient(b.business_name, { withSubitems: true }),
    // SocialDesk may know this client by another name (kept on the scope).
    // With a contract on file, also ask for the posts approved each month
    // since the term in force began.
    fetchContentPulse(typedScope?.socialdesk_client || b.business_name, {
      since: typedScope?.start_date ? effectiveScope(typedScope).start_date : null,
    }),
    fetchBriefsForClient(b.business_name),
    fetchProjectStatusLabels(),
    fetchClientBoardData(b.business_name, (b as unknown as { monday_board_id?: string | number | null }).monday_board_id),
    // How far back the All Projects board goes (earlier contract periods are not judged).
    fetchBoardRecordsFrom(),
    // Meetings with this client on the team's Google Calendars (via the Brief Tool).
    fetchClientMeetings(b.business_name),
  ]);

  // Allocation Setup subitems need the board's items to exist first; do
  // this after the parallel fetch above so we only hit Monday's API when
  // we actually have a board to query.
  const allocationSetup = await fetchAllocationSetup(clientBoardData);

  // Hub-native allocation snapshot for current + upcoming month + last
  // 3 submitted months for the history strip. We fetch all four in one
  // round-trip and split client-side.
  const nowDate = new Date();
  const curYear = nowDate.getFullYear();
  const curMonth = nowDate.getMonth() + 1;
  const nextYear = curMonth === 12 ? curYear + 1 : curYear;
  const nextMonth = curMonth === 12 ? 1 : curMonth + 1;
  const [{ data: currentAlloc }, { data: nextAlloc }, { data: allocHistoryRows }] =
    await Promise.all([
      supabase
        .from("monthly_allocations")
        .select("year, month, status, total_hours, submitted_at")
        .eq("brand_id", params.id)
        .eq("year", curYear)
        .eq("month", curMonth)
        .maybeSingle(),
      supabase
        .from("monthly_allocations")
        .select("year, month, status, total_hours, submitted_at")
        .eq("brand_id", params.id)
        .eq("year", nextYear)
        .eq("month", nextMonth)
        .maybeSingle(),
      supabase
        .from("monthly_allocations")
        .select("year, month, status, total_hours")
        .eq("brand_id", params.id)
        .eq("status", "submitted")
        .order("year", { ascending: false })
        .order("month", { ascending: false })
        .limit(4),
    ]);
  const boardAllocations = await boardAllocationsPromise;
  const allInvoices = await invoicesPromise;
  const viewer = await viewerPromise;
  const clientInvoices = invoicesFor(allInvoices.rows, b as unknown as { business_name: string; monday_board_id?: string | number | null });
  const allocationCurrent = currentAlloc as {
    year: number;
    month: number;
    status: "draft" | "submitted";
    total_hours: number;
    submitted_at: string | null;
  } | null;
  const allocationNext = nextAlloc as {
    year: number;
    month: number;
    status: "draft" | "submitted";
    total_hours: number;
    submitted_at: string | null;
  } | null;
  const allocationHistory = ((allocHistoryRows ?? []) as Array<{
    year: number;
    month: number;
    status: string;
    total_hours: number;
  }>)
    .filter(
      (r) =>
        !(r.year === curYear && r.month === curMonth) &&
        !(r.year === nextYear && r.month === nextMonth)
    )
    .slice(0, 3);

  // Past meetings for this brand — rendered as a history strip under
  // the Meetings tile's "Start notes" rows. Keeps the most recent 8.
  const { data: meetingRows } = await supabase
    .from("meeting_notes")
    .select("id, meeting_type, meeting_title, meeting_date, summary, analyzed_at, created_at")
    .eq("brand_id", params.id)
    .order("meeting_date", { ascending: false })
    .limit(8);
  const pastMeetings = (meetingRows ?? []) as Array<{
    id: string;
    meeting_type: string;
    meeting_title: string | null;
    meeting_date: string;
    summary: string | null;
    analyzed_at: string | null;
    created_at: string;
  }>;

  // The scope column is new (migration 20261120_brand_scope). Until the
  // migration is applied in prod, (b as any).scope is undefined, which
  // the Scope tile renders as empty — the form still saves once the
  // column lands.
  const scope = ((b as unknown as { scope?: BrandScope | null }).scope ?? null) as BrandScope | null;

  // New-client onboarding checklist: shown while anything is still to do, and
  // for the first 30 days even when everything is done.
  const socialdeskUrl = pulseData.client_id
    ? `${process.env.SOCIALDESK_URL ?? "https://socialdesk-lac.vercel.app"}/#/client/${pulseData.client_id}`
    : null;
  const lifecycle = await lifecyclePromise;
  const onboarding = await loadOnboardingChecklist({
    lifecycle,
    supabase,
    brand: b,
    imageLogoCount: ((logos ?? []) as { logo_type?: string | null }[]).filter((l) => l.logo_type !== "reference").length,
    logos: (logos ?? []) as { file_name: string; logo_type: string | null }[],
    clientBoardId: clientBoardData.boardId
      ? String(clientBoardData.boardId)
      : ((b as unknown as { monday_board_id?: string | null }).monday_board_id ?? null),
    socialdeskUrl,
    connections: pulseData.connections,
    scopeChannels: (() => {
      const ch = (scope as unknown as { channels?: unknown } | null)?.channels;
      return Array.isArray(ch) ? ch.length : ch && typeof ch === "object" ? Object.keys(ch).length : 0;
    })(),
  });
  const brandAgeDays = (Date.now() - new Date((b as unknown as { created_at?: string }).created_at ?? 0).getTime()) / 86_400_000;
  // New clients (first 120 days) get the checklist up top while anything is
  // left (and for 30 days regardless). Older clients keep it folded at the
  // bottom of the page, so it is there to check without taking over the page.
  const newClient = brandAgeDays <= 120;
  const showOnboarding = newClient && (onboarding.done < onboarding.total || brandAgeDays <= 30);

  // Scope tile inputs, straight from the Monday 🚦 All Projects board:
  // Client + Project Type + Shoot Date. Each dated project is classified by
  // its Project Type (Professional Content Shoot = a contracted shoot; Micro
  // Content Shoot and Edit Request tracked separately; anything else "other").
  const datedById = new Map<string, DatedProject>();
  const addDated = (ps: typeof projectsData.projects, clientName: string) => {
    for (const p of ps) {
      if (!p.shootDateIso || datedById.has(p.id)) continue;
      datedById.set(p.id, {
        date: p.shootDateIso,
        kind: projectKind(p.projectType),
        name: p.name,
        url: p.mondayUrl,
        client: clientName,
      });
    }
  };
  addDated(projectsData.projects, b.business_name);

  // Shared shoot pool: when this client's scope is linked to another client
  // under the same agreement, count both clients' shoots together.
  let scopePool: { name: string; partnerRate: number | null } | null = null;
  if (scope?.pool_with) {
    try {
      const { data: partner } = await supabase
        .from("brands")
        .select("id, business_name, scope")
        .eq("id", scope.pool_with)
        .maybeSingle();
      if (partner?.business_name) {
        const partnerProjects = await fetchProjectsForClient(partner.business_name as string);
        addDated(partnerProjects.projects, partner.business_name as string);
        scopePool = {
          name: partner.business_name as string,
          partnerRate: ((partner.scope as BrandScope | null)?.shoots_per_period ?? null) as number | null,
        };
      }
    } catch {
      scopePool = null; // never let the pool lookup break the client page
    }
  }
  const datedProjects = [...datedById.values()];

  // Other clients, for the scope form's "Shared shoot pool with" picker.
  const { data: poolBrands } = await supabase
    .from("brands")
    .select("id, business_name")
    .neq("id", b.id)
    .order("business_name");
  const poolOptions = (poolBrands ?? []).map((x) => ({
    id: x.id as string,
    name: x.business_name as string,
  }));

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-4 md:px-6 md:py-10">
      {/* Breadcrumb back (desktop — phones have Back in the top bar) */}
      <Link
        href="/dashboard"
        className="mb-6 hidden items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground md:inline-flex"
      >
        <ChevronLeft className="h-3 w-3" />
        All clients
      </Link>

      {/* Hero — client name, ops chips, inline contact strip, actions.
          Compact and editorial, not a brand gallery. */}
      <ClientHero brand={b} logoCount={logoCount} amOptions={amOptions} />

      {/* Needs-you summary — what does this client want from me today */}
      <NeedsYouBar
        projects={projectsData.projects}
        pulse={pulseData}
        briefs={briefsData.briefs}
        scope={scope}
        socialdeskClientUrl={
          pulseData.client_id
            ? `${process.env.SOCIALDESK_URL ?? "https://socialdesk-lac.vercel.app"}/#/client/${pulseData.client_id}`
            : null
        }
        overdueInvoices={overdueInvoiceCount(clientInvoices)}
        clientBoardUrl={
          clientBoardData.boardId
            ? `https://nauticalnetwork.monday.com/boards/${clientBoardData.boardId}`
            : null
        }
      />

      {/* Tile grid — narrative for a monthly sync. Even 2-column
          rhythm, Internal Notes wide at the bottom so there's room
          to actually write. */}
      <SectionNav />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-5">
        {/* Onboarding — is everything set up for this client? (full width) */}
        {showOnboarding ? <OnboardingTile brandId={b.id} checklist={onboarding} /> : null}

        {/* Row 1 — who, and when we talk */}
        <ContactTile brand={b} />
        <MeetingsTile brandId={b.id} pastMeetings={pastMeetings} calendar={calendarMeetings} />

        {/* Row 2 — work in motion: each Monday project with its brief and
            deliverables in one row (full width) */}
        <ProjectsTile data={projectsData} brandId={b.id} brandName={b.business_name} statusLabels={statusLabels} briefs={briefsData} />

        {/* Row 3 — social: this month and next (full width) */}
        <SocialDeskTile pulse={pulseData} contractChannels={scope?.channels} />

        {/* Row 4 — contract health (full width) */}
        <ScopeTile
          brandId={b.id}
          initialScope={scope}
          socialHistory={pulseData.history}
          socialConnected={pulseData.ok && pulseData.found}
          recordsFrom={recordsFrom}
          datedProjects={datedProjects}
          pool={scopePool}
          poolOptions={poolOptions}
          today={easternToday()}
        />

        {/* Row 5 — hours we're planning / money */}
        <AllocationTile
          brandId={b.id}
          current={allocationCurrent}
          upcoming={allocationNext}
          setup={allocationSetup}
          history={allocationHistory}
          expected={b.engagement_type === "retainer" || allocationSetup.totalHours > 0}
          monthly={typeof typedScope?.retainer_amount === "number" ? typedScope.retainer_amount : null}
          boardHours={{
            current: boardHoursFor(boardAllocations.rows, b as unknown as { business_name: string; monday_board_id?: string | number | null }, curYear, curMonth),
            upcoming: boardHoursFor(boardAllocations.rows, b as unknown as { business_name: string; monday_board_id?: string | number | null }, nextYear, nextMonth),
          }}
        />
        <InvoicingTile
          invoices={clientInvoices}
          monthly={typeof typedScope?.retainer_amount === "number" ? typedScope.retainer_amount : null}
          ok={allInvoices.ok}
          monthLabel={nowDate.toLocaleDateString("en-US", { month: "long", timeZone: "America/New_York" })}
          period={{ year: curYear, month: curMonth }}
          allHref={viewer.everyone ? "/accounts/invoicing" : undefined}
        />

        {/* Row 6 — strategic context / reference material */}
        <IndustryUpdateTile
          brandId={b.id}
          vertical={b.vertical}
          brandName={b.business_name}
          cached={
            (b as unknown as { industry_update?: unknown }).industry_update ?? null
          }
        />
        <Tile
          label="Files & Documents"
          icon={<FolderOpen className="h-3.5 w-3.5" />}
          href={`/brand/${b.id}?from=client`}
          hrefLabel="Edit"
        >
          <div className="flex flex-col gap-4">
            {/* Our Dropbox */}
            <div className="flex flex-col gap-1.5">
              <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Our Dropbox
              </div>
              {b.dropbox_folder_url ? (
                <>
                  <a
                    href={b.dropbox_folder_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block max-w-full truncate text-[13px] text-foreground underline underline-offset-4 hover:text-accent-foreground"
                  >
                    Parent folder on Dropbox
                  </a>
                  <p className="text-[11px] text-muted-foreground">
                    Photos / Videos / Deliverables live per project.
                  </p>
                </>
              ) : (
                <p className="text-[12px] italic text-muted-foreground">
                  No Dropbox folder yet.
                </p>
              )}
              {b.status === "approved" ? (
                <div>
                  <RequestVideoAssetsButton brandId={b.id} brandName={b.business_name} />
                </div>
              ) : null}
            </div>

            {/* Client-shared */}
            <div className="flex flex-col gap-1.5 border-t border-border/60 pt-3">
              <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Client-shared
              </div>
              {b.client_asset_folder_url ? (
                <a
                  href={b.client_asset_folder_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block max-w-full truncate text-[13px] text-foreground underline underline-offset-4 hover:text-accent-foreground"
                >
                  {b.client_asset_folder_url.replace(/^https?:\/\//, "")}
                </a>
              ) : null}
              {b.client_documents ? (
                <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-foreground/90">
                  {b.client_documents}
                </p>
              ) : null}
              {!b.client_asset_folder_url && !b.client_documents ? (
                <p className="text-[12px] italic text-muted-foreground">
                  Logins, pre-docs, or shared folders the client sent over — add from Edit.
                </p>
              ) : null}
            </div>
          </div>
        </Tile>

        {/* Scratchpad: half width, beside Files & Documents (the industry notes above take the full row) */}
        <Tile
          label="Internal notes"
          icon={<FileText className="h-3.5 w-3.5" />}
        >
          {b.internal_notes ? (
            <p className="whitespace-pre-wrap text-sm text-foreground">
              {b.internal_notes}
            </p>
          ) : (
            <TileEmpty>
              Scratchpad for the AM — history, call notes, context.
            </TileEmpty>
          )}
        </Tile>
        {/* Older clients: the onboarding checklist, folded, to check anytime. */}
        {!newClient ? <OnboardingTile brandId={b.id} checklist={onboarding} collapsed /> : null}
      </div>
    </div>
  );
}
