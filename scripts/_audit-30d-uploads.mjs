// 30-day view: brand_logos + storage objects by day. If nothing lands in
// Storage even though brands are being created, the upload path is broken.
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./_load-env.mjs";
loadEnv();

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const cutoff = new Date(Date.now() - 30 * 86400 * 1000).toISOString();

// All brand_logos rows in 30 days
const { data: rows } = await s
  .from("brand_logos")
  .select("id, brand_id, file_name, file_path, logo_type, created_at")
  .gte("created_at", cutoff)
  .order("created_at", { ascending: false });

console.log(`brand_logos rows in last 30 days: ${rows?.length ?? 0}`);
const byDay = new Map();
for (const r of rows ?? []) {
  const day = r.created_at.slice(0, 10);
  byDay.set(day, (byDay.get(day) ?? 0) + 1);
}
for (const [day, n] of [...byDay].sort().reverse()) {
  console.log(`  ${day}  ${n}`);
}

// Latest 20 rows
console.log(`\nLatest 20 brand_logos rows:`);
for (const r of (rows ?? []).slice(0, 20)) {
  const { data: brand } = await s
    .from("brands")
    .select("business_name, status, submitter_email")
    .eq("id", r.brand_id)
    .maybeSingle();
  console.log(
    `  ${r.created_at?.slice(0, 19)}  ${brand?.business_name ?? "?"} [${brand?.status ?? "?"}]  ${r.file_name} (${r.logo_type ?? "logo"})`
  );
}

// Storage objects
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
console.log(`\nStorage brand-logos objects in last 30 days: ${recent.length}`);
const byDay2 = new Map();
for (const r of recent) {
  const day = r.created_at.slice(0, 10);
  byDay2.set(day, (byDay2.get(day) ?? 0) + 1);
}
for (const [day, n] of [...byDay2].sort().reverse()) {
  console.log(`  ${day}  ${n}`);
}
