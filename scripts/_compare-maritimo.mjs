// Dump the 3 submitted Maritimo rows side-by-side so we can confirm they're
// retry-duplicates (same data) before deleting the earlier two.
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./_load-env.mjs";
loadEnv();

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const { data: rows } = await s
  .from("brands")
  .select("*")
  .ilike("business_name", "%maritimo%")
  .eq("status", "submitted")
  .order("created_at", { ascending: true });

for (const r of rows) {
  console.log("\n────────────────────────────────────────");
  console.log(`${r.created_at}  ${r.id}`);
  console.log(`submitter: ${r.submitter_name} <${r.submitter_email}>`);
  console.log(`business:  ${r.business_name}`);
  console.log(`tagline:   ${r.tagline ?? "(none)"}`);
  console.log(`website:   ${r.website_url ?? "(none)"}`);
  console.log(`vertical:  ${r.vertical ?? "(none)"}`);
  console.log(`asset url: ${r.client_asset_folder_url ?? "(none)"}`);
  const notes = (r.inspiration_notes ?? "").slice(0, 160);
  console.log(`notes:     ${notes}${notes.length === 160 ? "…" : ""}`);
}
