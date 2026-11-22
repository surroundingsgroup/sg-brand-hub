// Isolate the RLS failure: try inserting a brand_logos row for a fresh
// submitted brand using the anon key. If both this AND storage upload
// fail, both policies are missing. If only storage fails, that's where
// the regression is.
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./_load-env.mjs";
loadEnv();

const anon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false } }
);
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const BASE = process.env.NEXT_PUBLIC_APP_URL || "https://sg-brand-hub.vercel.app";
const r = await fetch(`${BASE}/api/intake`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    business_name: `__RLS Probe ${Date.now()}`,
    submitter_name: "RLS Probe",
    submitter_email: "rls@surroundingsgroup.com",
    website_alt: "",
    colors: [],
    fonts: [],
  }),
});
const { id: brandId } = await r.json();
console.log(`brand: ${brandId}`);

// Try inserting a brand_logos row
const { error } = await anon.from("brand_logos").insert({
  brand_id: brandId,
  file_name: "probe.png",
  file_path: `${brandId}/logo/probe.png`,
  public_url: "https://example.com/probe.png",
  display_order: 0,
});
console.log(
  `anon brand_logos insert: ${error ? "FAIL: " + error.message + " (code=" + error.code + ")" : "OK"}`
);

// Clean up
await admin.from("brand_logos").delete().eq("brand_id", brandId);
await admin.from("brands").delete().eq("id", brandId);
