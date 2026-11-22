import { Plus, Upload, Handshake } from "lucide-react";
import { IntakeFormShare } from "@/components/dashboard/intake-form-share";
import { DashboardFilters } from "@/components/dashboard/dashboard-filters";
import { AssignmentFilter } from "@/components/dashboard/assignment-filter";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageContainer, PageHeader } from "@/components/shell/page-container";
import { SearchInput } from "@/components/dashboard/search-input";
import { StatusFilter } from "@/components/dashboard/status-filter";
import { BrandList } from "@/components/dashboard/brand-list";
import { BrandsSection } from "@/components/dashboard/brands-section";
import { InactiveBrands } from "@/components/dashboard/inactive-brands";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { findAmByEmail } from "@/lib/monday/teams";
import type { Brand, BrandStatus } from "@/types/brand";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: {
    q?: string;
    status?: string;
    engagement?: string;
    sort?: string;
    scope?: string;
  };
}) {
  const supabase = createSupabaseServerClient();

  // Resolve signed-in user → canonical AM display name via Monday's "Account
  // Managers" team. If they aren't on that team, the "mine" filter falls back
  // to matching the local-part of their email against account_manager, so
  // the toggle still does something useful for non-AM team members.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const signedInEmail = user?.email ?? null;
  let myAmName: string | null = null;
  try {
    const member = await findAmByEmail(signedInEmail);
    myAmName = member?.name ?? null;
  } catch {
    // Monday unavailable — leave myAmName null, "mine" filter will degrade to
    // the email-local-part fallback below. We don't want the dashboard to
    // 500 because the AM team lookup flaked.
  }

  // "mine" = only brands assigned to the signed-in user. "all" = everyone's.
  // Default is "mine" so AMs land on their own book first (Brief Tool pattern).
  const scope = searchParams.scope === "all" ? "all" : "mine";

  let query = supabase.from("brands").select("*");

  if (scope === "mine" && signedInEmail) {
    // Prefer the canonical Monday display name; fall back to the email's
    // local part (billy@... → "billy") as a best-effort substring match.
    const needle = myAmName ?? signedInEmail.split("@")[0];
    query = query.ilike("account_manager", `%${needle}%`);
  }

  // Sort
  const sort = searchParams.sort ?? "updated_desc";
  if (sort === "alpha_asc") {
    query = query.order("business_name", { ascending: true });
  } else if (sort === "created_asc") {
    query = query.order("created_at", { ascending: true });
  } else {
    query = query.order("updated_at", { ascending: false });
  }

  if (searchParams.status && searchParams.status !== "all") {
    query = query.eq("status", searchParams.status as BrandStatus);
  }
  if (searchParams.engagement && searchParams.engagement !== "all") {
    query = query.eq("engagement_type", searchParams.engagement);
  }
  if (searchParams.q) {
    query = query.ilike("business_name", `%${searchParams.q}%`);
  }

  const { data, error } = await query;
  const allBrands = (error ? [] : (data ?? [])) as Brand[];

  // Split inactive into a separate collapsed section so the main list stays
  // focused on active engagements (retainer + project). If the user has
  // explicitly filtered to "inactive", everything stays in the main list
  // instead — they came here looking for inactive specifically.
  const userPickedInactive = searchParams.engagement === "inactive";
  const activeBrands = userPickedInactive
    ? allBrands
    : allBrands.filter((b) => b.engagement_type !== "inactive");
  const inactiveBrands = userPickedInactive
    ? []
    : allBrands.filter((b) => b.engagement_type === "inactive");

  // Bucket the active brands by attention level so the "needs review" pile
  // is up top where the AM lands. When a user has explicitly filtered to
  // one status, the buckets collapse naturally (only the matching one has
  // content).
  const needsReview = activeBrands.filter((b) =>
    ["submitted", "in_review", "draft"].includes(b.status)
  );
  const approved = activeBrands.filter((b) => b.status === "approved");
  const archived = activeBrands.filter((b) => b.status === "archived");

  // Un-triaged intakes: submitted or in-review and nobody owns them.
  // These need a human to pick them up before anything else happens.
  // Ariel + Camilla are the triage path per Billy's call. Surfacing
  // them as a top-of-dashboard banner so they can't slip through.
  const untriaged = needsReview.filter(
    (b) => !b.account_manager?.trim() && b.status !== "draft"
  );

  // If a search is active we lose the buckets and show everything matched
  // in one flat list — search results across statuses are more useful
  // ungrouped.
  const isSearching = !!searchParams.q?.trim();

  return (
    <PageContainer>
      {/* Title + action buttons are desktop chrome; on phones the top bar
          carries the title and the (+) tab carries the actions. */}
      <div className="hidden md:block">
      <PageHeader
        title="Clients"
        description={
          scope === "mine" && (myAmName || signedInEmail)
            ? `Your clients — ${myAmName ?? signedInEmail?.split("@")[0]}.`
            : "All clients across Surroundings Group."
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" asChild>
              <a
                href={process.env.NEXT_PUBLIC_DEAL_FORM_URL ?? "https://surroundingsgroup.com/deal"}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Handshake className="h-4 w-4" />
                New deal
              </a>
            </Button>
            <IntakeFormShare />
            <Button variant="outline" asChild>
              <Link href="/import">
                <Upload className="h-4 w-4" />
                Import PDFs
              </Link>
            </Button>
            <Button asChild>
              <Link href="/brand/new">
                <Plus className="h-4 w-4" />
                New brand
              </Link>
            </Button>
          </div>
        }
      />
      </div>

      {/* Un-triaged intake banner — only shows when there are intakes
          that landed without an AM. Clicking jumps into the queue. */}
      {untriaged.length > 0 ? (
        <a
          href="#intake-queue"
          className="mb-6 flex items-center justify-between gap-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-[13px] transition-colors hover:bg-amber-100"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-amber-200 text-amber-900 text-[12px] font-semibold tabular-nums">
              {untriaged.length}
            </span>
            <div>
              <div className="font-medium text-amber-900">
                {untriaged.length} new intake{untriaged.length === 1 ? "" : "s"} waiting to be owned
              </div>
              <div className="text-[11.5px] text-amber-800/80">
                Assign an AM so they land in someone&apos;s workflow.
              </div>
            </div>
          </div>
          <span className="text-[11px] font-medium uppercase tracking-wider text-amber-900">
            Triage →
          </span>
        </a>
      ) : null}

      {/* Phones: search sticks under the top bar; filters become one
          swipeable chip row. Desktop: one inline row, as before. */}
      <div className="contents md:mb-6 md:flex md:flex-row md:items-center md:gap-3">
        <div className="sticky top-[calc(3rem+env(safe-area-inset-top))] z-30 -mx-4 mb-2 bg-canvas/95 px-4 py-2 backdrop-blur md:static md:z-auto md:m-0 md:flex-1 md:bg-transparent md:p-0 md:backdrop-blur-none">
          <SearchInput placeholder="Search by business name…" />
        </div>
        <div className="no-scrollbar -mx-4 mb-3 flex items-center gap-2 overflow-x-auto px-4 md:m-0 md:overflow-visible md:p-0">
          <div className="order-first flex-shrink-0 md:order-last">
            <AssignmentFilter />
          </div>
          <div className="flex-shrink-0">
            <DashboardFilters />
          </div>
        </div>
      </div>

      <div className="mb-5 md:mb-6">
        <StatusFilter />
      </div>

      {isSearching ? (
        <BrandList brands={activeBrands} />
      ) : (
        <>
          {/* Approved clients split into Active Retainers (the primary
              focus — ongoing work, highest priority) and Other Clients
              (project-based + anything else). Retainers lead, other
              clients render below. */}
          <BrandList
            brands={approved.filter((b) => b.engagement_type === "retainer")}
            title="Active Retainers"
            subtitle="Ongoing monthly work"
            emphasis="primary"
          />
          <BrandList
            brands={approved.filter(
              (b) => b.engagement_type !== "retainer" && b.engagement_type !== "prospect"
            )}
            title="Other Clients"
            subtitle="One-off projects + unassigned engagement type"
          />
          <BrandList
            brands={approved.filter((b) => b.engagement_type === "prospect")}
            title="Prospects"
            subtitle="Pre-close — branding collected, deal not won yet"
          />

          {/* Everything else — intake queue, archived, inactive — lives in
              collapsed regions below so the dashboard doesn't greet the AM
              with a wall of "needs review" noise when they sign in. */}
          {(needsReview.length > 0 || archived.length > 0) && (
            <details
              id="intake-queue"
              className="mt-10 rounded-xl bg-panel p-5 shadow-panel"
              open={untriaged.length > 0}
            >
              <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm font-medium text-foreground">
                <span>
                  Intake queue
                  {needsReview.length > 0 && (
                    <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      {needsReview.length}
                    </span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  Draft, submitted, in review{archived.length > 0 ? ` · ${archived.length} archived` : ""}
                </span>
              </summary>
              <div className="mt-5 space-y-6">
                {needsReview.length > 0 && (
                  <BrandsSection
                    label="Needs review"
                    description="New intake, draft, or in review."
                    brands={needsReview}
                  />
                )}
                {archived.length > 0 && (
                  <BrandsSection label="Archived" brands={archived} />
                )}
              </div>
            </details>
          )}
        </>
      )}

      <InactiveBrands brands={inactiveBrands} />
    </PageContainer>
  );
}
