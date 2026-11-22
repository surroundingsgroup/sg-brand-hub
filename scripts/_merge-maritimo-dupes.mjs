// Simon Stewart (Maritimo) submitted the intake form 3× in a row on
// 2026-10-14 after hitting Retry when his MP4 failed to upload. The
// retry fix (now deployed) re-uses the created brand, but we still have
// three Maritimo rows in prod. This script keeps the FIRST successful
// one and deletes the two later duplicates — but ONLY if they have no
// uploaded logos / reference files attached (checked via brand_logos).
//
// Run with: node scripts/_merge-maritimo-dupes.mjs --dry
//   (default is dry run; pass --apply to actually delete)
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./_load-env.mjs";
loadEnv();

const APPLY = process.argv.includes("--apply");

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const { data: rows, error } = await s
  .from("brands")
  .select("id, business_name, submitter_name, submitter_email, created_at, status")
  .ilike("business_name", "%maritimo%")
  .order("created_at", { ascending: true });

if (error) {
  console.error(error);
  process.exit(1);
}

console.log(`Found ${rows.length} Maritimo brand(s):`);
for (const r of rows) {
  const { count } = await s
    .from("brand_logos")
    .select("id", { count: "exact", head: true })
    .eq("brand_id", r.id);
  console.log(
    `  ${r.created_at?.slice(0, 19)}  [${r.status}]  ${r.id}  files=${count ?? 0}`
  );
}

if (rows.length <= 1) {
  console.log("Nothing to merge.");
  process.exit(0);
}

// Keep the LATEST submitted record (Simon kept editing on retry, so the
// final retry has the most complete data). If none are submitted, fall
// back to the latest row.
const submitted = rows.filter((r) => r.status === "submitted");
const keep =
  submitted.length > 0
    ? submitted[submitted.length - 1]
    : rows[rows.length - 1];
const dupes = rows.filter((r) => r.id !== keep.id);

console.log(`\nKeeping: ${keep.id} (${keep.created_at?.slice(0, 19)})`);
console.log("Deleting duplicates (only if they have 0 files):");

for (const d of dupes) {
  const { count } = await s
    .from("brand_logos")
    .select("id", { count: "exact", head: true })
    .eq("brand_id", d.id);
  if ((count ?? 0) > 0) {
    console.log(`  SKIP ${d.id} — has ${count} file(s), merge manually`);
    continue;
  }
  if (!APPLY) {
    console.log(`  would delete ${d.id}`);
    continue;
  }
  const { error: delErr } = await s.from("brands").delete().eq("id", d.id);
  if (delErr) {
    console.log(`  FAIL ${d.id}: ${delErr.message}`);
  } else {
    console.log(`  deleted ${d.id}`);
  }
}

if (!APPLY) {
  console.log("\n(dry run — re-run with --apply to delete)");
}
