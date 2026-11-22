// Check brand-logos bucket config (file size limit, allowed mime types).
// We need this to be at least 200MB so client reel MP4s fit.
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./_load-env.mjs";
loadEnv();

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const { data, error } = await s.storage.getBucket("brand-logos");
console.log("bucket:", data);
console.log("error:", error);
