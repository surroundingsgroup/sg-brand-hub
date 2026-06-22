import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./_load-env.mjs";
loadEnv();

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const { data } = await s
  .from("brands")
  .select(
    "id, business_name, status, monday_intake_item_id, monday_all_projects_item_id, dropbox_folder_url, brand_guideline_pdf_url, updated_at"
  )
  .eq("id", "0ef2a9b8-c0d0-403a-bc7a-636c97080d6b")
  .single();
console.log(JSON.stringify(data, null, 2));

const { data: log } = await s
  .from("brand_activity_log")
  .select("event_type, metadata, created_at")
  .eq("brand_id", "0ef2a9b8-c0d0-403a-bc7a-636c97080d6b")
  .order("created_at", { ascending: false })
  .limit(15);
console.log("\n--- Recent activity ---");
log?.forEach((a) =>
  console.log(
    a.created_at?.slice(0, 19),
    a.event_type,
    JSON.stringify(a.metadata)?.slice(0, 120)
  )
);
