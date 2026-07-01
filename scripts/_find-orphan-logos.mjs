// Sweep the entire brand-logos bucket to find Storage objects that don't
// have a corresponding row in brand_logos. Those are the exact fingerprint
// of "upload succeeded, DB save was blocked."
//
// Usage: node scripts/_find-orphan-logos.mjs

import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./_load-env.mjs";
loadEnv();

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// 1. Get all DB rows' file paths
const { data: rows } = await s
  .from("brand_logos")
  .select("brand_id, file_path, created_at");
const dbPaths = new Set((rows ?? []).map((r) => r.file_path));
console.log(`brand_logos DB rows: ${rows?.length ?? 0}`);

// 2. Walk the whole storage bucket
async function listAll(prefix = "") {
  const out = [];
  const stack = [prefix];
  const seen = new Set();
  while (stack.length) {
    const dir = stack.pop();
    if (seen.has(dir)) continue;
    seen.add(dir);
    const { data, error } = await s.storage
      .from("brand-logos")
      .list(dir, { limit: 1000 });
    if (error) {
      console.error(`list(${dir}) error: ${error.message}`);
      continue;
    }
    for (const item of data ?? []) {
      const fullPath = dir ? `${dir}/${item.name}` : item.name;
      if (item.id) {
        out.push({
          path: fullPath,
          created_at: item.created_at,
          size: item.metadata?.size ?? 0,
        });
      } else {
        stack.push(fullPath);
      }
    }
  }
  return out;
}

const storage = await listAll();
console.log(`storage objects: ${storage.length}\n`);

// 3. Reconcile
const orphans = storage.filter((o) => !dbPaths.has(o.path));

// Group orphans by brand + separate intake-style vs internal-editor-style
console.log(`── ORPHAN FILES (Storage but no DB row): ${orphans.length} ──`);
if (orphans.length === 0) {
  console.log("  (none)\n");
} else {
  // Sort newest-first so it's easy to spot the recent test uploads
  orphans.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  for (const o of orphans) {
    const brandId = o.path.split("/")[0];
    const secondSeg = o.path.split("/")[1];
    const pattern =
      secondSeg === "logo" || secondSeg === "reference"
        ? `intake:${secondSeg}`
        : `internal-editor`;
    console.log(
      `  ${o.created_at?.slice(0, 19)}  ${o.size.toString().padStart(9)}b  brand=${brandId.slice(0, 8)}  [${pattern}]`
    );
    console.log(`      ${o.path}`);
  }
}

// 4. Also flag brands whose most recent logo attempt was orphaned
const orphansByBrand = new Map();
for (const o of orphans) {
  const brandId = o.path.split("/")[0];
  if (!orphansByBrand.has(brandId)) orphansByBrand.set(brandId, []);
  orphansByBrand.get(brandId).push(o);
}

if (orphansByBrand.size > 0) {
  console.log(`\n── Brands affected ──`);
  for (const [brandId, files] of orphansByBrand) {
    const { data: brand } = await s
      .from("brands")
      .select("business_name, status, created_at")
      .eq("id", brandId)
      .maybeSingle();
    console.log(
      `  ${brand?.business_name ?? "(unknown)"} [${brand?.status ?? "?"}]  brand_id=${brandId}  orphans=${files.length}`
    );
  }
}
