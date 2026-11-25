import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: "", ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value: "", ...options });
        },
      },
    }
  );

  // Verify the session token locally (its signature against the project's
  // public key) instead of a round trip to the auth server on every request.
  // Refreshes an expired session the same way getUser did.
  let user: { id: string; email: string | undefined } | null = null;
  try {
    const { data, error } = await supabase.auth.getClaims();
    const c = data?.claims as { sub?: string; email?: string } | undefined;
    if (!error && c?.sub) user = { id: c.sub, email: c.email };
  } catch {
    user = null;
  }
  if (!user) {
    const { data } = await supabase.auth.getUser();
    user = data.user ? { id: data.user.id, email: data.user.email } : null;
  }

  return { response, user };
}
