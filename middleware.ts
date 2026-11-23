import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { isEmailAllowed } from "@/lib/auth/domain";

const PUBLIC_PATHS = [
  "/intake",
  "/thanks",
  "/login",
  "/auth/callback",
  "/api/intake",
  "/share",
  "/api/share",
  // Inbound webhooks from external systems (Monday, etc.) — auth'd at the
  // route handler level via shared secret / payload verification, not via
  // the team Supabase session.
  "/api/webhooks",
  // Dev/test endpoints — gated on a bearer token at the route level (the
  // service-role key), not via the team session.
  "/api/dev",
  // Contract-health feed for the Brief Tool (bearer secret at the route).
  "/api/contract-health",
  "/api/pto-sync", // Brief tool cron; bearer HUB_BRIEF_API_TOKEN
  // Drafted-scope feed for the Brief Tool's morning run (same bearer secret).
  "/api/agreement-drafts",
  // Connector API for an outside assistant (its own bearer token at the route).
  "/api/connect",
  // Home-screen app manifest + icons (not sensitive; fetched without cookies).
  "/manifest.webmanifest",
  "/pwa-icon",
  "/apple-icon",
  "/icon",
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const { response, user } = await updateSession(request);

  // Public routes: pass through.
  if (isPublicPath(pathname)) return response;

  // Unauthenticated → /login
  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Wrong domain → /login with error
  if (!isEmailAllowed(user.email)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("error", "domain");
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico)$).*)"],
};
