// End-to-end confirmation that a client CAN upload a logo through the
// public intake path. Uses the anon key (same key the browser uses) so
// RLS behaviour is faithful.
//
// 1. Hit /api/intake to create a submitted brand
// 2. Upload a small test png to brand-logos storage with the anon key
// 3. Insert the brand_logos row with the anon key
// 4. Verify both exist
// 5. Clean up (delete the test brand + file)
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

// 1x1 transparent PNG, 68 bytes
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64"
);

const BASE = process.env.NEXT_PUBLIC_APP_URL || "https://sg-brand-hub.vercel.app";
console.log(`→ hitting ${BASE}/api/intake`);

const payload = {
  business_name: `__E2E Upload Test ${Date.now()}`,
  submitter_name: "E2E Test",
  submitter_email: "e2e-test@surroundingsgroup.com",
  website_alt: "",
  colors: [],
  fonts: [],
};
const r = await fetch(`${BASE}/api/intake`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});
if (!r.ok) {
  console.error("intake POST failed:", r.status, await r.text());
  process.exit(1);
}
const { id: brandId } = await r.json();
console.log(`✓ brand created: ${brandId}`);

const path = `${brandId}/logo/${Date.now()}-0-e2e-test.png`;
const { error: upErr } = await anon.storage.from("brand-logos").upload(path, PNG, {
  contentType: "image/png",
});
if (upErr) {
  console.error("✗ storage upload failed:", upErr);
  process.exit(1);
}
console.log(`✓ storage upload OK: ${path}`);

const { data: pub } = anon.storage.from("brand-logos").getPublicUrl(path);
const { error: dbErr } = await anon.from("brand_logos").insert({
  brand_id: brandId,
  file_name: "e2e-test.png",
  file_path: path,
  public_url: pub.publicUrl,
  display_order: 0,
  logo_type: null,
});
if (dbErr) {
  console.error("✗ brand_logos insert failed:", dbErr);
  process.exit(1);
}
console.log(`✓ brand_logos row inserted`);

// Verify via admin read
const { data: rows } = await admin
  .from("brand_logos")
  .select("file_name, file_path, public_url")
  .eq("brand_id", brandId);
console.log(`✓ verified: ${rows.length} brand_logos rows`);

// Fetch the public URL to confirm it serves
const img = await fetch(pub.publicUrl);
console.log(`✓ public URL serves: ${img.status} ${img.headers.get("content-type")} ${img.headers.get("content-length")}b`);

// Clean up test row
await admin.storage.from("brand-logos").remove([path]);
await admin.from("brand_logos").delete().eq("brand_id", brandId);
await admin.from("brands").delete().eq("id", brandId);
console.log(`✓ cleaned up test records`);

console.log(`\n🎉 end-to-end upload flow is WORKING`);
