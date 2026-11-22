// Bump brand-logos bucket file_size_limit to 500MB so client reel MP4s fit.
// Previously null (meaning project default — Supabase Pro defaults to 50MB),
// which cut off Simon Stewart (Maritimo) when he tried to upload an MP4
// through the intake form on 2026-10-14.
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./_load-env.mjs";
loadEnv();

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// Try progressively smaller sizes until one sticks (project-wide upload
// cap is lower than per-bucket on this plan). Logs which one took.
const SIZES_MB = [500, 250, 100, 75, 50];
let data = null;
let error = null;
let appliedMb = null;
for (const mb of SIZES_MB) {
  const res = await s.storage.updateBucket("brand-logos", {
    public: true,
    fileSizeLimit: mb * 1024 * 1024,
  });
  if (!res.error) {
    data = res.data;
    error = null;
    appliedMb = mb;
    console.log(`applied ${mb}MB`);
    break;
  }
  console.log(`${mb}MB rejected: ${res.error.message}`);
  error = res.error;
}
console.log("applied:", appliedMb, "MB");
console.log("update:", data);
console.log("error:", error);

const after = await s.storage.getBucket("brand-logos");
console.log("after:", after.data);
