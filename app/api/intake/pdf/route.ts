// Serves the fillable fallback version of the public intake form.
//
// Public, no auth. Built because some clients' corporate email filters
// strip the Brand Hub link; this PDF has real interactive AcroForm fields
// so the client can download, type their answers directly in Preview/
// Adobe/Chrome, save, and email the completed form back.
//
// Rendered by lib/pdf/intake-form.ts using pdf-lib (not react-pdf), since
// pdf-lib has native AcroForm field support that react-pdf lacks.

import { generateIntakeFormPdf } from "@/lib/pdf/intake-form";

// Cache for a day — the form only changes on deploy. Generating it is a
// few hundred ms per hit so a long cache-control header is worth it.
const CACHE_SECONDS = 60 * 60 * 24;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const download = url.searchParams.get("download") === "1";

  const bytes = await generateIntakeFormPdf();

  return new Response(bytes as unknown as ArrayBuffer, {
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
