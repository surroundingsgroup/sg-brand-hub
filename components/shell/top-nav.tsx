"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, Users, Briefcase, ChevronLeft } from "lucide-react";
import { cn, initials } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Top nav. One Hub, two surfaces:
//
//   • Client Hub — everything client-facing. Dashboard, per-client
//     profile, brand edit. Lives under /dashboard, /client/*, /brand/*.
//
//   • My Hub — personal workspace: your assigned clients, team
//     directory, resources, PTO, signature. Lives under /my/*.
//
// The tabs here are the top-level IA. Breadcrumbs under them give
// the "where am I now" context inside each surface.

const CLIENT_HUB_PATHS = ["/dashboard", "/client", "/brand"];
const MY_HUB_PATHS = ["/my"];

function isClientHubPath(p: string): boolean {
  return CLIENT_HUB_PATHS.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}
function isMyHubPath(p: string): boolean {
  return MY_HUB_PATHS.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

type Crumb = { label: string; href?: string };

function buildCrumbs(pathname: string): Crumb[] {
  const out: Crumb[] = [];
  if (pathname.startsWith("/client/")) {
    out.push({ label: "Clients", href: "/dashboard" });
    out.push({ label: "Client" });
  } else if (pathname.startsWith("/brand/")) {
    out.push({ label: "Clients", href: "/dashboard" });
    out.push({ label: "Brand" });
  } else if (pathname.startsWith("/my/team")) {
    out.push({ label: "My Surroundings", href: "/my" });
    out.push({ label: "Team Directory" });
  } else if (pathname.startsWith("/my/resources")) {
    out.push({ label: "My Surroundings", href: "/my" });
    out.push({ label: "Resources" });
  } else if (pathname.startsWith("/my/pto")) {
    out.push({ label: "My Surroundings", href: "/my" });
    out.push({ label: "PTO" });
  } else if (pathname.startsWith("/my/signature")) {
    out.push({ label: "My Surroundings", href: "/my" });
    out.push({ label: "Email signature" });
  }
  return out;
}

// Phone header: a section title, plus a back control on pages that sit under
// another page. (Primary navigation on phones is the bottom tab bar.)
const MY_TITLES: Record<string, string> = {
  team: "Team Directory",
  resources: "Resources",
  pto: "PTO",
  signature: "Email signature",
  profile: "Your profile",
  org: "Org chart",
  updates: "Updates",
  events: "Events",
  shoutouts: "Shoutouts",
};
function mobileHeader(pathname: string): {
  title: string;
  parent?: { href: string; label: string };
  hideWordmark?: boolean;
} {
  const seg = pathname.split("/").filter(Boolean);
  if (seg[0] === "client" && seg[1]) {
    const clientHref = `/client/${seg[1]}`;
    if (seg[2] === "allocation") return { title: "Allocation", parent: { href: clientHref, label: "Client" } };
    if (seg[2] === "meeting") return { title: "Meeting notes", parent: { href: clientHref, label: "Client" } };
    return { title: "Client", parent: { href: "/dashboard", label: "Clients" } };
  }
  if (seg[0] === "brand") return { title: "Brand", parent: { href: "/dashboard", label: "Clients" } };
  if (seg[0] === "import") return { title: "Import", parent: { href: "/dashboard", label: "Clients" } };
  if (seg[0] === "my" && seg[1]) return { title: MY_TITLES[seg[1]] ?? "My Surroundings", parent: { href: "/my", label: "Back" } };
  // The title already carries the name, so the wordmark steps aside here.
  if (seg[0] === "my") return { title: "My Surroundings", hideWordmark: true };
  return { title: "Clients" };
}

export function TopNav({ email }: { email: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const mobile = mobileHeader(pathname);
  const crumbs = buildCrumbs(pathname);
  const onClientHub = isClientHubPath(pathname);
  const onMyHub = isMyHubPath(pathname);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-panel/95 pt-[env(safe-area-inset-top)] backdrop-blur supports-[backdrop-filter]:bg-panel/80">
      {/* Phone bar */}
      <div className="relative flex h-12 items-center px-2 md:hidden">
        {mobile.parent ? (
          <button
            type="button"
            onClick={() => (window.history.length > 1 ? router.back() : router.push(mobile.parent!.href))}
            className="flex h-11 items-center gap-0.5 rounded-lg pl-1 pr-3 text-[15px] text-foreground active:opacity-60"
            aria-label={`Back to ${mobile.parent.label}`}
          >
            <ChevronLeft className="h-5 w-5" />
            <span className="max-w-[7.5rem] truncate">{mobile.parent.label}</span>
          </button>
        ) : mobile.hideWordmark ? null : (
          <Link href="/dashboard" className="px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground">
            Surroundings
          </Link>
        )}
        <div className="pointer-events-none absolute inset-x-0 text-center text-[15px] font-semibold tracking-tight text-foreground">
          {mobile.title}
        </div>
      </div>

      {/* Desktop bar */}
      <div className="mx-auto hidden h-14 w-full max-w-[1280px] items-center justify-between gap-6 px-6 md:flex">
        {/* Left: brand + primary tabs */}
        <div className="flex items-center gap-6">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground"
          >
            Surroundings
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <TabLink
              href="/dashboard"
              label="Clients"
              icon={<Briefcase className="h-3.5 w-3.5" />}
              active={onClientHub}
            />
            <TabLink
              href="/my"
              label="My Surroundings"
              icon={<Users className="h-3.5 w-3.5" />}
              active={onMyHub}
            />
          </nav>
          {crumbs.length > 0 ? (
            <div className="hidden items-center gap-1 text-[12px] md:flex">
              <span className="text-muted-foreground/40">/</span>
              {crumbs.map((c, i) => (
                <div key={i} className="flex items-center gap-1">
                  {i > 0 && <span className="text-muted-foreground/40">/</span>}
                  {c.href ? (
                    <Link
                      href={c.href}
                      className={cn(
                        "transition-colors hover:text-foreground",
                        i === crumbs.length - 1 ? "font-medium text-foreground" : "text-muted-foreground"
                      )}
                    >
                      {c.label}
                    </Link>
                  ) : (
                    <span
                      className={cn(
                        i === crumbs.length - 1 ? "font-medium text-foreground" : "text-muted-foreground"
                      )}
                    >
                      {c.label}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {/* Right: account menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-[11px] font-medium text-secondary-foreground transition-opacity hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              aria-label="Account menu"
            >
              {initials(email.split("@")[0] || "?")}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <div className="px-2 py-2">
              <div className="text-sm font-medium">{email.split("@")[0]}</div>
              <div className="truncate text-xs text-muted-foreground">{email}</div>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/my" className="w-full justify-start">
                <Users className="h-4 w-4" />
                My Surroundings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <form action="/auth/signout" method="post">
              <DropdownMenuItem asChild>
                <button type="submit" className="w-full justify-start">
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              </DropdownMenuItem>
            </form>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

function TabLink({
  href,
  label,
  icon,
  active,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] transition-colors",
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground"
      )}
    >
      {icon}
      {label}
    </Link>
  );
}
