// Verify Storage upload works at all with the service role key (bypasses RLS).
// If this works, the problem is clearly on the RLS side; if this also fails,
// something broader is wrong with the bucket.
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./_load-env.mjs";
loadEnv();

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64"
);

const path = `__test/${Date.now()}-service-upload.png`;
const { data, error } = await admin.storage.from("brand-logos").upload(path, PNG, {
  contentType: "image/png",
});
console.log("service-role upload:", error ? "FAIL: " + error.message : "OK", data?.path);

if (!error) await admin.storage.from("brand-logos").remove([path]);
