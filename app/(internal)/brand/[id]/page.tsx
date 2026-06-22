import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, FileText, Eye, Check } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageContainer } from "@/components/shell/page-container";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { StatusEditor } from "@/components/brand/status-editor";
import { FormSection, FieldGrid } from "@/components/brand/section";
import { EditableField } from "@/components/brand/editable-field";
import { EditableSelect } from "@/components/brand/editable-select";
import { ColorsEditor } from "@/components/brand/colors-editor";
import { FontsEditor } from "@/components/brand/fonts-editor";
import { LogosEditor } from "@/components/brand/logos-editor";
import { ApproveButton } from "@/components/brand/approve-button";
import { ApprovalChecklist } from "@/components/brand/approval-checklist";
import { buildApprovalChecklist, isReadyToApprove } from "@/lib/brands/approval-readiness";
import { PdfLinkField } from "@/components/brand/pdf-link-field";
import { ShareLinkButton } from "@/components/brand/share-link-button";
import { DeleteBrandButton } from "@/components/brand/delete-brand-button";
import { RequestVideoAssetsButton } from "@/components/brand/request-video-assets-button";
import { updateBrand, deleteLogo, reorderLogos } from "./actions";
import { VERTICAL_LABELS, ENGAGEMENT_LABELS, type Brand, type BrandLogo, type BrandActivityLog } from "@/types/brand";
import { formatRelativeDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function BrandDetailPage({ params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const [{ data: brand }, { data: logos }, { data: activity }] = await Promise.all([
    supabase.from("brands").select("*").eq("id", params.id).single(),
    supabase.from("brand_logos").select("*").eq("brand_id", params.id).order("display_order"),
    supabase.from("brand_activity_log").select("*").eq("brand_id", params.id).order("created_at", { ascending: false }).limit(50),
  ]);

  if (!brand) notFound();
  const b = brand as Brand;
  const brandLogos = (logos ?? []) as BrandLogo[];
  const activityLog = (activity ?? []) as BrandActivityLog[];

  // Pre-approve gating. We show the checklist on the page so the AM always
  // knows what's missing; the Approve button blocks until the required items
  // are satisfied.
  const checklist = buildApprovalChecklist(b, brandLogos);
  const ready = isReadyToApprove(b, brandLogos);
  const blockedReason = ready
    ? undefined
    : `Missing required: ${checklist.required.filter((i) => !i.done).map((i) => i.label).join(", ")}`;

  const verticalOptions = [
    "marine",
    "private_aviation",
    "automotive",
    "real_estate",
    "real_estate_development",
    "multifamily_residential",
    "resort_travel",
    "home_services",
    "other",
  ].map((value) => ({ value, label: VERTICAL_LABELS[value as keyof typeof VERTICAL_LABELS] }));

  return (
    <PageContainer>
      <div className="mb-6">
        <Button variant="outline" size="sm" asChild>
          <Link href="/dashboard">
            <ChevronLeft className="h-4 w-4" />
            Back
          </Link>
        </Button>
      </div>

      <div className="mb-8 flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{b.business_name}</h1>
            <StatusEditor brandId={b.id} status={b.status} />
          </div>
          {b.source_deal_url && (
            <a
              href={b.source_deal_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            >
              🤝 From Monday deal — open deal record →
            </a>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ShareLinkButton shareToken={b.share_token} />
          <Button variant="outline" asChild>
            <Link href={`/api/brands/${b.id}/pdf`} target="_blank">
              <Eye className="h-4 w-4" />
              Preview PDF
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href={`/api/brands/${b.id}/pdf?download=1`}>
              <FileText className="h-4 w-4" />
              Download
            </Link>
          </Button>
          <DeleteBrandButton brandId={b.id} brandName={b.business_name} />
          {b.status === "approved" && (
            <RequestVideoAssetsButton brandId={b.id} brandName={b.business_name} />
          )}
          {b.status !== "approved" && (
            <ApproveButton brandId={b.id} disabled={!ready} disabledReason={blockedReason} />
          )}
        </div>
      </div>

      {/* Approval checklist — hidden once brand is approved. */}
      {b.status !== "approved" && (
        <div className="mb-8">
          <ApprovalChecklist
            required={checklist.required}
            recommended={checklist.recommended}
            allRequiredDone={ready}
          />
        </div>
      )}

      <Tabs defaultValue="overview">
        <TabsList className="border-b border-border">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="voice">Voice & Audience</TabsTrigger>
          <TabsTrigger value="visual">Visual Identity</TabsTrigger>
          <TabsTrigger value="logos">Logos</TabsTrigger>
          <TabsTrigger value="creative">Creative Direction</TabsTrigger>
          <TabsTrigger value="notes">Internal Notes</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="panel divide-y divide-border px-6">
            <FormSection label="Submitter" description="Who filled out the intake form.">
              <FieldGrid>
                <EditableField label="Name" field="submitter_name" initialValue={b.submitter_name ?? ""} brandId={b.id} onSave={updateBrand} />
                <EditableField label="Email" field="submitter_email" initialValue={b.submitter_email ?? ""} brandId={b.id} onSave={updateBrand} />
                <EditableField label="Phone" field="submitter_phone" initialValue={b.submitter_phone ?? ""} brandId={b.id} onSave={updateBrand} />
              </FieldGrid>
            </FormSection>

            <FormSection label="The Basics">
              <FieldGrid>
                <EditableField label="Business name" field="business_name" initialValue={b.business_name} brandId={b.id} onSave={updateBrand} />
                <EditableField label="Website" field="website" type="url" initialValue={b.website ?? ""} brandId={b.id} onSave={updateBrand} placeholder="https://" />
                <EditableField label="Tagline" field="tagline" initialValue={b.tagline ?? ""} brandId={b.id} onSave={updateBrand} className="md:col-span-2" />
                <EditableSelect label="Vertical" field="vertical" initialValue={b.vertical} brandId={b.id} options={verticalOptions} onSave={updateBrand} />
                {b.vertical === "other" && (
                  <EditableField label="Vertical (other)" field="vertical_other" initialValue={b.vertical_other ?? ""} brandId={b.id} onSave={updateBrand} />
                )}
                <EditableField label="Account manager (SG)" field="account_manager" initialValue={b.account_manager ?? ""} brandId={b.id} onSave={updateBrand} placeholder="e.g. Billy Pavlock" />
                <EditableSelect
                  label="Engagement type"
                  field="engagement_type"
                  initialValue={b.engagement_type}
                  brandId={b.id}
                  options={Object.entries(ENGAGEMENT_LABELS).map(([value, label]) => ({ value, label }))}
                  onSave={updateBrand}
                />
                <EditableField label="Client asset folder (from intake)" field="client_asset_folder_url" type="url" initialValue={b.client_asset_folder_url ?? ""} brandId={b.id} onSave={updateBrand} placeholder="https://" className="md:col-span-2" />
              </FieldGrid>
            </FormSection>

            <FormSection label="Deliverables & Links" description="Where everything lives once this brand ships. Some fields auto-fill on approval.">
              <FieldGrid>
                <PdfLinkField brand={b} className="md:col-span-2" />
                <EditableField label="Parent Dropbox folder" field="dropbox_folder_url" type="url" initialValue={b.dropbox_folder_url ?? ""} brandId={b.id} onSave={updateBrand} placeholder="https://" />
                <EditableField label="Monday client board" field="client_monday_board_url" type="url" initialValue={b.client_monday_board_url ?? ""} brandId={b.id} onSave={updateBrand} placeholder="https://" />
              </FieldGrid>
            </FormSection>

            <FormSection label="Brand Overview">
              <FieldGrid className="md:grid-cols-1">
                <EditableField label="Client raw overview (from intake)" field="overview_client_raw" multiline initialValue={b.overview_client_raw ?? ""} brandId={b.id} onSave={updateBrand} />
                <EditableField label="Polished overview (used in PDF)" field="overview_polished" multiline initialValue={b.overview_polished ?? ""} brandId={b.id} onSave={updateBrand} />
              </FieldGrid>
            </FormSection>

            <FormSection label="Social">
              <FieldGrid>
                <EditableField label="Instagram" field="instagram" initialValue={b.instagram ?? ""} brandId={b.id} onSave={updateBrand} placeholder="@handle" />
                <EditableField label="Facebook" field="facebook" initialValue={b.facebook ?? ""} brandId={b.id} onSave={updateBrand} />
                <EditableField label="YouTube" field="youtube" initialValue={b.youtube ?? ""} brandId={b.id} onSave={updateBrand} />
                <EditableField label="TikTok" field="tiktok" initialValue={b.tiktok ?? ""} brandId={b.id} onSave={updateBrand} />
                <EditableField label="LinkedIn" field="linkedin" initialValue={b.linkedin ?? ""} brandId={b.id} onSave={updateBrand} />
              </FieldGrid>
            </FormSection>
          </div>
        </TabsContent>

        <TabsContent value="voice">
          <div className="panel divide-y divide-border px-6">
            <FormSection label="Brand Voice">
              <FieldGrid className="md:grid-cols-1">
                <EditableField label="Tone & personality" field="brand_voice" multiline initialValue={b.brand_voice ?? ""} brandId={b.id} onSave={updateBrand} />
                <EditableField label="Look & feel" field="look_and_feel" multiline initialValue={b.look_and_feel ?? ""} brandId={b.id} onSave={updateBrand} />
                <EditableField label="What to avoid" field="what_to_avoid" multiline initialValue={b.what_to_avoid ?? ""} brandId={b.id} onSave={updateBrand} />
                <EditableField label="Inspiration references" field="inspiration_references" multiline initialValue={b.inspiration_references ?? ""} brandId={b.id} onSave={updateBrand} />
              </FieldGrid>
            </FormSection>
            <FormSection label="Target Audience">
              <FieldGrid>
                <EditableField label="Gender" field="audience_gender" initialValue={b.audience_gender ?? ""} brandId={b.id} onSave={updateBrand} />
                <EditableField label="Age range" field="audience_age" initialValue={b.audience_age ?? ""} brandId={b.id} onSave={updateBrand} />
                <EditableField label="Type" field="audience_type" multiline initialValue={b.audience_type ?? ""} brandId={b.id} onSave={updateBrand} className="md:col-span-2" />
              </FieldGrid>
            </FormSection>
          </div>
        </TabsContent>

        <TabsContent value="visual">
          <div className="panel divide-y divide-border px-6">
            <FormSection label="Brand Colors">
              <ColorsEditor brandId={b.id} initial={b.colors ?? []} onSave={updateBrand} />
            </FormSection>
            <FormSection label="Typography">
              <FontsEditor brandId={b.id} initial={b.fonts ?? []} onSave={updateBrand} />
            </FormSection>
          </div>
        </TabsContent>

        <TabsContent value="logos">
          <div className="panel px-6 py-6">
            <FormSection label="Logo Variations" className="py-0">
              <LogosEditor brandId={b.id} initial={brandLogos} onDelete={deleteLogo} onReorder={reorderLogos} />
            </FormSection>
          </div>
        </TabsContent>

        <TabsContent value="creative">
          <div className="panel divide-y divide-border px-6">
            <FormSection label="Production Direction">
              <FieldGrid className="md:grid-cols-1">
                <EditableField label="Coloring tone" field="coloring_tone" multiline initialValue={b.coloring_tone ?? ""} brandId={b.id} onSave={updateBrand} />
                <EditableField label="Music notes" field="music_notes" multiline initialValue={b.music_notes ?? ""} brandId={b.id} onSave={updateBrand} />
              </FieldGrid>
            </FormSection>
          </div>
        </TabsContent>

        <TabsContent value="notes">
          <div className="panel px-6 py-6">
            <FormSection label="Internal Notes" className="py-0" description="Visible to the SG team only — never appears in the client-facing PDF.">
              <EditableField label="" field="internal_notes" multiline initialValue={b.internal_notes ?? ""} brandId={b.id} onSave={updateBrand} />
            </FormSection>
          </div>
        </TabsContent>

        <TabsContent value="activity">
          <div className="panel px-6 py-6">
            <FormSection label="Activity Log" className="py-0">
              {activityLog.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {activityLog.map((event) => (
                    <li key={event.id} className="flex items-center justify-between py-3 text-sm">
                      <span className="font-medium">{event.event_type.replaceAll("_", " ")}</span>
                      <span className="text-xs text-muted-foreground">{formatRelativeDate(event.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </FormSection>
          </div>
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
