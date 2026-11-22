"use client";

// Edit-your-own-profile form. Pure client component — one POST to
// /api/my/profile on Save. RLS on the Supabase side enforces that
// only the row where email = JWT email is writable.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check, Save, Upload, User as UserIcon } from "lucide-react";
import { toast } from "sonner";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DEPARTMENTS, EMPLOYMENT_TYPES, type TeamProfile } from "@/lib/team/profile";

export function ProfileForm({
  initialProfile,
  email,
}: {
  initialProfile: TeamProfile | null;
  email: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(
    initialProfile?.avatar_url ?? null
  );
  const avatarInputRef = useRef<HTMLInputElement>(null);

  async function uploadAvatar(file: File) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Keep it under 5 MB.");
      return;
    }
    setAvatarUploading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      // Path convention: "<email>/<timestamp>-<name>" — matches the
      // storage RLS which checks the first segment against the JWT
      // email. Timestamp defeats same-name caching.
      const safe = file.name.replace(/[^\w.\-]+/g, "_");
      const path = `${email}/${Date.now()}-${safe}`;
      const { error } = await supabase.storage
        .from("team-avatars")
        .upload(path, file, { contentType: file.type, upsert: true });
      if (error) {
        toast.error(`Upload failed: ${error.message}`);
        return;
      }
      const { data: pub } = supabase.storage
        .from("team-avatars")
        .getPublicUrl(path);
      // Save the URL onto the profile right away so it persists even
      // if they leave the page without hitting Save.
      const patch = await fetch("/api/my/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, avatar_url: pub.publicUrl }),
      });
      if (!patch.ok) {
        toast.error("Saved the photo but couldn't update your profile.");
        return;
      }
      setAvatarUrl(pub.publicUrl);
      toast.success("Photo updated.");
      startTransition(() => router.refresh());
    } finally {
      setAvatarUploading(false);
    }
  }

  const [form, setForm] = useState({
    name: initialProfile?.name ?? "",
    title: initialProfile?.title ?? "",
    department: initialProfile?.department ?? "",
    employment_type: initialProfile?.employment_type ?? "full_time",
    phone: initialProfile?.phone ?? "",
    pronouns: initialProfile?.pronouns ?? "",
    slack_handle: initialProfile?.slack_handle ?? "",
    time_zone: initialProfile?.time_zone ?? "",
    location: initialProfile?.location ?? "",
    birthday: initialProfile?.birthday ?? "",
    start_date: initialProfile?.start_date ?? "",
    bio: initialProfile?.bio ?? "",
    fun_fact: initialProfile?.fun_fact ?? "",
    skills: (initialProfile?.skills ?? []).join(", "),
  });

  function patch<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save() {
    setSaving(true);
    try {
      const skills = form.skills
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 20);
      const res = await fetch("/api/my/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, skills }),
      });
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({ error: "Save failed." }))) as {
          error?: string;
        };
        toast.error(error ?? "Couldn't save profile.");
        return;
      }
      toast.success("Profile saved.");
      startTransition(() => router.refresh());
    } catch {
      toast.error("Network error — try again.");
    } finally {
      setSaving(false);
    }
  }

  const initials = (form.name || email)
    .split(/[\s@]+/)
    .slice(0, 2)
    .map((s) => s.charAt(0).toUpperCase())
    .join("");

  return (
    <div className="flex flex-col gap-6">
      {/* Avatar */}
      <section className="rounded-xl border border-border/70 bg-panel p-5">
        <div className="mb-4 border-b border-border/60 pb-2.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Photo
        </div>
        <div className="flex items-center gap-4">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt={form.name}
              className="h-16 w-16 rounded-full object-cover ring-1 ring-border"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft text-[16px] font-semibold text-accent-foreground">
              {initials || <UserIcon className="h-5 w-5" />}
            </div>
          )}
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadAvatar(f);
            }}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => avatarInputRef.current?.click()}
            disabled={avatarUploading}
            className="gap-1.5"
          >
            {avatarUploading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            {avatarUrl ? "Change photo" : "Upload photo"}
          </Button>
          <span className="text-[11px] text-muted-foreground">
            PNG, JPG, WebP, or GIF. Up to 5 MB.
          </span>
        </div>
      </section>

      {/* Basics */}
      <Section label="Basics">
        <Field label="Name">
          <Input value={form.name} onChange={(e) => patch("name", e.target.value)} />
        </Field>
        <Field label="Email">
          <Input value={email} disabled className="bg-secondary/40" />
        </Field>
        <Field label="Title">
          <Input
            placeholder="Founder & CEO"
            value={form.title}
            onChange={(e) => patch("title", e.target.value)}
          />
        </Field>
        <Field label="Department">
          <Select
            value={form.department}
            onValueChange={(v) => patch("department", v)}
          >
            <SelectTrigger><SelectValue placeholder="Pick one" /></SelectTrigger>
            <SelectContent>
              {DEPARTMENTS.map((d) => (
                <SelectItem key={d} value={d}>{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Employment">
          <Select
            value={form.employment_type}
            onValueChange={(v) => patch("employment_type", v as typeof form.employment_type)}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {EMPLOYMENT_TYPES.map((e) => (
                <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </Section>

      {/* Contact */}
      <Section label="Contact">
        <Field label="Phone">
          <Input
            placeholder="813-555-0100"
            value={form.phone}
            onChange={(e) => patch("phone", e.target.value)}
          />
        </Field>
        <Field label="Location">
          <Input
            placeholder="Tampa, FL"
            value={form.location}
            onChange={(e) => patch("location", e.target.value)}
          />
        </Field>
        <Field label="Time zone">
          <Input
            placeholder="ET"
            value={form.time_zone}
            onChange={(e) => patch("time_zone", e.target.value)}
          />
        </Field>
        <Field label="Pronouns">
          <Input
            placeholder="they/them"
            value={form.pronouns}
            onChange={(e) => patch("pronouns", e.target.value)}
          />
        </Field>
      </Section>

      {/* Dates */}
      <Section label="Dates">
        <Field label="Birthday" helper="Year is optional. We only show the month + day.">
          <Input
            type="date"
            value={form.birthday}
            onChange={(e) => patch("birthday", e.target.value)}
          />
        </Field>
        <Field label="Start date" helper="Powers work-anniversary notifications.">
          <Input
            type="date"
            value={form.start_date}
            onChange={(e) => patch("start_date", e.target.value)}
          />
        </Field>
      </Section>

      {/* About */}
      <Section label="About you">
        <Field label="Short bio" span2>
          <Textarea
            rows={3}
            placeholder="A sentence or two about what you do + what you're into."
            value={form.bio}
            onChange={(e) => patch("bio", e.target.value)}
          />
        </Field>
        <Field label="Fun fact" span2>
          <Textarea
            rows={2}
            placeholder="Something teammates would never guess."
            value={form.fun_fact}
            onChange={(e) => patch("fun_fact", e.target.value)}
          />
        </Field>
        <Field label="Skills" helper="Comma-separated. Helps teammates know who to ask." span2>
          <Input
            placeholder="brand strategy, motion design, cold outreach"
            value={form.skills}
            onChange={(e) => patch("skills", e.target.value)}
          />
        </Field>
      </Section>

      <div className="sticky bottom-4 flex items-center gap-3 rounded-xl border border-border/70 bg-panel p-4 shadow-sm">
        <Button
          type="button"
          onClick={save}
          disabled={saving || isPending}
          className="gap-1.5"
        >
          {saving || isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          {saving ? "Saving…" : "Save profile"}
        </Button>
        {initialProfile?.updated_at ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Check className="h-3 w-3" />
            Last saved {new Date(initialProfile.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border/70 bg-panel p-5">
      <div className="mb-4 border-b border-border/60 pb-2.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{children}</div>
    </section>
  );
}

function Field({
  label,
  helper,
  span2,
  children,
}: {
  label: string;
  helper?: string;
  span2?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${span2 ? "md:col-span-2" : ""}`}>
      <label className="text-[11px] font-medium text-foreground">{label}</label>
      {children}
      {helper ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">{helper}</p>
      ) : null}
    </div>
  );
}
