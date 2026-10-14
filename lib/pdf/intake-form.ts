// Printable + fillable fallback for the public intake form.
//
// Built with pdf-lib (not @react-pdf/renderer) because we need REAL
// AcroForm fields the client can type into in Preview/Adobe/Chrome
// without needing an annotation tool. react-pdf only draws decorative
// boxes/lines — the earlier version of this PDF forced clients into
// annotation mode, which some older PDF viewers don't support cleanly.
//
// Shipped because some corporate email filters strip the /intake link;
// clients can download this PDF, fill it in-app, and email it back.
//
// All fields are standard AcroForm text fields with sensible defaults
// (border on, light gray background on hover) so they're obviously
// clickable. Multi-line fields have multiline enabled so long answers
// don't truncate.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/**
 * Standard Helvetica (what we embed below) only encodes WinAnsi — basic
 * Latin plus a few Latin-1 extras. Modern typographic glyphs like en/em
 * dashes, bullets, arrows, and ellipses all crash the encoder.
 *
 * We swap them for ASCII-safe equivalents instead of embedding a
 * Unicode-capable TTF, which would add ~250KB per page load. The
 * replacements preserve meaning without the typographic polish.
 */
function sanitize(s: string): string {
  return s
    .replace(/→/g, "->") // → right arrow
    .replace(/←/g, "<-") // ← left arrow
    .replace(/•/g, "*") // •
    .replace(/–/g, "-") // – en-dash
    .replace(/—/g, "--") // — em-dash
    .replace(/…/g, "...") // …
    .replace(/[‘’]/g, "'") // ' '
    .replace(/[“”]/g, '"') // " "
    .replace(/ /g, " "); // non-breaking space -> regular
}

// Letter size, points. Origin is BOTTOM-LEFT in PDF coordinate space.
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 50;
const CONTENT_W = PAGE_W - MARGIN * 2;

const INK = rgb(0.07, 0.07, 0.07);
const SOFT_INK = rgb(0.23, 0.22, 0.2);
const MUTED = rgb(0.54, 0.52, 0.5);
const LINE = rgb(0.83, 0.82, 0.79);
const SG_GREEN = rgb(0.16, 0.23, 0.16);
const SOFT_BG = rgb(0.98, 0.97, 0.95);
const INPUT_BG = rgb(0.985, 0.98, 0.97);

type Fonts = {
  regular: Awaited<ReturnType<PDFDocument["embedFont"]>>;
  bold: Awaited<ReturnType<PDFDocument["embedFont"]>>;
};

/**
 * Mutable cursor so we can write top-to-bottom and auto-break pages.
 * Everything positions in PDF coordinates (origin bottom-left) but we
 * work in "top-down" terms via y = cursor.
 */
type Doc = {
  pdf: PDFDocument;
  fonts: Fonts;
  pages: Array<ReturnType<PDFDocument["addPage"]>>;
  current: ReturnType<PDFDocument["addPage"]>;
  // y measured as distance from the page top (so moving "down" means
  // y increases).
  y: number;
  // Monotonic counter for unique AcroForm field names — PDF requires it.
  fieldCounter: number;
};

function newPage(doc: Doc) {
  const p = doc.pdf.addPage([PAGE_W, PAGE_H]);
  doc.pages.push(p);
  doc.current = p;
  doc.y = MARGIN;
}

function ensureSpace(doc: Doc, needed: number) {
  if (doc.y + needed > PAGE_H - MARGIN - 20) {
    newPage(doc);
  }
}

function toPdfY(doc: Doc, topY: number): number {
  // Translate top-down y to PDF bottom-up y.
  return PAGE_H - topY;
}

function drawText(
  doc: Doc,
  text: string,
  opts: {
    size?: number;
    bold?: boolean;
    color?: ReturnType<typeof rgb>;
    x?: number;
    maxWidth?: number;
    lineHeight?: number;
  } = {}
) {
  const size = opts.size ?? 10;
  const font = opts.bold ? doc.fonts.bold : doc.fonts.regular;
  const color = opts.color ?? INK;
  const x = opts.x ?? MARGIN;
  const maxWidth = opts.maxWidth ?? CONTENT_W;
  const lineHeight = opts.lineHeight ?? size * 1.4;

  const lines = wrapText(sanitize(text), font, size, maxWidth);
  for (const line of lines) {
    ensureSpace(doc, lineHeight);
    doc.current.drawText(line, {
      x,
      y: toPdfY(doc, doc.y + size),
      size,
      font,
      color,
    });
    doc.y += lineHeight;
  }
}

function wrapText(
  text: string,
  font: Fonts["regular"],
  size: number,
  maxWidth: number
): string[] {
  // Sanitize here (not just in drawText) because some callers — e.g.
  // instructionBox measuring bullet widths — call wrapText directly for
  // layout math. If we only sanitized in drawText, the WinAnsi encoder
  // would still throw during measurement before any draw happened.
  const paragraphs = sanitize(text).split("\n");
  const out: string[] = [];
  for (const para of paragraphs) {
    if (para.trim() === "") {
      out.push("");
      continue;
    }
    const words = para.split(" ");
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      const w = font.widthOfTextAtSize(candidate, size);
      if (w > maxWidth && line) {
        out.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

function hRule(doc: Doc, extraTopGap = 4, extraBottomGap = 10) {
  doc.y += extraTopGap;
  ensureSpace(doc, 1 + extraBottomGap);
  doc.current.drawLine({
    start: { x: MARGIN, y: toPdfY(doc, doc.y) },
    end: { x: PAGE_W - MARGIN, y: toPdfY(doc, doc.y) },
    thickness: 0.75,
    color: LINE,
  });
  doc.y += extraBottomGap;
}

function sectionLabel(doc: Doc, text: string) {
  doc.y += 10;
  drawText(doc, text.toUpperCase(), {
    size: 8,
    bold: true,
    color: MUTED,
  });
  doc.y += 2;
}

function fieldLabel(doc: Doc, text: string, required = false) {
  drawText(doc, required ? `${text} *` : text, {
    size: 9,
    bold: true,
    color: SOFT_INK,
  });
  doc.y += 2;
}

function helper(doc: Doc, text: string) {
  drawText(doc, text, { size: 8.5, color: MUTED, lineHeight: 11 });
  doc.y += 2;
}

function nextFieldName(doc: Doc, base: string): string {
  doc.fieldCounter += 1;
  return `${base}_${doc.fieldCounter}`;
}

/**
 * Add an interactive text input to the page at the current cursor.
 * Advances the cursor down by `height + gap`.
 */
function textField(
  doc: Doc,
  opts: {
    name: string;
    height?: number;
    multiline?: boolean;
    width?: number;
    gap?: number;
  }
) {
  const height = opts.height ?? 20;
  const width = opts.width ?? CONTENT_W;
  const gap = opts.gap ?? 10;
  ensureSpace(doc, height + gap);

  const form = doc.pdf.getForm();
  const field = form.createTextField(nextFieldName(doc, opts.name));
  if (opts.multiline) field.enableMultiline();
  field.setFontSize(10);
  field.addToPage(doc.current, {
    x: MARGIN,
    y: toPdfY(doc, doc.y + height),
    width,
    height,
    borderWidth: 0.5,
    borderColor: LINE,
    backgroundColor: INPUT_BG,
    textColor: INK,
  });
  doc.y += height + gap;
}

/**
 * Two text fields side-by-side on one row (half-width each).
 */
function twoFields(
  doc: Doc,
  left: { label: string; name: string; required?: boolean; helper?: string },
  right: { label: string; name: string; required?: boolean; helper?: string }
) {
  const colW = (CONTENT_W - 14) / 2;
  const startY = doc.y;

  // Left label
  drawText(doc, left.required ? `${left.label} *` : left.label, {
    size: 9,
    bold: true,
    color: SOFT_INK,
    maxWidth: colW,
  });
  const afterLeftLabelY = doc.y;

  // Right label (same baseline)
  doc.y = startY;
  drawText(doc, right.required ? `${right.label} *` : right.label, {
    size: 9,
    bold: true,
    color: SOFT_INK,
    x: MARGIN + colW + 14,
    maxWidth: colW,
  });
  const afterRightLabelY = doc.y;

  doc.y = Math.max(afterLeftLabelY, afterRightLabelY) + 2;

  // Helpers (if any) under each label
  const beforeHelperY = doc.y;
  if (left.helper) {
    drawText(doc, left.helper, { size: 8.5, color: MUTED, maxWidth: colW, lineHeight: 11 });
  }
  const afterLeftHelperY = doc.y;
  doc.y = beforeHelperY;
  if (right.helper) {
    drawText(doc, right.helper, {
      size: 8.5,
      color: MUTED,
      x: MARGIN + colW + 14,
      maxWidth: colW,
      lineHeight: 11,
    });
  }
  doc.y = Math.max(afterLeftHelperY, doc.y) + 2;

  // Two input fields side-by-side
  const height = 20;
  ensureSpace(doc, height + 10);
  const form = doc.pdf.getForm();

  const leftField = form.createTextField(nextFieldName(doc, left.name));
  leftField.setFontSize(10);
  leftField.addToPage(doc.current, {
    x: MARGIN,
    y: toPdfY(doc, doc.y + height),
    width: colW,
    height,
    borderWidth: 0.5,
    borderColor: LINE,
    backgroundColor: INPUT_BG,
    textColor: INK,
  });

  const rightField = form.createTextField(nextFieldName(doc, right.name));
  rightField.setFontSize(10);
  rightField.addToPage(doc.current, {
    x: MARGIN + colW + 14,
    y: toPdfY(doc, doc.y + height),
    width: colW,
    height,
    borderWidth: 0.5,
    borderColor: LINE,
    backgroundColor: INPUT_BG,
    textColor: INK,
  });

  doc.y += height + 10;
}

function instructionBox(
  doc: Doc,
  title: string,
  body: string,
  bullets?: string[],
  closing?: string
) {
  const boxX = MARGIN;
  const padding = 10;
  const innerW = CONTENT_W - padding * 2;

  // Measure content height first
  const titleH = 14;
  const bodyLines = wrapText(body, doc.fonts.regular, 9.5, innerW);
  const bodyH = bodyLines.length * 13;
  const bulletLines = (bullets || []).flatMap((b) =>
    wrapText(`• ${b}`, doc.fonts.regular, 9.5, innerW - 8)
  );
  const bulletH = bulletLines.length * 13 + (bullets?.length ? 4 : 0);
  const closingLines = closing ? wrapText(closing, doc.fonts.regular, 9.5, innerW) : [];
  const closingH = closingLines.length * 13 + (closing ? 6 : 0);
  const boxH = padding + titleH + 4 + bodyH + bulletH + closingH + padding;

  ensureSpace(doc, boxH + 10);
  const boxTop = doc.y;

  // Background
  doc.current.drawRectangle({
    x: boxX,
    y: toPdfY(doc, boxTop + boxH),
    width: CONTENT_W,
    height: boxH,
    color: SOFT_BG,
    borderWidth: 0,
  });
  // Left accent bar
  doc.current.drawRectangle({
    x: boxX,
    y: toPdfY(doc, boxTop + boxH),
    width: 3,
    height: boxH,
    color: SG_GREEN,
    borderWidth: 0,
  });

  // Content inside box
  doc.y = boxTop + padding;
  drawText(doc, title, {
    size: 10,
    bold: true,
    color: INK,
    x: MARGIN + padding,
    maxWidth: innerW,
  });
  doc.y += 2;
  drawText(doc, body, {
    size: 9.5,
    color: SOFT_INK,
    x: MARGIN + padding,
    maxWidth: innerW,
    lineHeight: 13,
  });
  if (bullets && bullets.length) {
    doc.y += 2;
    for (const b of bullets) {
      drawText(doc, `• ${b}`, {
        size: 9.5,
        color: SOFT_INK,
        x: MARGIN + padding + 2,
        maxWidth: innerW - 2,
        lineHeight: 13,
      });
    }
  }
  if (closing) {
    doc.y += 4;
    drawText(doc, closing, {
      size: 9.5,
      color: SOFT_INK,
      x: MARGIN + padding,
      maxWidth: innerW,
      lineHeight: 13,
    });
  }

  // Snap cursor to just below the box (handle any undercount).
  doc.y = Math.max(doc.y, boxTop + boxH) + 12;
}

/**
 * Simple column table for colors/fonts — label row + N input rows, each
 * row having M text fields side-by-side. Named base + row + col so each
 * cell is a unique AcroForm field.
 */
function fieldTable(
  doc: Doc,
  baseName: string,
  headers: string[],
  colWeights: number[],
  rows: number,
  rowHeight = 22
) {
  const totalWeight = colWeights.reduce((a, b) => a + b, 0);
  const gap = 6;
  const totalGap = gap * (headers.length - 1);
  const unit = (CONTENT_W - totalGap) / totalWeight;
  const colWidths = colWeights.map((w) => w * unit);

  // Header row
  ensureSpace(doc, 18 + rows * (rowHeight + 4));
  const headerY = doc.y;
  let xCursor = MARGIN;
  for (let i = 0; i < headers.length; i++) {
    doc.current.drawText(sanitize(headers[i]).toUpperCase(), {
      x: xCursor,
      y: toPdfY(doc, headerY + 10),
      size: 7.5,
      font: doc.fonts.bold,
      color: SOFT_INK,
    });
    xCursor += colWidths[i] + gap;
  }
  doc.y = headerY + 12;
  doc.current.drawLine({
    start: { x: MARGIN, y: toPdfY(doc, doc.y) },
    end: { x: PAGE_W - MARGIN, y: toPdfY(doc, doc.y) },
    thickness: 0.5,
    color: INK,
  });
  doc.y += 6;

  // Data rows
  const form = doc.pdf.getForm();
  for (let r = 0; r < rows; r++) {
    ensureSpace(doc, rowHeight + 4);
    xCursor = MARGIN;
    for (let c = 0; c < headers.length; c++) {
      const field = form.createTextField(
        nextFieldName(doc, `${baseName}_r${r}_c${c}`)
      );
      field.setFontSize(10);
      field.addToPage(doc.current, {
        x: xCursor,
        y: toPdfY(doc, doc.y + rowHeight),
        width: colWidths[c],
        height: rowHeight,
        borderWidth: 0.5,
        borderColor: LINE,
        backgroundColor: INPUT_BG,
        textColor: INK,
      });
      xCursor += colWidths[c] + gap;
    }
    doc.y += rowHeight + 4;
  }
}

function pageFooter(doc: Doc) {
  // Draw footer on every page at the end — iterate pages and stamp.
  for (let i = 0; i < doc.pages.length; i++) {
    const p = doc.pages[i];
    p.drawLine({
      start: { x: MARGIN, y: MARGIN + 12 },
      end: { x: PAGE_W - MARGIN, y: MARGIN + 12 },
      thickness: 0.5,
      color: LINE,
    });
    p.drawText(sanitize("Surroundings Group · Brand Intake"), {
      x: MARGIN,
      y: MARGIN,
      size: 8,
      font: doc.fonts.regular,
      color: MUTED,
    });
    const pageLabel = `Page ${i + 1} of ${doc.pages.length}`;
    const w = doc.fonts.regular.widthOfTextAtSize(pageLabel, 8);
    p.drawText(pageLabel, {
      x: PAGE_W - MARGIN - w,
      y: MARGIN,
      size: 8,
      font: doc.fonts.regular,
      color: MUTED,
    });
  }
}

export async function generateIntakeFormPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Surroundings Group — Brand Intake Form");
  pdf.setAuthor("Surroundings Group");
  pdf.setSubject("Fillable brand intake form");

  const fonts: Fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };

  const doc: Doc = {
    pdf,
    fonts,
    pages: [],
    current: pdf.addPage([PAGE_W, PAGE_H]),
    y: MARGIN,
    fieldCounter: 0,
  };
  doc.pages.push(doc.current);

  // ─── HEADER ───
  drawText(doc, "SURROUNDINGS GROUP", { size: 8, bold: true, color: MUTED });
  doc.y += 4;
  drawText(doc, "Brand intake form", { size: 26, bold: true, color: INK });
  doc.y += 4;
  drawText(
    doc,
    "Help us bring your brand to life. Fill in whatever you have — skip anything you're not sure about.",
    { size: 10, color: SOFT_INK, maxWidth: 420 }
  );
  hRule(doc, 10, 14);

  // ─── INSTRUCTIONS ───
  instructionBox(
    doc,
    "How to submit this form",
    "This is the fillable version of our online intake form, in case the online link can't get through your email filters. The fields below are interactive — just click into any field and start typing (works in Preview, Adobe Reader, Chrome, or any modern PDF viewer).",
    [
      "Fill out the fields on your screen — no printing or scanning needed.",
      "Save the file when you're done (File → Save, or File → Export in Preview).",
      "Email the saved PDF plus your logo files to billy@surroundingsgroup.com.",
    ],
    "If you'd rather print and hand-fill, that works too — just scan or photograph each page when you're done."
  );

  // ─── CONTACT INFO ───
  sectionLabel(doc, "Your contact info");
  twoFields(
    doc,
    { label: "Your name", name: "submitter_name", required: true },
    { label: "Email", name: "submitter_email", required: true }
  );
  fieldLabel(doc, "Phone");
  textField(doc, { name: "submitter_phone" });

  // ─── BASICS ───
  sectionLabel(doc, "The basics");
  twoFields(
    doc,
    { label: "Business name", name: "business_name", required: true },
    { label: "Website", name: "website" }
  );
  fieldLabel(doc, "Tagline / one-liner");
  helper(
    doc,
    "A short line we can use on lower thirds or hero text in videos (e.g. \"Modern Tampa apartment living\"). Skip if you don't have one."
  );
  textField(doc, { name: "tagline" });
  fieldLabel(doc, "Category / industry");
  helper(
    doc,
    "Marine · Private aviation · Automotive · Real estate · Multifamily residential · Resort & travel · Home services · Other"
  );
  textField(doc, { name: "vertical" });

  // ─── OVERVIEW ───
  sectionLabel(doc, "About your brand");
  fieldLabel(doc, "Client overview");
  helper(
    doc,
    "2–4 sentences: what you do, who your customers are, and what makes you different from competitors."
  );
  textField(doc, { name: "overview_client_raw", height: 72, multiline: true });

  // ─── LOOK & FEEL ───
  sectionLabel(doc, "Look & feel");
  fieldLabel(doc, "Visual personality");
  helper(
    doc,
    "How would you describe the visual personality of your brand? Is it clean and minimal like Apple, bold and adventurous like Red Bull, luxury coastal like a high-end resort, dark and cinematic like a premium car brand? There are no wrong answers."
  );
  textField(doc, { name: "look_and_feel", height: 80, multiline: true });

  fieldLabel(doc, "Inspiration references");
  helper(
    doc,
    "Brands, creators, social accounts, websites, videos whose look and feel you admire — even if they're outside your industry. Links or @handles welcome."
  );
  textField(doc, { name: "inspiration_references", height: 68, multiline: true });

  fieldLabel(doc, "What to avoid");
  helper(
    doc,
    "Styles, color palettes, editing trends, or brands whose look you want to stay away from."
  );
  textField(doc, { name: "what_to_avoid", height: 60, multiline: true });

  // ─── AUDIO ───
  sectionLabel(doc, "Audio vibe");
  fieldLabel(doc, "Music & audio direction");
  helper(
    doc,
    "Describe the vibe (upbeat and modern, slow and cinematic, laid-back coastal) or drop a link to a song, artist, or Spotify/YouTube playlist that captures it."
  );
  textField(doc, { name: "music_notes", height: 60, multiline: true });

  // ─── AUDIENCE ───
  sectionLabel(doc, "Audience");
  twoFields(
    doc,
    { label: "Gender", name: "audience_gender", helper: "e.g. Male / Female / All" },
    { label: "Age range", name: "audience_age", helper: "e.g. 25 to 40" }
  );
  fieldLabel(doc, "Audience type");
  helper(
    doc,
    "Who are you speaking to? Buyers, renters, enthusiasts, decision-makers, etc."
  );
  textField(doc, { name: "audience_type", height: 50, multiline: true });

  // ─── COLORS TABLE ───
  sectionLabel(doc, "Brand colors");
  helper(
    doc,
    "If you know your brand colors, list them here. Otherwise leave blank — we'll extract them from your logos."
  );
  fieldTable(
    doc,
    "color",
    ["Name", "Hex (e.g. #1A2B3C)", "Role (Primary / Secondary)"],
    [2, 1.4, 1.6],
    4
  );

  // ─── FONTS TABLE ───
  sectionLabel(doc, "Brand fonts");
  helper(
    doc,
    "Font names and where you use them. Skip if you don't have specific fonts set."
  );
  fieldTable(
    doc,
    "font",
    ["Font name", "Role (Primary / Secondary)", "Use case (headlines, body…)"],
    [2, 1.5, 1.8],
    3
  );

  // ─── SOCIAL HANDLES ───
  sectionLabel(doc, "Social handles");
  twoFields(
    doc,
    { label: "Instagram", name: "instagram", helper: "@handle or full URL" },
    { label: "Facebook", name: "facebook" }
  );
  twoFields(
    doc,
    { label: "YouTube", name: "youtube" },
    { label: "TikTok", name: "tiktok" }
  );
  fieldLabel(doc, "LinkedIn");
  textField(doc, { name: "linkedin" });

  // ─── ASSETS ───
  sectionLabel(doc, "Logos & assets");
  instructionBox(
    doc,
    "Attach these to your reply email",
    "This PDF can't carry file attachments. When you email us the completed form, attach:",
    [
      "Logo files in any format you have — PNG, SVG, EPS, AI",
      "Primary logo, alternate marks, icon, and white/dark variants if available",
      "Any existing brand guidelines, decks, or photo/video reference materials",
    ],
    "Prefer to share a folder? Drop a Dropbox or Google Drive link in the field below."
  );
  fieldLabel(doc, "Asset folder link (Dropbox / Google Drive)");
  textField(doc, { name: "client_asset_folder_url" });
  fieldLabel(doc, "Notes about your assets");
  helper(
    doc,
    "Anything we should know — which logo is the newest, which version is approved for which background, etc."
  );
  textField(doc, { name: "asset_notes", height: 60, multiline: true });

  // ─── ANYTHING ELSE ───
  sectionLabel(doc, "Anything else");
  fieldLabel(doc, "Additional notes for the SG team");
  helper(
    doc,
    "Launches, campaigns, dates to work around, team members who should be looped in — anything that helps us start on the right foot."
  );
  textField(doc, { name: "additional_notes", height: 90, multiline: true });

  // ─── READY TO SEND ───
  doc.y += 12;
  ensureSpace(doc, 80);
  const boxTop = doc.y;
  const readyH = 70;
  doc.current.drawRectangle({
    x: MARGIN,
    y: toPdfY(doc, boxTop + readyH),
    width: CONTENT_W,
    height: readyH,
    borderWidth: 1,
    borderColor: SG_GREEN,
    color: rgb(1, 1, 1),
  });
  doc.y = boxTop + 12;
  drawText(doc, "Ready to send?", {
    size: 10,
    bold: true,
    color: INK,
    x: MARGIN + 14,
    maxWidth: CONTENT_W - 28,
  });
  drawText(
    doc,
    "Save this PDF (File → Save), then email it to billy@surroundingsgroup.com along with your logo files. By submitting you agree to let the SG team contact you to finalize your brand profile.",
    {
      size: 9.5,
      color: SOFT_INK,
      x: MARGIN + 14,
      maxWidth: CONTENT_W - 28,
      lineHeight: 13,
    }
  );
  doc.y = boxTop + readyH + 10;

  // ─── FOOTERS ON ALL PAGES ───
  pageFooter(doc);

  return pdf.save();
}
