// Query pg_policies via Supabase's internal postgres meta API.
// If the "logos_anon_intake_upload_recent" policy doesn't exist, the
// RLS wall is still the default (no anon inserts allowed).
import { loadEnv } from "./_load-env.mjs";
loadEnv();

const PROJECT_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Use the postgres meta endpoint (available on all Supabase projects).
const sql = `
  select schemaname, tablename, policyname, cmd,
         pg_get_expr(qual, polrelid, true) as qual_text,
         pg_get_expr(with_check, polrelid, true) as with_check_text,
         roles
  from pg_policies p
  join pg_class c on c.relname = p.tablename
  join pg_policy pol on pol.polname = p.policyname and pol.polrelid = c.oid
  where (schemaname = 'storage' and tablename = 'objects')
     or (schemaname = 'public' and tablename in ('brand_logos', 'brands'))
  order by schemaname, tablename, policyname;
`;

// Try pg-meta endpoint
const resp = await fetch(`${PROJECT_URL}/pg/query`, {
  method: "POST",
  headers: {
    apikey: SERVICE,
    Authorization: `Bearer ${SERVICE}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ query: sql }),
});
console.log("pg/query:", resp.status);
if (resp.ok) {
  console.log(await resp.text());
} else {
  console.log("body:", await resp.text());
}
