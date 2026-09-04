// Check what happened with the Vollmer video assets request.
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./_load-env.mjs";
loadEnv();

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const { data: brands } = await s
  .from("brands")
  .select("id, business_name, status, account_manager, monday_all_projects_item_id, dropbox_folder_url")
  .ilike("business_name", "%Vollmer%");
console.log("── Vollmer brands ──");
console.log(JSON.stringify(brands, null, 2));

for (const b of brands ?? []) {
  const { data: log } = await s
    .from("brand_activity_log")
    .select("event_type, metadata, created_at")
    .eq("brand_id", b.id)
    .in("event_type", ["video_assets_requested", "approved"])
    .order("created_at", { ascending: false })
    .limit(10);
  console.log(`\n── ${b.business_name} — video_assets_requested + approved log ──`);
  for (const a of log ?? []) {
    console.log(`${a.created_at?.slice(0, 19)}  ${a.event_type}`);
    console.log(`  ${JSON.stringify(a.metadata)}`);
  }
}
