// Find the most-recent intake submission (likely Simon Stewart's,
// since Billy didn't give the brand name).
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
  .select("id, business_name, submitter_name, submitter_email, created_at, status")
  .order("created_at", { ascending: false })
  .limit(10);

for (const b of data ?? []) {
  console.log(
    `${b.created_at?.slice(0, 19)}  [${b.status}]  "${b.business_name}"  — ${b.submitter_name} <${b.submitter_email}>  (${b.id})`
  );
}
