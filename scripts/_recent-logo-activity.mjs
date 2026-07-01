// Find recent logo uploads across the whole system so we can see if the
// team member's attempt landed anywhere.

import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./_load-env.mjs";
loadEnv();

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// Last 48 hours of any brand_logos row
const cutoff = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
const { data: rows } = await s
  .from("brand_logos")
  .select("id, brand_id, file_name, file_path, logo_type, created_at")
  .gte("created_at", cutoff)
  .order("created_at", { ascending: false });

console.log(`\n── brand_logos rows in last 48hrs: ${rows?.length ?? 0} ──`);
for (const r of rows ?? []) {
  const { data: brand } = await s
    .from("brands")
    .select("business_name, status")
    .eq("id", r.brand_id)
    .maybeSingle();
  console.log(
    `  ${r.created_at?.slice(0, 19)}  ${brand?.business_name ?? "(unknown)"} [${brand?.status ?? "?"}]  ${r.file_name}`
  );
  console.log(`      path=${r.file_path}`);
}

// Storage objects created in last 48hrs
async function listAll(prefix = "") {
  const out = [];
  const stack = [prefix];
  const seen = new Set();
  while (stack.length) {
    const dir = stack.pop();
    if (seen.has(dir)) continue;
    seen.add(dir);
    const { data } = await s.storage.from("brand-logos").list(dir, { limit: 1000 });
    for (const item of data ?? []) {
      const fullPath = dir ? `${dir}/${item.name}` : item.name;
      if (item.id) out.push({ path: fullPath, created_at: item.created_at });
      else stack.push(fullPath);
    }
  }
  return out;
}
const objects = await listAll();
const recent = objects
  .filter((o) => o.created_at && o.created_at > cutoff)
  .sort((a, b) => b.created_at.localeCompare(a.created_at));
console.log(`\n── Storage brand-logos objects in last 48hrs: ${recent.length} ──`);
for (const o of recent) console.log(`  ${o.created_at?.slice(0, 19)}  ${o.path}`);

// Recent activity log entries
const { data: activity } = await s
  .from("brand_activity_log")
  .select("brand_id, event_type, metadata, created_at")
  .gte("created_at", cutoff)
  .order("created_at", { ascending: false })
  .limit(30);
console.log(`\n── activity log in last 48hrs: ${activity?.length ?? 0} ──`);
for (const a of activity ?? []) {
  console.log(
    `  ${a.created_at?.slice(0, 19)}  brand=${a.brand_id?.slice(0, 8)}  ${a.event_type}  ${JSON.stringify(a.metadata ?? {}).slice(0, 100)}`
  );
}
