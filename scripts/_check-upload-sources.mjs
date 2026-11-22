// For each recent brand_logos row, show whether it was uploaded during
// the public intake flow (brand status was 'submitted' at upload time)
// or afterwards by SG admin.
//
// We can approximate by looking at the Storage object path. The public
// intake uploads with path = "{brand_id}/{logo|reference}/{ts}-{idx}-{name}"
// AND we have brand_activity_log entries. Admin uploads use the same
// pattern now but we can cross-reference activity logs.
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./_load-env.mjs";
loadEnv();

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const cutoff = new Date(Date.now() - 60 * 86400 * 1000).toISOString();

// Join: for each logo, find the brand's submitted_at and the time delta.
const { data: logos } = await s
  .from("brand_logos")
  .select("brand_id, file_name, logo_type, created_at")
  .gte("created_at", cutoff)
  .order("created_at", { ascending: false });

// Group by brand
const byBrand = new Map();
for (const l of logos ?? []) {
  if (!byBrand.has(l.brand_id)) byBrand.set(l.brand_id, []);
  byBrand.get(l.brand_id).push(l);
}

console.log(`${byBrand.size} brands with uploaded files in last 60 days.\n`);

for (const [brandId, files] of byBrand) {
  const { data: brand } = await s
    .from("brands")
    .select("business_name, status, created_at, submitter_email")
    .eq("id", brandId)
    .maybeSingle();
  if (!brand) continue;

  // Was the first file uploaded within 10 minutes of brand creation?
  // That heuristic → public intake. Otherwise → admin upload.
  const firstUpload = new Date(files[files.length - 1].created_at).getTime();
  const brandCreated = new Date(brand.created_at).getTime();
  const deltaMin = (firstUpload - brandCreated) / 60000;
  const likelyPublic = deltaMin < 30; // 30-min window post-create

  console.log(
    `${brand.business_name.padEnd(32)}  [${brand.status.padEnd(9)}]  files=${files.length}  ${
      likelyPublic ? "→ via PUBLIC intake" : "→ added by ADMIN later"
    }  (brand+${deltaMin.toFixed(1)}min)`
  );
}
