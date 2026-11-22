// Resources — company handbook, SOPs, Canva templates, brand kit,
// sales assets. Scaffolded for now; content shipping in a later pass
// once the resource shape is agreed (links + titles + categories).

import { BookOpen } from "lucide-react";
import { PageContainer } from "@/components/shell/page-container";

export default function ResourcesPage() {
  return (
    <PageContainer>
      <header className="mb-8 border-b border-border/70 pb-6">
        <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          My Surroundings · Resources
        </div>
        <h1 className="mt-1.5 text-3xl font-semibold tracking-tight text-foreground md:text-[2.25rem]">
          Resources
        </h1>
      </header>

      <div className="rounded-xl border border-dashed border-border bg-panel/50 p-10 text-center">
        <BookOpen className="mx-auto h-5 w-5 text-muted-foreground/70" />
        <h2 className="mt-3 text-sm font-semibold tracking-tight">Coming next pass</h2>
        <p className="mt-1.5 max-w-prose mx-auto text-[12.5px] leading-relaxed text-muted-foreground">
          Handbook, SOPs, Canva templates, brand kit, sales assets, and anything else the team needs on-hand. Grouped by category, searchable, linkable.
        </p>
      </div>
    </PageContainer>
  );
}
