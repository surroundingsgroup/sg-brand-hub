// Client contact tile — compact card with the POC and brand socials.
// Rewritten to be smaller and cleaner than the pre-redesign version:
// single column, no section dividers, a tight social-icon strip at
// the bottom. Sits in the client profile grid like any other tile.

import {
  Users,
  Mail,
  Phone,
  Instagram,
  Facebook,
  Youtube,
  Linkedin,
  Globe,
} from "lucide-react";
import { Tile, TileEmpty } from "./tile";
import type { Brand } from "@/types/brand";

function TikTok(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.85-4.43V9a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1.83-.43Z" />
    </svg>
  );
}

function socialUrl(platform: string, handle: string): string {
  if (/^https?:\/\//i.test(handle)) return handle;
  const clean = handle.trim().replace(/^@/, "").replace(/\/$/, "");
  switch (platform) {
    case "Instagram": return `https://instagram.com/${clean}`;
    case "Facebook": return `https://facebook.com/${clean}`;
    case "YouTube":
      return clean.startsWith("@") ? `https://youtube.com/${clean}` : `https://youtube.com/@${clean}`;
    case "TikTok": return `https://tiktok.com/@${clean.replace(/^@/, "")}`;
    case "LinkedIn":
      return clean.includes("company/") || clean.includes("in/")
        ? `https://linkedin.com/${clean}`
        : `https://linkedin.com/company/${clean}`;
    default: return clean;
  }
}

const SOCIALS: Array<{
  key: keyof Brand & string;
  label: string;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}> = [
  { key: "instagram", label: "Instagram", Icon: Instagram },
  { key: "facebook", label: "Facebook", Icon: Facebook },
  { key: "youtube", label: "YouTube", Icon: Youtube },
  { key: "tiktok", label: "TikTok", Icon: TikTok },
  { key: "linkedin", label: "LinkedIn", Icon: Linkedin },
];

export function ContactTile({ brand }: { brand: Brand }) {
  const name = brand.submitter_name?.trim() || null;
  const email = brand.submitter_email?.trim() || null;
  const phone = brand.submitter_phone?.trim() || null;
  const website = brand.website?.trim() || null;

  const socialRows = SOCIALS.map(({ key, label, Icon }) => {
    const raw = (brand as unknown as Record<string, string | null | undefined>)[key];
    if (!raw || !raw.trim()) return null;
    return { label, Icon, href: socialUrl(label, raw) };
  }).filter((x): x is { label: string; Icon: typeof Instagram; href: string } => !!x);

  const hasAny = !!(name || email || phone || website || socialRows.length);

  return (
    <Tile label="Contact" icon={<Users className="h-3.5 w-3.5" />}>
      {!hasAny ? (
        <TileEmpty>No contact info on file yet.</TileEmpty>
      ) : (
        <div className="flex flex-col gap-2 text-[13px] -mt-1">
          {name ? (
            <div className="font-medium text-foreground">{name}</div>
          ) : null}
          {email ? (
            <a
              href={`mailto:${email}`}
              className="inline-flex items-center gap-2 text-foreground/85 transition-colors hover:text-foreground"
            >
              <Mail className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="truncate">{email}</span>
            </a>
          ) : null}
          {phone ? (
            <a
              href={`tel:${phone.replace(/[^+\d]/g, "")}`}
              className="inline-flex items-center gap-2 text-foreground/85 transition-colors hover:text-foreground"
            >
              <Phone className="h-3.5 w-3.5 text-muted-foreground" />
              {phone}
            </a>
          ) : null}
          {website ? (
            <a
              href={website.startsWith("http") ? website : `https://${website}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-foreground/85 transition-colors hover:text-foreground"
            >
              <Globe className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="truncate">
                {website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
              </span>
            </a>
          ) : null}
          {socialRows.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-2 border-t border-border/60 pt-2.5">
              {socialRows.map(({ label, Icon, href }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={label}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-secondary hover:text-foreground"
                >
                  <Icon className="h-3.5 w-3.5" />
                </a>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </Tile>
  );
}
