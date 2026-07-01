// Inspect DB rows + Storage objects for a brand's logos.
// Usage: BRAND_ID=<uuid> node scripts/_check-logo-uploads.mjs

import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./_load-env.mjs";
loadEnv();

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const brandId = process.env.BRAND_ID;
if (!brandId) throw new Error("Set BRAND_ID=<uuid>");

console.log(`\nBRAND ID: ${brandId}\n`);

// DB rows
const { data: rows, error: rowsErr } = await s
  .from("brand_logos")
  .select("id, file_name, file_path, logo_type, display_order, created_at")
  .eq("brand_id", brandId)
  .order("created_at", { ascending: false });
if (rowsErr) console.error("rows error:", rowsErr.message);
console.log(`── brand_logos DB rows (${rows?.length ?? 0}) ────────────────`);
(rows ?? []).forEach((r) =>
  console.log(`  ${r.created_at?.slice(0, 19)}  ${r.logo_type ?? "(no type)"}  ${r.file_name}  path=${r.file_path}`)
);

// Storage objects — recursively list everything under {brandId}/
async function listAll(prefix) {
  const out = [];
  const seen = new Set();
  const stack = [prefix];
  while (stack.length) {
    const dir = stack.pop();
    if (seen.has(dir)) continue;
    seen.add(dir);
    const { data, error } = await s.storage.from("brand-logos").list(dir, { limit: 100 });
    if (error) {
      console.error(`list(${dir}) error:`, error.message);
      continue;
    }
    for (const item of data ?? []) {
      const fullPath = dir ? `${dir}/${item.name}` : item.name;
      if (item.id) {
        out.push({ path: fullPath, created_at: item.created_at, size: item.metadata?.size });
      } else {
        // folder marker
        stack.push(fullPath);
      }
    }
  }
  return out;
}
const objects = await listAll(brandId);
console.log(`\n── brand-logos Storage objects (${objects.length}) ────────`);
objects.forEach((o) =>
  console.log(`  ${o.created_at?.slice(0, 19)}  ${(o.size ?? 0).toString().padStart(8)} bytes  ${o.path}`)
);

// Reconcile
const rowPaths = new Set((rows ?? []).map((r) => r.file_path));
const storagePaths = new Set(objects.map((o) => o.path));
const orphanFiles = objects.filter((o) => !rowPaths.has(o.path));
const orphanRows = (rows ?? []).filter((r) => !storagePaths.has(r.file_path));

console.log(`\n── Reconciliation ────────────────────────────────────────`);
console.log(`  Files in Storage WITHOUT a DB row: ${orphanFiles.length}`);
orphanFiles.forEach((o) => console.log(`    ⚠️  ${o.created_at?.slice(0, 19)}  ${o.path}`));
console.log(`  DB rows WITHOUT a Storage file:    ${orphanRows.length}`);
orphanRows.forEach((r) => console.log(`    ⚠️  ${r.created_at?.slice(0, 19)}  ${r.file_path}`));
console.log();
