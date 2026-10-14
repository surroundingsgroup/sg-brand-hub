// Serves the printable fallback version of the public intake form as a PDF.
// Public — no auth required. Shipped because some corporate email filters
// block the Brand Hub link; clients can download this, fill it out in
// Preview/Adobe or by hand, then email the completed form back.
//
// The form content is in components/pdf/intake-form-pdf.tsx so the single
// source of truth for intake questions is the React PDF component.

import { renderToBuffer } from "@react-pdf/renderer";
import { IntakeFormPdf } from "@/components/pdf/intake-form-pdf";

// Cache for a day — the form only changes when we deploy, and generating
// it is a few hundred ms per hit. A long cache-control header is fine.
const CACHE_SECONDS = 60 * 60 * 24;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const download = url.searchParams.get("download") === "1";

  const buffer = await renderToBuffer(IntakeFormPdf());

  return new Response(buffer as unknown as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": download
        ? `attachment; filename="surroundings-group-brand-intake.pdf"`
        : `inline; filename="surroundings-group-brand-intake.pdf"`,
      "Cache-Control": `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}`,
    },
  });
}
