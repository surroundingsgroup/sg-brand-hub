// Every client with a scope on file, each boiled down to one row of contract
// health. Feeds the all-accounts page (/accounts) and the JSON feed the Brief
// Tool reads for the morning email, Monday notifications and calendar invites.
//
// Uses the SAME inputs and maths as the Scope tile on the client page
// (fetchProjectsForClient + summarizeContract), so a row here can never
// disagree with what the client page shows.

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchBoardRecordsFrom, fetchProjectsForClient } from "@/lib/monday/projects";
import { projectKind, type DatedProject } from "./pace";
import { contractNow, overallLevel, renewalStage, summarizeContract, type Level, type RenewalStage } from "./summary";
import { SERVICE_LABELS, scopeHasContent, type BrandScope } from "./types";

export type AccountLight = { level: Level; label: string; reason: string | null };

export type AccountRow = {
  id: string;
  name: string;
  am: string | null;
  services: string[]; // labels
  level: Level | null; // worst of the lights and the renewal clock
  month: AccountLight | null; // this period
  contract: AccountLight | null; // the full contract
  unit: string; // "month", "quarter"...
  done: number | null;
  total: number | null;
  owedPerPeriod: number | null;
  lastShoot: string | null; // YYYY-MM-DD
  nextShoot: string | null;
  nextShootName: string | null;
  startDate: string | null;
  endDate: string | null;
  renewalDate: string | null;
  daysToRenewal: number | null;
  renewalStage: RenewalStage;
  autoRenew: boolean | null;
  pooledWith: string | null; // partner client on a shared agreement
  mondayItemId: string | null; // a recent project, to anchor a Monday notification
  projectsOk: boolean; // false = Monday could not be read, numbers may be missing
};

export type AccountHealth = {
  rows: AccountRow[];
  // Clients marked Retainer with nothing entered yet.
  missingScope: { id: string; name: string; am: string | null }[];
  generatedAt: string;
};

type BrandRow = {
  id: string;
  business_name: string;
  account_manager: string | null;
  engagement_type: string | null;
  scope: BrandScope | null;
};

async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

const hasScope = scopeHasContent;

function pulseId(url: string | undefined): string | null {
  const m = (url ?? "").match(/\/pulses\/(\d+)/);
  return m ? m[1] : null;
}

export async function loadAccountHealth(
  supabase: SupabaseClient,
  now: Date = contractNow(),
  // am: only this account manager's clients (the personal dashboard), so the
  // page does not read every client's projects from Monday.
  opts: { am?: string | null } = {}
): Promise<AccountHealth> {
  const { data, error } = await supabase
    .from("brands")
    .select("id, business_name, account_manager, engagement_type, scope")
    .order("business_name");
  if (error) throw new Error(error.message);
  const brands = (data ?? []) as BrandRow[];
  const mine = opts.am?.trim().toLowerCase() || null;
  const scoped = brands.filter(
    (b) => hasScope(b.scope) && b.engagement_type !== "inactive" && (!mine || (b.account_manager ?? "").trim().toLowerCase() === mine)
  );
  const byId = new Map(brands.map((b) => [b.id, b]));

  // One Monday read per client (cached for a minute by the fetch layer).
  const projectLists = await inBatches(scoped, 6, async (b) => ({
    id: b.id,
    res: await fetchProjectsForClient(b.business_name),
  }));
  const projectsById = new Map(projectLists.map((p) => [p.id, p.res]));
  // How far back the board goes: earlier contract periods are not judged.
  const recordsFrom = await fetchBoardRecordsFrom();

  const dated = (brandId: string, clientName: string): DatedProject[] =>
    (projectsById.get(brandId)?.projects ?? [])
      .filter((p) => !!p.shootDateIso)
      .map((p) => ({
        date: p.shootDateIso as string,
        kind: projectKind(p.projectType),
        name: p.name,
        url: p.mondayUrl,
        client: clientName,
      }));

  const rows: AccountRow[] = scoped.map((b) => {
    const scope = b.scope as BrandScope;
    const own = dated(b.id, b.business_name);
    const partner = scope.pool_with ? byId.get(scope.pool_with) : undefined;
    // Shared agreement: both clients' shoots count against the combined quota.
    const seen = new Set<string>();
    const all = [...own, ...(partner ? dated(partner.id, partner.business_name) : [])].filter((p) => {
      const key = p.url ?? `${p.date}|${p.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const pool = partner ? { partnerRate: partner.scope?.shoots_per_period ?? null } : null;
    const s = summarizeContract(scope, all, pool, now, { recordsFrom });
    const light = (scopeName: string): AccountLight | null => {
      const l = s.lights.find((x) => x.scope === scopeName);
      return l ? { level: l.level, label: l.label, reason: l.reason ?? null } : null;
    };
    const anchor = s.nextShoot ?? s.lastShoot ?? own[own.length - 1] ?? null;
    return {
      id: b.id,
      name: b.business_name,
      am: b.account_manager?.trim() || null,
      services: (scope.services ?? []).map((x) => SERVICE_LABELS[x] ?? x),
      level: overallLevel(s),
      month: s.lights.find((x) => x.scope !== "Full contract")
        ? light(s.lights.find((x) => x.scope !== "Full contract")!.scope)
        : null,
      contract: light("Full contract"),
      unit: s.unit,
      done: s.pace ? s.pace.done : null,
      total: s.pace ? s.pace.total : null,
      owedPerPeriod: s.pace ? s.quota : null,
      lastShoot: s.lastShoot ? s.lastShoot.date.slice(0, 10) : null,
      nextShoot: s.nextShoot ? s.nextShoot.date.slice(0, 10) : null,
      nextShootName: s.nextShoot?.name ?? null,
      // The term in force today (auto-renewals rolled forward).
      startDate: s.term.start,
      endDate: s.term.end,
      renewalDate: s.term.renewal,
      daysToRenewal: s.daysToRenewal,
      renewalStage: renewalStage(s.daysToRenewal),
      autoRenew: scope.auto_renew ?? null,
      pooledWith: partner?.business_name ?? null,
      mondayItemId: pulseId(anchor?.url),
      projectsOk: projectsById.get(b.id)?.ok ?? false,
    };
  });

  const missingScope = brands
    .filter((b) => b.engagement_type === "retainer" && !hasScope(b.scope))
    .map((b) => ({ id: b.id, name: b.business_name, am: b.account_manager?.trim() || null }));

  return { rows, missingScope, generatedAt: new Date().toISOString() };
}

// Most urgent first: red, then yellow, then green; soonest renewal breaks ties.
const RANK: Record<string, number> = { red: 0, yellow: 1, green: 2 };
export function sortByUrgency(rows: AccountRow[]): AccountRow[] {
  return [...rows].sort((a, b) => {
    const ra = a.level ? RANK[a.level] : 3;
    const rb = b.level ? RANK[b.level] : 3;
    if (ra !== rb) return ra - rb;
    const da = a.daysToRenewal ?? 99999;
    const db = b.daysToRenewal ?? 99999;
    if (da !== db) return da - db;
    return a.name.localeCompare(b.name);
  });
}
