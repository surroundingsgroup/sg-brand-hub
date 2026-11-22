// Create a short-lived helper function to list policies, call it, then
// drop it. The admin client can run DDL via the pg_rest "rpc" fallback
// so this is the cleanest way to introspect without the CLI.
//
// Supabase doesn't expose a direct SQL endpoint on the REST API, but we
// can create a function with CREATE FUNCTION via the pg-meta... actually
// no. We don't have that either.
//
// Fastest path: create a view in a migration. Even faster for one-off:
// use the fact that admin service role can bypass RLS and query
// pg_policies directly via a .from() call? pg_policies IS a view in
// pg_catalog but PostgREST only exposes exposed schemas.
//
// So: use node-postgres directly against the Postgres connection string
// if available in the env.
import { loadEnv } from "./_load-env.mjs";
loadEnv();

const uri = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!uri) {
  console.log("No direct DB connection string in env (SUPABASE_DB_URL / DATABASE_URL / POSTGRES_URL).");
  console.log("Available keys:", Object.keys(process.env).filter((k) => k.includes("DB") || k.includes("POSTGRES") || k.includes("SUPABASE")).join(", "));
  process.exit(1);
}
console.log(`Connecting to ${uri.replace(/:[^:@]+@/, ":****@")}`);

const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString: uri });
await client.connect();

const { rows } = await client.query(`
  select schemaname, tablename, policyname, cmd, roles, qual::text, with_check::text
  from pg_policies
  where (schemaname = 'storage' and tablename = 'objects')
     or (schemaname = 'public' and tablename in ('brand_logos', 'brands'))
  order by schemaname, tablename, policyname;
`);
for (const r of rows) {
  console.log(`\n[${r.schemaname}.${r.tablename}] ${r.policyname}  cmd=${r.cmd}  roles=${r.roles}`);
  if (r.qual) console.log(`  USING:      ${r.qual}`);
  if (r.with_check) console.log(`  WITH CHECK: ${r.with_check}`);
}

await client.end();
