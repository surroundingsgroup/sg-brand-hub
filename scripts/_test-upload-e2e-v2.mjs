// Try again but add a 2s delay after brand creation. Also log the exact
// path and the brand status right before the upload attempt.
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

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64"
);

const BASE = process.env.NEXT_PUBLIC_APP_URL || "https://sg-brand-hub.vercel.app";
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
const { id: brandId } = await r.json();
console.log(`✓ brand created: ${brandId}`);

// Verify the brand is visible, has correct status + fresh timestamp
const { data: brand } = await admin
  .from("brands")
  .select("id, status, created_at")
  .eq("id", brandId)
  .maybeSingle();
console.log(`brand: ${JSON.stringify(brand)}`);
const ageSec = (Date.now() - new Date(brand.created_at).getTime()) / 1000;
console.log(`brand age at upload attempt: ${ageSec.toFixed(1)}s`);

// Try multiple path patterns
const patterns = [
  `${brandId}/logo/${Date.now()}-0-test.png`,
  `${brandId}/${Date.now()}-0-test.png`,  // flat (older path pattern)
  `${brandId}/reference/${Date.now()}-0-test.png`,
];
for (const path of patterns) {
  const { error } = await anon.storage.from("brand-logos").upload(path, PNG, {
    contentType: "image/png",
  });
  console.log(`  path="${path}"  →  ${error ? "FAIL: " + error.message : "OK"}`);
  if (!error) {
    await admin.storage.from("brand-logos").remove([path]);
  }
}

// Clean up
await admin.from("brands").delete().eq("id", brandId);
console.log(`✓ cleaned up`);
