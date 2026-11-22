import { PageContainer, PageHeader } from "@/components/shell/page-container";
import { InfoBanner } from "@/components/ui/info-banner";
import { ImportUploader } from "./import-uploader";

export const metadata = { title: "Bulk import — Hub" };

export default function ImportPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Bulk import"
        description="Drop legacy brand guideline PDFs. Claude reads each one and creates a draft brand record for you to review."
      />

      <div className="mb-6">
        <InfoBanner>
          About 85% of fields auto-fill. URLs on social/link buttons usually need manual fixup since they're embedded as PDF link annotations rather than visible text. Each imported brand lands as <strong>In Review</strong> in the dashboard so you can verify before approving.
        </InfoBanner>
      </div>

      <ImportUploader />
    </PageContainer>
  );
}
