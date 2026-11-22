// Count public-form intake submissions and how many actually got files.
// A "public intake" is a brand whose first activity_log event is
// 'submitted' with source=public_intake OR closed_won_intake_link.
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./_load-env.mjs";
loadEnv();

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// All brand_activity_log entries where source is a public intake
const { data: events } = await admin
  .from("brand_activity_log")
  .select("brand_id, metadata, created_at")
  .eq("event_type", "submitted")
  .order("created_at", { ascending: false });

const publicSubs = (events ?? []).filter((e) => {
  const src = e.metadata?.source;
  return src === "public_intake" || src === "closed_won_intake_link";
});

console.log(`Public intake submissions ever: ${publicSubs.length}`);

const buckets = {
  "with files": 0,
  "with asset link only": 0,
  "with nothing": 0,
};
const noFiles = [];

for (const e of publicSubs) {
  const { data: brand } = await admin
    .from("brands")
    .select("business_name, status, client_asset_folder_url, submitter_email")
    .eq("id", e.brand_id)
    .maybeSingle();
  if (!brand) continue;
  const { count } = await admin
    .from("brand_logos")
    .select("id", { count: "exact", head: true })
    .eq("brand_id", e.brand_id);
  if ((count ?? 0) > 0) {
    buckets["with files"]++;
  } else if (brand.client_asset_folder_url) {
    buckets["with asset link only"]++;
  } else {
    buckets["with nothing"]++;
    noFiles.push({ ...brand, submitted: e.created_at });
  }
}

console.log("\n── By outcome ──");
for (const [k, v] of Object.entries(buckets)) console.log(`  ${k}: ${v}`);

console.log(`\n── Public submissions with ZERO files AND no asset link (${noFiles.length}) ──`);
for (const b of noFiles.slice(0, 40)) {
  console.log(
    `  ${b.submitted?.slice(0, 10)}  [${b.status}]  "${b.business_name}"  ${b.submitter_email}`
  );
}
