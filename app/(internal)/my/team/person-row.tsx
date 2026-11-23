// A single row in the team directory. Pulled into its own file so the
// interactive search layer can reuse it.

import { Mail, Phone } from "lucide-react";
import type { TeamProfile } from "@/lib/team/profile";

export type DirectoryRow = {
  monday_id: string | null;
  email: string;
  name: string;
  profile: TeamProfile | null;
};

export function PersonRow({
  r,
  isAm,
  isMe,
}: {
  r: DirectoryRow;
  isAm: boolean;
  isMe: boolean;
}) {
  const p = r.profile;
  const display = p?.name ?? r.name;
  const initials = display
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s.charAt(0).toUpperCase())
    .join("");
  return (
    <li className="flex items-start gap-4 px-5 py-4">
      {p?.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={p.avatar_url}
          alt={display}
          className="h-10 w-10 flex-shrink-0 rounded-full object-cover ring-1 ring-border"
        />
      ) : (
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-accent-soft text-[12px] font-medium text-accent-foreground">
          {initials || "?"}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[14px] font-semibold text-foreground">
            {display}
          </span>
          {isMe ? (
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              You
            </span>
          ) : null}
          {isAm ? (
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-accent-foreground">
              AM
            </span>
          ) : null}
          {p?.employment_type === "contractor" ? (
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Contractor
            </span>
          ) : null}
        </div>
        {p?.title || p?.department ? (
          <div className="mt-0.5 text-[12px] text-muted-foreground">
            {[p?.title, p?.department].filter(Boolean).join(" · ")}
          </div>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground">
          <a
            href={`mailto:${r.email}`}
            className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
          >
            <Mail className="h-3 w-3" />
            {r.email}
          </a>
          {p?.phone ? (
            <a
              href={`tel:${p.phone.replace(/[^+\d]/g, "")}`}
              className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
            >
              <Phone className="h-3 w-3" />
              {p.phone}
            </a>
          ) : null}
          {p?.location ? <span>{p.location}</span> : null}
          {p?.time_zone ? <span>{p.time_zone}</span> : null}
        </div>
        {p?.bio ? (
          <p className="mt-2 text-[12.5px] leading-relaxed text-foreground/80">
            {p.bio}
          </p>
        ) : null}
        {p?.skills && p.skills.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {p.skills.slice(0, 10).map((s) => (
              <span
                key={s}
                className="rounded-full bg-secondary px-2 py-0.5 text-[10.5px] text-foreground/70"
              >
                {s}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </li>
  );
}
