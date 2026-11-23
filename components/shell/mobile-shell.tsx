"use client";
// Mobile app shell — phones only (hidden from md up, where the top nav tabs
// take over). Gives Surroundings the shape of a native app:
//
//   • a bottom tab bar: Clients · Search · (+) · Me · Account
//   • Search: a full-height sheet with instant client lookup
//   • (+): a quick-create action sheet
//   • Me: your own page (My Surroundings); Account: profile, team, sign out
//
// Everything respects the iPhone safe areas so it sits correctly when the app
// is added to the home screen and runs full-screen.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Briefcase,
  ChevronRight,
  FilePlus2,
  Handshake,
  LogOut,
  Plus,
  Search,
  Send,
  UserRound,
  Users,
  X,
  Activity,
} from "lucide-react";
import { toast } from "sonner";
import { cn, initials } from "@/lib/utils";
import { ThemeRow } from "@/components/shell/theme-toggle";
import { ENGAGEMENT_LABELS, type EngagementType } from "@/types/brand";
import { listClientIndex, type ClientIndexRow } from "@/app/(internal)/shell-actions";

const BRIEF_TOOL_URL = "https://briefs.surroundingsgroup.com";
const DEAL_FORM_URL = process.env.NEXT_PUBLIC_DEAL_FORM_URL ?? "https://surroundingsgroup.com/deal";

// ── Bottom sheet ──────────────────────────────────────────────────────────────
function Sheet({
  open,
  onClose,
  title,
  full,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] md:hidden" role="dialog" aria-modal="true" aria-label={title}>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/40 animate-in fade-in duration-200"
      />
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 flex flex-col rounded-t-3xl bg-panel shadow-[0_-8px_40px_rgba(0,0,0,0.18)]",
          "animate-in slide-in-from-bottom duration-300",
          full ? "top-[max(env(safe-area-inset-top),0.75rem)]" : "max-h-[85dvh]"
        )}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 flex-shrink-0 rounded-full bg-border" aria-hidden />
        <div className="flex flex-shrink-0 items-center justify-between px-5 pb-2 pt-3">
          <h2 className="text-[17px] font-semibold tracking-tight text-foreground">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-foreground active:opacity-70"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </div>
  );
}

// A big, thumb-sized row used in the action + account sheets.
function SheetRow({
  icon,
  label,
  hint,
  href,
  external,
  onClick,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  href?: string;
  external?: boolean;
  onClick?: () => void;
  tone?: "default" | "danger";
}) {
  const inner = (
    <>
      <span
        className={cn(
          "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl",
          tone === "danger" ? "bg-destructive/10 text-destructive" : "bg-accent-soft text-accent-foreground"
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className={cn("block text-[15px] font-medium", tone === "danger" ? "text-destructive" : "text-foreground")}>
          {label}
        </span>
        {hint ? <span className="block truncate text-[12px] text-muted-foreground">{hint}</span> : null}
      </span>
      <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground/60" />
    </>
  );
  const cls = "flex min-h-[60px] w-full items-center gap-3 px-5 py-2.5 active:bg-secondary";
  if (href && external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" onClick={onClick} className={cls}>
        {inner}
      </a>
    );
  }
  if (href) {
    return (
      <Link href={href} onClick={onClick} className={cls}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

// ── Search sheet ──────────────────────────────────────────────────────────────
function SearchSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [rows, setRows] = useState<ClientIndexRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ("");
    // Focus on the next frame so the keyboard comes up with the sheet.
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    if (rows === null) {
      listClientIndex()
        .then((r) => setRows(r))
        .catch(() => setFailed(true));
    }
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const results = useMemo(() => {
    const all = rows ?? [];
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((r) => r.name.toLowerCase().includes(needle) || (r.am ?? "").toLowerCase().includes(needle));
  }, [rows, q]);

  return (
    <Sheet open={open} onClose={onClose} title="Find a client" full>
      <div className="sticky top-0 z-10 bg-panel px-5 pb-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Client or account manager"
            className="h-12 w-full rounded-2xl border border-input bg-secondary/50 pl-10 pr-4 text-[16px] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>
      {failed ? (
        <p className="px-5 py-8 text-center text-[13px] text-muted-foreground">Couldn&rsquo;t load clients. Close and try again.</p>
      ) : rows === null ? (
        <ul className="px-5" aria-label="Loading clients">
          {Array.from({ length: 8 }).map((_, i) => (
            <li key={i} className="flex h-[60px] items-center border-b border-border/60">
              <span className="h-3.5 w-2/3 animate-pulse rounded bg-secondary" />
            </li>
          ))}
        </ul>
      ) : results.length === 0 ? (
        <p className="px-5 py-8 text-center text-[13px] text-muted-foreground">No clients match &ldquo;{q}&rdquo;.</p>
      ) : (
        <ul className="pb-4">
          {results.map((r) => (
            <li key={r.id}>
              <Link
                href={`/client/${r.id}`}
                onClick={onClose}
                className="flex min-h-[60px] items-center gap-3 border-b border-border/60 px-5 py-2.5 active:bg-secondary"
              >
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-secondary text-[12px] font-semibold text-secondary-foreground">
                  {initials(r.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium text-foreground">{r.name}</span>
                  <span className="block truncate text-[12px] text-muted-foreground">
                    {[
                      r.engagement ? ENGAGEMENT_LABELS[r.engagement as EngagementType] ?? r.engagement : null,
                      r.am ? `AM ${r.am}` : "No AM",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground/60" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

// ── Tab bar ───────────────────────────────────────────────────────────────────
function Tab({
  label,
  icon,
  active,
  href,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  href?: string;
  onClick?: () => void;
}) {
  const cls = cn(
    "flex h-full flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors active:opacity-60",
    active ? "text-foreground" : "text-muted-foreground"
  );
  const inner = (
    <>
      <span className={cn("flex h-6 items-center justify-center", active && "[&_svg]:stroke-[2.4]")}>{icon}</span>
      {label}
    </>
  );
  return href ? (
    <Link href={href} className={cls} aria-current={active ? "page" : undefined}>
      {inner}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

export function MobileTabBar({ email, admin = false }: { email: string; admin?: boolean }) {
  const pathname = usePathname();
  const [sheet, setSheet] = useState<null | "search" | "create" | "me">(null);
  const close = () => setSheet(null);

  // Any navigation closes whatever sheet is open.
  useEffect(() => {
    setSheet(null);
  }, [pathname]);

  const onClients = ["/dashboard", "/client", "/brand", "/import"].some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
  const onMy = pathname === "/my" || pathname.startsWith("/my/");
  const name = email.split("@")[0] || "?";

  async function shareIntake() {
    const url = `${window.location.origin}/intake`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Brand intake — Surroundings Group", url });
      } else {
        await navigator.clipboard.writeText(url);
        toast.success("Intake form link copied");
      }
    } catch {
      /* share sheet dismissed */
    }
    close();
  }

  return (
    <>
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-panel/95 backdrop-blur supports-[backdrop-filter]:bg-panel/85 md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mx-auto grid h-[60px] max-w-md grid-cols-5 items-stretch px-1">
          <Tab label="Clients" icon={<Briefcase className="h-[22px] w-[22px]" />} href="/dashboard" active={onClients && !sheet} />
          <Tab label="Search" icon={<Search className="h-[22px] w-[22px]" />} onClick={() => setSheet("search")} active={sheet === "search"} />
          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={() => setSheet("create")}
              aria-label="Create"
              className="flex h-12 w-12 items-center justify-center rounded-full bg-foreground text-background shadow-[0_6px_16px_rgba(0,0,0,0.22)] transition-transform active:scale-95"
            >
              <Plus className="h-6 w-6" />
            </button>
          </div>
          <Tab label="Me" icon={<UserRound className="h-[22px] w-[22px]" />} href="/my" active={onMy && !sheet} />
          <Tab
            label="Account"
            onClick={() => setSheet("me")}
            active={sheet === "me"}
            icon={
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-[9px] font-semibold text-secondary-foreground">
                {initials(name)}
              </span>
            }
          />
        </div>
      </nav>

      <SearchSheet open={sheet === "search"} onClose={close} />

      <Sheet open={sheet === "create"} onClose={close} title="Create">
        <div className="pb-3">
          <SheetRow
            icon={<FilePlus2 className="h-5 w-5" />}
            label="New project request"
            hint="Opens the Brief tool"
            href={`${BRIEF_TOOL_URL}/?request=1`}
            external
            onClick={close}
          />
          <SheetRow
            icon={<Handshake className="h-5 w-5" />}
            label="New deal"
            hint="Log a prospect or add a deal"
            href={DEAL_FORM_URL}
            external
            onClick={close}
          />
          <SheetRow
            icon={<Send className="h-5 w-5" />}
            label="Share intake form"
            hint="Send a client the brand intake link"
            onClick={shareIntake}
          />
          <SheetRow icon={<Plus className="h-5 w-5" />} label="New brand" hint="Start a blank client record" href="/brand/new" onClick={close} />
        </div>
      </Sheet>

      <Sheet open={sheet === "me"} onClose={close} title="Account">
        <div className="pb-3">
          <div className="mx-5 mb-2 flex items-center gap-3 rounded-2xl bg-secondary/60 p-3.5">
            <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-foreground text-[13px] font-semibold text-background">
              {initials(name)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-medium capitalize text-foreground">{name}</span>
              <span className="block truncate text-[12px] text-muted-foreground">{email}</span>
            </span>
          </div>
          <SheetRow icon={<UserRound className="h-5 w-5" />} label="Edit your profile" href="/my/profile" onClick={close} />
          {admin ? (
            <SheetRow icon={<Activity className="h-5 w-5" />} label="Account health" hint="Contract pace and renewals, all clients" href="/accounts" onClick={close} />
          ) : null}
          <SheetRow icon={<Users className="h-5 w-5" />} label="Team directory" href="/my/team" onClick={close} />
          <ThemeRow />
          <form action="/auth/signout" method="post">
            <button type="submit" className="flex min-h-[60px] w-full items-center gap-3 px-5 py-2.5 active:bg-secondary">
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
                <LogOut className="h-5 w-5" />
              </span>
              <span className="flex-1 text-left text-[15px] font-medium text-destructive">Sign out</span>
            </button>
          </form>
        </div>
      </Sheet>
    </>
  );
}
