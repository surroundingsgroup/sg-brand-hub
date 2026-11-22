// Dump every Storage RLS policy on brand-logos so we can see what's
// blocking anon uploads.
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./_load-env.mjs";
loadEnv();

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// Policies on storage.objects
const { data, error } = await admin
  .rpc("exec", {}) // may not exist — fall through
  .maybeSingle?.();

// Simpler: raw SQL via REST
const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/pg_policies_list`;
const resp = await fetch(url, {
  method: "POST",
  headers: {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  },
  body: "{}",
});
console.log("pg_policies_list:", resp.status, await resp.text().catch(() => "?"));

// Alternative: hit pg_catalog via Supabase's SQL REST endpoint
const sql = `
  select schemaname, tablename, policyname, cmd, qual, with_check, roles
  from pg_policies
  where tablename in ('objects','brand_logos','brands')
  order by schemaname, tablename, policyname;
`;
const sqlResp = await fetch(
  `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/exec_sql`,
  {
    method: "POST",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql }),
  }
);
console.log("\nexec_sql:", sqlResp.status, await sqlResp.text().catch(() => "?"));
