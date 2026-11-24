"use server";

// Tick / untick a hand-checked onboarding item (see lib/onboarding/checklist.ts).

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/auth/domain";

// None at the moment: Meta is read from SocialDesk's connected accounts.
const MANUAL_ITEMS = new Set<string>([]);

export async function setOnboardingCheck(brandId: string, item: string, done: boolean): Promise<{ ok: boolean; error?: string }> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isEmailAllowed(user.email)) return { ok: false, error: "Not signed in." };
  if (!MANUAL_ITEMS.has(item)) return { ok: false, error: "That item is checked automatically." };
  const { error } = await supabase.from("brand_activity_log").insert({
    brand_id: brandId,
    user_id: user.id,
    event_type: "onboarding_check",
    metadata: { item, done, by: user.email },
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/client/${brandId}`);
  return { ok: true };
}
