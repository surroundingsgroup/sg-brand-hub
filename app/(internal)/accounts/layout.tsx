// Account health and everything under it (hours and rates, invoicing, time
// off balances) is for admins only: Billy and Justin, the names in
// lib/access.ts. Anyone else who lands here goes back to the clients list.
// Billy, 2026-11-23: "the account health should just only be accessed by admins."

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/access";

export default async function AccountsLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer(createSupabaseServerClient());
  if (!viewer.everyone) redirect("/dashboard");
  return <>{children}</>;
}
