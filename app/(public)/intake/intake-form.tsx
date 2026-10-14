"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SELECTABLE_VERTICALS, VERTICAL_LABELS } from "@/types/brand";
import { intakeSchema, type IntakeInput } from "./schema";
import { LogoUpload, REFERENCE_UPLOAD_DEFAULTS, type StagedLogo } from "@/components/intake/logo-upload";
import { ColorsField, type IntakeColor } from "@/components/intake/colors-field";
import { FontsField, type IntakeFont } from "@/components/intake/fonts-field";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

function Section({
  label,
  title,
  description,
  children,
}: {
  label: string;
  title?: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-border px-8 py-8 first:border-t-0">
      <Eyebrow>{label}</Eyebrow>
      {title && <h2 className="mt-3 text-lg font-semibold tracking-tight">{title}</h2>}
      {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
      <div className="mt-5 space-y-5">{children}</div>
    </section>
  );
}

function FieldHelper({ children }: { children: React.ReactNode }) {
  return <p className="-mt-1 text-xs leading-relaxed text-muted-foreground">{children}</p>;
}

export type IntakePrefill = {
  business_name?: string;
  submitter_name?: string;
  submitter_email?: string;
};

export function IntakeForm({
  dealId = null,
  prefill = {},
}: {
  dealId?: string | null;
  prefill?: IntakePrefill;
} = {}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [vertical, setVertical] = useState("");
  const [colors, setColors] = useState<IntakeColor[]>([
    { name: "", hex: "#000000", role: "primary" },
    { name: "", hex: "#FFFFFF", role: "secondary" },
  ]);
  const [fonts, setFonts] = useState<IntakeFont[]>([
    { name: "", role: "primary", use_case: "" },
    { name: "", role: "secondary", use_case: "" },
  ]);
  const [logos, setLogos] = useState<StagedLogo[]>([]);
  const [referenceFiles, setReferenceFiles] = useState<StagedLogo[]>([]);
  // Live progress + failure state for the upload step. Previously uploads
  // ran silently in the background and the user got whisked to /thanks
  // regardless of what landed — resulting in bugs like Camper & Nicholsons
  // (Oct 2026) where the client thought their logos uploaded but nothing
  // reached the server.
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number; label: string } | null>(null);
  const [failedUploads, setFailedUploads] = useState<Array<{ name: string; kind: "logo" | "reference" }>>([]);
  // Honeypot — invisible to humans, bots fill it. If non-empty on submit
  // the server silently drops the row. See the hidden <input> in the JSX
  // below and the handler in /api/intake/route.ts.
  const honeypotRef = useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<IntakeInput>({
    resolver: zodResolver(intakeSchema),
    defaultValues: {
      business_name: prefill.business_name ?? "",
      submitter_name: prefill.submitter_name ?? "",
      submitter_email: prefill.submitter_email ?? "",
    },
  });

  /**
   * Upload a single staged file (Storage + DB row). Returns {ok} / {ok:false,error}
   * instead of throwing. Includes one retry on transient failure.
   *
   * The old implementation swallowed errors with a bare `if (upErr) continue;`,
   * which meant a failed Storage write or a failed DB insert both looked
   * identical to success from the user's perspective. The caller now gets
   * structured outcomes so it can surface them.
   */
  async function uploadOne(
    supabase: ReturnType<typeof createSupabaseBrowserClient>,
    brandId: string,
    file: File,
    index: number,
    kind: "logo" | "reference"
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const subPath = kind === "reference" ? "reference" : "logo";
    const safeName = file.name.replace(/\s+/g, "-");
    async function attempt(): Promise<{ ok: true } | { ok: false; error: string }> {
      // Fresh path per attempt so a retry doesn't collide with a Storage
      // record from the first attempt.
      const path = `${brandId}/${subPath}/${Date.now()}-${index}-${safeName}`;
      const { error: upErr } = await supabase.storage.from("brand-logos").upload(path, file);
      if (upErr) return { ok: false, error: `Storage upload failed: ${upErr.message}` };
      const { data: pub } = supabase.storage.from("brand-logos").getPublicUrl(path);
      const { error: dbErr } = await supabase.from("brand_logos").insert({
        brand_id: brandId,
        file_name: file.name,
        file_path: path,
        public_url: pub.publicUrl,
        display_order: index,
        logo_type: kind === "reference" ? "reference" : null,
      });
      if (dbErr) return { ok: false, error: `Save failed: ${dbErr.message}` };
      return { ok: true };
    }
    const first = await attempt();
    if (first.ok) return first;
    // One short retry — most failures here are transient (rate-limit, flaky
    // mobile network). If it still fails after that we surface it loudly.
    await new Promise((r) => setTimeout(r, 800));
    return attempt();
  }

  async function onSubmit(values: IntakeInput) {
    setSubmitting(true);

    // Drop empty color/font entries before submitting.
    //
    // Previously: /^#[0-9A-Fa-f]{6}$/.test(c.hex) && c.hex !== "#000000" || c.name.trim()
    // which (a) excluded #000000 as if it weren't a legitimate brand color
    // (Apple, Nike) and (b) had bad operator precedence — a row with a
    // valid name but malformed hex would pass through and Zod would then
    // reject the whole submission.
    //
    // Now: keep a color iff it has a valid hex AND a non-empty name.
    const cleanedColors = colors.filter(
      (c) => c.name.trim().length > 0 && /^#[0-9A-Fa-f]{6}$/.test(c.hex)
    );
    const cleanedFonts = fonts.filter((f) => f.name.trim().length > 0);

    const payload = {
      ...values,
      vertical: vertical || undefined,
      vertical_other: vertical === "other" ? values.vertical_other : undefined,
      colors: cleanedColors,
      fonts: cleanedFonts,
      // If the BD sent a pre-stamped link with ?deal_id=, carry it through so
      // the server can tie the resulting brand row to the Monday deal.
      source_deal_id: dealId ?? undefined,
      // Include the honeypot value so the server can detect bot submissions.
      // Real human users never see / fill the hidden field.
      website_alt: honeypotRef.current?.value ?? "",
    };

    // Clear any prior-run failure state so a resubmit starts fresh.
    setFailedUploads([]);
    setUploadProgress(null);

    const res = await fetch("/api/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      setSubmitting(false);
      toast.error("Couldn't submit — please try again or email your AM.");
      return;
    }
    const { id } = (await res.json()) as { id: string };

    // Upload every staged file sequentially, surfacing progress and
    // collecting failures. We do NOT redirect to /thanks until this is
    // settled — the prior implementation whisked the user away mid-upload
    // and failures went unseen (see Camper & Nicholsons bug, Oct 2026).
    const totalFiles = logos.length + referenceFiles.length;
    const supabase = createSupabaseBrowserClient();
    const failures: Array<{ name: string; kind: "logo" | "reference" }> = [];
    let completed = 0;

    async function runBatch(files: StagedLogo[], kind: "logo" | "reference") {
      for (let i = 0; i < files.length; i++) {
        const { file } = files[i];
        setUploadProgress({ current: completed + 1, total: totalFiles, label: file.name });
        const result = await uploadOne(supabase, id, file, i, kind);
        if (!result.ok) {
          failures.push({ name: file.name, kind });
          toast.error(`Couldn't upload "${file.name}" — ${result.error}`, { duration: 10000 });
        }
        completed++;
      }
    }

    if (totalFiles > 0) {
      await runBatch(logos, "logo");
      await runBatch(referenceFiles, "reference");
    }

    setUploadProgress(null);
    setSubmitting(false);

    if (failures.length > 0) {
      // Keep the user on the form so they can see what failed and either
      // retry or copy the file list to email their AM. Scroll to top so
      // the error summary is immediately visible.
      setFailedUploads(failures);
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
      return;
    }

    router.push("/thanks");
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="panel divide-y divide-border">
      {/*
        Honeypot — visually hidden, tabindex=-1, autocomplete=off, and an
        aria-hidden label so screen readers skip it. Real humans never see
        it; bots crawling the DOM will fill it because it looks like a
        plausible "alternate website" field. Submissions with this value
        set are silently dropped by /api/intake/route.ts.
      */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", top: "auto", width: "1px", height: "1px", overflow: "hidden" }}>
        <label htmlFor="website_alt">Alternate website (leave blank)</label>
        <input
          ref={honeypotRef}
          id="website_alt"
          name="website_alt"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          defaultValue=""
        />
      </div>

      <div className="px-8 pt-10 pb-2 text-center">
        <Eyebrow>Surroundings Group</Eyebrow>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Tell us about your brand.</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Help us bring your brand to life. Fill in what you have.
        </p>
      </div>

      {/*
        Upload-failure summary. Appears only after a submit where one or more
        files failed to upload. The brand record itself is already saved at
        this point — we're just surfacing which files didn't land so the
        user can re-attach them or email their AM. Prior behavior was to
        redirect to /thanks regardless; see Camper & Nicholsons bug (Oct 2026).
      */}
      {failedUploads.length > 0 && (
        <div className="mx-8 mt-6 rounded-xl border border-destructive/40 bg-destructive/5 p-5">
          <div className="text-sm font-semibold text-destructive">
            Your brand info was saved, but {failedUploads.length} file{failedUploads.length === 1 ? "" : "s"} couldn&apos;t upload.
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-foreground">
            {failedUploads.map((f, i) => (
              <li key={i}>
                <span className="font-medium">{f.name}</span>
                <span className="text-muted-foreground"> ({f.kind})</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-muted-foreground">
            Try re-attaching them below and submitting again, or email them to your account manager at{" "}
            <a className="font-medium text-foreground underline" href="mailto:billy@surroundingsgroup.com">
              billy@surroundingsgroup.com
            </a>
            . We&apos;ll attach them to your profile on our end.
          </p>
        </div>
      )}

      <Section label="Your contact info">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>Your name *</Label>
            <Input {...register("submitter_name")} placeholder="First and last" />
            {errors.submitter_name && (
              <span className="text-xs text-destructive">{errors.submitter_name.message}</span>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Email *</Label>
            <Input type="email" {...register("submitter_email")} placeholder="you@brand.com" />
            {errors.submitter_email && (
              <span className="text-xs text-destructive">{errors.submitter_email.message}</span>
            )}
          </div>
          <div className="flex flex-col gap-1.5 md:col-span-2">
            <Label>Phone</Label>
            <Input type="tel" {...register("submitter_phone")} placeholder="305-555-0100" />
          </div>
        </div>
      </Section>

      <Section label="The basics">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>Business name *</Label>
            <Input {...register("business_name")} />
            {errors.business_name && (
              <span className="text-xs text-destructive">{errors.business_name.message}</span>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Website</Label>
            <Input {...register("website")} placeholder="yourbrand.com" />
            {errors.website && <span className="text-xs text-destructive">{errors.website.message}</span>}
          </div>
          <div className="md:col-span-2 flex flex-col gap-1.5">
            <Label>Tagline / one-liner</Label>
            <Input {...register("tagline")} placeholder="A short line that captures your brand" />
            <FieldHelper>
              Something brief we can use on lower thirds or hero text in videos (e.g. "Modern Tampa apartment living"). Skip if you don't have one yet.
            </FieldHelper>
          </div>
        </div>
      </Section>

      <Section label="About your brand">
        <div className="flex flex-col gap-1.5">
          <Label>What category fits best?</Label>
          <Select value={vertical} onValueChange={setVertical}>
            <SelectTrigger>
              <SelectValue placeholder="Pick a category" />
            </SelectTrigger>
            <SelectContent>
              {SELECTABLE_VERTICALS.map((v) => (
                <SelectItem key={v} value={v}>
                  {VERTICAL_LABELS[v]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {vertical === "other" && (
          <div className="flex flex-col gap-1.5">
            <Label>Tell us your category</Label>
            <Input {...register("vertical_other")} placeholder="e.g. Wellness studio, craft brewery, etc." />
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <Label>Client overview</Label>
          <Textarea rows={4} {...register("overview_client_raw")} placeholder="2–4 sentences" />
          <FieldHelper>
            Give us a quick snapshot of your business — what you do, who your customers are, and what makes you different from competitors. This helps our creative team understand the context behind your brand before they start building. 2–4 sentences is perfect.
          </FieldHelper>
        </div>
      </Section>

      <Section label="Look & feel">
        <div className="flex flex-col gap-1.5">
          <Label>Visual personality</Label>
          <Textarea rows={5} {...register("look_and_feel")} />
          <FieldHelper>
            How would you describe the visual personality of your brand? Think about the emotions your brand should evoke — is it clean and minimal like Apple, bold and adventurous like Red Bull, luxury coastal like a high-end resort, or dark and cinematic like a premium car brand? There are no wrong answers — just give us a feel for the world your brand lives in.
          </FieldHelper>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Inspiration references</Label>
          <Textarea rows={3} {...register("inspiration_references")} />
          <FieldHelper>
            Share any brands, creators, social media accounts, websites, or videos whose look and feel you admire — even if they're outside your industry. Links to Instagram profiles, YouTube channels, or specific posts work great here.
          </FieldHelper>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>What to avoid</Label>
          <Textarea rows={3} {...register("what_to_avoid")} />
          <FieldHelper>
            Just as important as what you love is what you don't. Are there certain styles, color palettes, editing trends, or brands whose look you want to stay away from?
          </FieldHelper>
        </div>
      </Section>

      <Section label="Audio vibe">
        <div className="flex flex-col gap-1.5">
          <Label>Music & audio direction</Label>
          <Textarea rows={4} {...register("music_notes")} />
          <FieldHelper>
            Music sets the energy for your videos. Describe the vibe in your own words (e.g. upbeat and modern, slow and cinematic, laid-back coastal) or drop a link to a song, artist, or Spotify / YouTube playlist that captures it.
          </FieldHelper>
        </div>
      </Section>

      <Section label="Audience" description="Tell us who you're speaking to. Skip anything you're not sure about.">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>Gender</Label>
            <Input placeholder="e.g. Male / Female / All" {...register("audience_gender")} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Age range</Label>
            <Input placeholder="e.g. 25 to 40" {...register("audience_age")} />
          </div>
          <div className="md:col-span-2 flex flex-col gap-1.5">
            <Label>Audience type</Label>
            <Textarea rows={3} placeholder="Describe who you're speaking to." {...register("audience_type")} />
          </div>
        </div>
      </Section>

      <Section
        label="Visual details"
        description="If you know your brand colors or fonts, share them. Otherwise leave blank — we'll extract them from your logos and assets."
      >
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Colors</Label>
          <div className="mt-2">
            <ColorsField value={colors} onChange={setColors} />
          </div>
        </div>
        <div className="pt-2">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Fonts</Label>
          <div className="mt-2">
            <FontsField value={fonts} onChange={setFonts} />
          </div>
        </div>
      </Section>

      <Section label="Logos">
        <div>
          <Label>Logo files</Label>
          <FieldHelper>
            Upload all logo variations you have — PNG, SVG, EPS, or AI. Primary, alternate, icon, and white versions are all useful.
          </FieldHelper>
          <div className="mt-3">
            <LogoUpload value={logos} onChange={setLogos} />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Or share a folder link</Label>
          <Input placeholder="dropbox.com/scl/fo/… or Google Drive link" {...register("client_asset_folder_url")} />
          <FieldHelper>
            Prefer to share a folder instead of uploading? Drop your Dropbox or Google Drive link here.
          </FieldHelper>
          {errors.client_asset_folder_url && (
            <span className="text-xs text-destructive">{errors.client_asset_folder_url.message}</span>
          )}
        </div>
      </Section>

      <Section label="Anything else">
        <div>
          <Label>Additional resources</Label>
          <FieldHelper>
            Existing brand guidelines, decks, photos, videos, documents — anything else that helps us understand your brand. PDF works great if your current guidelines are already in a doc.
          </FieldHelper>
          <div className="mt-3">
            <LogoUpload
              value={referenceFiles}
              onChange={setReferenceFiles}
              accept={REFERENCE_UPLOAD_DEFAULTS.accept}
              placeholder={REFERENCE_UPLOAD_DEFAULTS.placeholder}
              helper={REFERENCE_UPLOAD_DEFAULTS.helper}
            />
          </div>
        </div>
      </Section>

      <Section label="Social">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>Instagram</Label>
            <Input placeholder="@handle" {...register("instagram")} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Facebook</Label>
            <Input {...register("facebook")} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>YouTube</Label>
            <Input {...register("youtube")} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>TikTok</Label>
            <Input {...register("tiktok")} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>LinkedIn</Label>
            <Input {...register("linkedin")} />
          </div>
        </div>
      </Section>

      <div className="flex flex-col items-center gap-2 px-8 py-10">
        <Button type="submit" size="lg" disabled={submitting} className="w-full md:w-auto">
          {uploadProgress
            ? `Uploading ${uploadProgress.current} of ${uploadProgress.total}…`
            : submitting
              ? "Submitting…"
              : failedUploads.length > 0
                ? "Retry submission"
                : "Submit brand intake"}
        </Button>
        {uploadProgress && (
          <p className="max-w-[32ch] truncate text-xs text-muted-foreground">
            {uploadProgress.label}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          By submitting you agree to let the SG team contact you to finalize your brand profile.
        </p>
      </div>
    </form>
  );
}
