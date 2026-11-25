import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

export function createSupabaseServerClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // Called from a Server Component — cookies are read-only there.
            // Middleware handles refresh, so this is safe to swallow.
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: "", ...options });
          } catch {}
        },
      },
    }
  );
}

/**
 * The signed-in person, checked without a trip to the auth server: the
 * session token's signature is verified here against the project's public
 * signing key (cached). Falls back to asking the auth server if that fails.
 */
export async function currentUser(
  supabase: ReturnType<typeof createSupabaseServerClient>
): Promise<{ id: string; email: string | null; name: string | null } | null> {
  try {
    const { data, error } = await supabase.auth.getClaims();
    const c = data?.claims as { sub?: string; email?: string; user_metadata?: { full_name?: string } } | undefined;
    if (!error && c?.sub) return { id: c.sub, email: c.email?.toLowerCase() ?? null, name: c.user_metadata?.full_name ?? null };
  } catch {
    // fall through to the auth server
  }
  const { data } = await supabase.auth.getUser();
  const u = data.user;
  return u ? { id: u.id, email: u.email?.toLowerCase() ?? null, name: (u.user_metadata?.full_name as string | undefined) ?? null } : null;
}
