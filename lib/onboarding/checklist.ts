// The new-client onboarding checklist on the Surroundings client page: has
// everything a client needs been set up? Every item is read from where the
// work actually lives (the brand record, logos, Dropbox, the Monday client
// board and All Accounts row, SocialDesk, including whether the client's
// Facebook / Instagram are connected there). Hand-ticked items, if any are
// ever added, are saved as "onboarding_check" rows in brand_activity_log.

import type { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Brand } from "@/types/brand";

const MONDAY_API_URL = "https://api.monday.com/v2";
const SLUG = "nauticalnetwork";
const ACCOUNTS_BOARD = 7006568275;

export type OnboardingItem = {
  key: string;
  label: string;
  done: boolean;
  /** Where it lives (done) or where to do it (to-do). */
  href?: string;
  hrefLabel?: string;
  hint?: string;
  /** Ticked by hand on the page (nothing else records it). */
  manual?: boolean;
};

export type OnboardingChecklist = { items: OnboardingItem[]; done: number; total: number; social: boolean };

/** The client's All Accounts row: agreement on it, services, link. */
async function accountsRow(boardId: string | null, name: string) {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) return null;
  const rule = boardId
    ? `{ column_id: "text_mkzvjab3", compare_value: [${JSON.stringify(boardId)}], operator: any_of }`
    : `{ column_id: "name", compare_value: [${JSON.stringify(name)}], operator: contains_text }`;
  try {
    const res = await fetch(MONDAY_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token, "API-Version": "2024-10" },
      body: JSON.stringify({
        query: `{ boards(ids: [${ACCOUNTS_BOARD}]) { items_page(limit: 1, query_params: { rules: [${rule}] }) { items { id column_values(ids: ["files__1", "dropdown_mm9cnysy"]) { id text value } } } } }`,
      }),
      next: { revalidate: 60 },
    });
    const json = (await res.json()) as {
      data?: { boards?: { items_page?: { items?: { id: string; column_values: { id: string; text: string | null; value: string | null }[] }[] } }[] };
    };
    const it = json.data?.boards?.[0]?.items_page?.items?.[0];
    if (!it) return null;
    const files = it.column_values.find((c) => c.id === "files__1");
    const services = it.column_values.find((c) => c.id === "dropdown_mm9cnysy")?.text ?? "";
    return {
      url: `https://${SLUG}.monday.com/boards/${ACCOUNTS_BOARD}/pulses/${it.id}`,
      hasAgreement: /"assetId"/.test(files?.value ?? "") || Boolean(files?.text?.trim()),
      services,
    };
  } catch {
    return null;
  }
}

export async function loadOnboardingChecklist(opts: {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  brand: Brand;
  imageLogoCount: number;
  clientBoardId: string | null;
  socialdeskUrl: string | null;
  scopeChannels: number;
  /** SocialDesk's connected accounts for this client (from the pulse feed). */
  connections: { platform: string; ok: boolean }[];
}): Promise<OnboardingChecklist> {
  const { supabase, brand: b } = opts;
  const brandPage = `/brand/${b.id}?from=client`;

  const [row, { data: events }] = await Promise.all([
    accountsRow(opts.clientBoardId, b.business_name),
    supabase
      .from("brand_activity_log")
      .select("event_type, metadata, created_at")
      .eq("brand_id", b.id)
      .in("event_type", ["video_assets_requested", "onboarding_check"])
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  const log = (events ?? []) as { event_type: string; metadata: Record<string, unknown> | null }[];
  const manual = (key: string) => {
    const e = log.find((x) => x.event_type === "onboarding_check" && x.metadata?.item === key);
    return Boolean(e?.metadata?.done);
  };

  const social = Boolean(opts.socialdeskUrl) || opts.scopeChannels > 0 || /social/i.test(row?.services ?? "");
  const hasOverview = Boolean((b.overview_polished ?? "").trim() || (b.overview_client_raw ?? "").trim());
  const hasPrimaryColor = (b.colors ?? []).some((c) => c.role === "primary");

  const items: OnboardingItem[] = [
    {
      key: "am",
      label: "Account manager assigned",
      done: Boolean(b.account_manager?.trim()),
      hint: b.account_manager ? b.account_manager : "Set it at the top of this page",
    },
    {
      key: "contract",
      label: "Signed contract on All Accounts",
      done: Boolean(row?.hasAgreement),
      href: row?.url,
      hrefLabel: row?.hasAgreement ? "Open row" : "Add it",
      hint: row?.hasAgreement ? undefined : "Upload it to the deal's Signed Contract column (it copies here) or straight to the row",
    },
    {
      key: "board",
      label: "Client board on Monday",
      done: Boolean(opts.clientBoardId),
      href: opts.clientBoardId ? `https://${SLUG}.monday.com/boards/${opts.clientBoardId}` : undefined,
      hrefLabel: "Open board",
      hint: opts.clientBoardId ? undefined : "Made when the deal is Won",
    },
    {
      key: "branding",
      label: "Branding filled in",
      done: hasOverview && hasPrimaryColor,
      href: brandPage,
      hrefLabel: hasOverview && hasPrimaryColor ? "Brand profile" : "Fill it in",
      hint: hasOverview && hasPrimaryColor ? undefined : [!hasOverview && "overview", !hasPrimaryColor && "primary color"].filter(Boolean).join(" and ") + " missing",
    },
    {
      key: "logos",
      label: "Logos uploaded",
      done: opts.imageLogoCount > 0,
      href: brandPage,
      hrefLabel: opts.imageLogoCount > 0 ? `${opts.imageLogoCount} logo${opts.imageLogoCount === 1 ? "" : "s"}` : "Upload",
    },
    {
      key: "dropbox",
      label: "Dropbox folder made",
      done: Boolean(b.dropbox_folder_url),
      href: b.dropbox_folder_url ?? brandPage,
      hrefLabel: b.dropbox_folder_url ? "Open folder" : "Brand profile",
      hint: b.dropbox_folder_url ? undefined : "Made by the brand intake",
    },
    ...(social
      ? [
          {
            key: "socialdesk",
            label: "SocialDesk calendar",
            done: Boolean(opts.socialdeskUrl),
            href: opts.socialdeskUrl ?? undefined,
            hrefLabel: "Open calendar",
            hint: opts.socialdeskUrl ? undefined : "Made when a deal with Social Media is Won, or add the client in SocialDesk",
          },
        ]
      : []),
    {
      key: "video_assets",
      label: "Video assets requested",
      done: log.some((x) => x.event_type === "video_assets_requested"),
      href: brandPage,
      hrefLabel: "Request",
      hint: "From the brand profile, once it is approved",
    },
    ...(social ? [metaItem(opts.connections, opts.socialdeskUrl)] : []),
  ];
  void manual; // hand-ticked items read through this when there are any
  // Video assets: the link only helps while it is still to do.
  for (const it of items) if (it.key === "video_assets" && it.done) it.href = undefined;

  const done = items.filter((i) => i.done).length;
  return { items, done, total: items.length, social };
}

// Meta is set up when the client's Facebook / Instagram are connected in
// SocialDesk (that only works once the client has granted access), and still
// healthy when the connection's token is live.
function metaItem(connections: { platform: string; ok: boolean }[], socialdeskUrl: string | null): OnboardingItem {
  const meta = connections.filter((c) => /facebook|instagram/i.test(c.platform));
  const live = meta.filter((c) => c.ok).map((c) => c.platform);
  const expired = meta.filter((c) => !c.ok).map((c) => c.platform);
  const done = live.length > 0;
  return {
    key: "meta",
    label: "Meta connected in SocialDesk",
    done,
    href: socialdeskUrl ?? undefined,
    hrefLabel: done ? live.join(" · ") : "Connect",
    hint: done
      ? expired.length
        ? `${expired.join(" and ")} needs reconnecting`
        : undefined
      : expired.length
        ? `${expired.join(" and ")} connected but the access expired: reconnect in SocialDesk`
        : "Client shares access with SG's Meta Business Portfolio (3480546738856390), then connect their pages in SocialDesk",
  };
}
