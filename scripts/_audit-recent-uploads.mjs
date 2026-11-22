// Audit: of every brand submitted since the retry/dedup fix shipped
// (2026-10-14), did their logo and reference files actually land in
// Storage + brand_logos? Any zero-file submissions are suspicious.
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./_load-env.mjs";
loadEnv();

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const SINCE = "2026-10-14T00:00:00Z";

const { data: brands, error } = await s
  .from("brands")
  .select("id, business_name, submitter_name, submitter_email, created_at, status, client_asset_folder_url")
  .gte("created_at", SINCE)
  .order("created_at", { ascending: false });

if (error) {
  console.error(error);
  process.exit(1);
}

console.log(`Brands created since ${SINCE.slice(0, 10)}: ${brands.length}\n`);

let totalOkWithFiles = 0;
let totalSubmittedNoFiles = 0;
let totalSubmittedWithLink = 0;
let totalDraftNoFiles = 0;

for (const b of brands) {
  const { data: logos } = await s
    .from("brand_logos")
    .select("file_name, file_path, logo_type, created_at")
    .eq("brand_id", b.id)
    .order("created_at", { ascending: true });

  const n = logos?.length ?? 0;
  const nLogos = (logos ?? []).filter((l) => l.logo_type !== "reference").length;
  const nRefs = (logos ?? []).filter((l) => l.logo_type === "reference").length;

  let verdict;
  if (b.status === "submitted" && n > 0) {
    verdict = "OK";
    totalOkWithFiles++;
  } else if (b.status === "submitted" && n === 0 && b.client_asset_folder_url) {
    verdict = "LINK-ONLY";
    totalSubmittedWithLink++;
  } else if (b.status === "submitted" && n === 0) {
    verdict = "⚠ SUBMITTED-NO-FILES";
    totalSubmittedNoFiles++;
  } else if (b.status === "draft") {
    verdict = "draft";
    totalDraftNoFiles++;
  } else {
    verdict = `? status=${b.status}`;
  }

  console.log(
    `${b.created_at?.slice(0, 19)}  ${verdict.padEnd(22)}  "${b.business_name}"  files=${n} (logos=${nLogos} refs=${nRefs})`
  );
  if (b.submitter_name) {
    console.log(`    ${b.submitter_name} <${b.submitter_email}>`);
  }
  if (verdict === "LINK-ONLY") {
    console.log(`    link: ${b.client_asset_folder_url}`);
  }
  if (n > 0 && n <= 6) {
    for (const l of logos) {
      console.log(`      · [${l.logo_type ?? "logo"}] ${l.file_name}`);
    }
  } else if (n > 6) {
    console.log(`      · (${n} files, first: ${logos[0].file_name})`);
  }
}

console.log("\n── Summary ──");
console.log(`  OK (submitted + files):    ${totalOkWithFiles}`);
console.log(`  LINK-ONLY submits:         ${totalSubmittedWithLink}`);
console.log(`  ⚠ SUBMITTED but 0 files:   ${totalSubmittedNoFiles}`);
console.log(`  Drafts (in progress):      ${totalDraftNoFiles}`);
