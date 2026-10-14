// Printable fallback for the public intake form at /intake. Served from
// /api/intake/pdf. Shipped because some corporate email filters strip the
// intake link; clients can download, fill out, and email back instead.
//
// This mirrors the field structure of the web form (app/(public)/intake)
// so Billy's team can transcribe answers into the brand record afterward.
// The form is designed to be either printed and hand-filled OR annotated
// in Preview/Adobe (clients can type into the blank lines/boxes).

import { Document, Page, View, Text, StyleSheet, Font } from "@react-pdf/renderer";

Font.registerHyphenationCallback((word) => [word]);

const INK = "#111111";
const SOFT_INK = "#3A3733";
const MUTED = "#8A867F";
const LINE = "#D4D1C9";
const SOFT_BG = "#FAF8F3";
const SG_GREEN = "#293B29";

const styles = StyleSheet.create({
  page: {
    paddingTop: 56,
    paddingBottom: 56,
    paddingHorizontal: 56,
    fontFamily: "Helvetica",
    color: INK,
    fontSize: 10,
    lineHeight: 1.5,
  },
  header: {
    marginBottom: 24,
    paddingBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: LINE,
  },
  eyebrow: {
    fontSize: 8,
    letterSpacing: 2,
    color: MUTED,
    fontFamily: "Helvetica-Bold",
    marginBottom: 8,
  },
  title: {
    fontSize: 26,
    fontFamily: "Helvetica-Bold",
    letterSpacing: -0.6,
    color: INK,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 10,
    color: SOFT_INK,
    lineHeight: 1.55,
    maxWidth: 400,
  },
  instructionBox: {
    marginBottom: 24,
    padding: 14,
    backgroundColor: SOFT_BG,
    borderLeftWidth: 3,
    borderLeftColor: SG_GREEN,
    borderRadius: 2,
  },
  instructionTitle: {
    fontFamily: "Helvetica-Bold",
    fontSize: 10,
    color: INK,
    marginBottom: 6,
  },
  instructionBody: {
    fontSize: 9.5,
    color: SOFT_INK,
    lineHeight: 1.55,
  },
  instructionList: {
    fontSize: 9.5,
    color: SOFT_INK,
    lineHeight: 1.6,
    marginTop: 4,
    paddingLeft: 10,
  },
  section: {
    marginBottom: 20,
  },
  sectionLabel: {
    fontSize: 8,
    letterSpacing: 2,
    color: MUTED,
    fontFamily: "Helvetica-Bold",
    marginBottom: 8,
    textTransform: "uppercase",
  },
  field: {
    marginBottom: 12,
  },
  fieldLabel: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: SOFT_INK,
    marginBottom: 4,
  },
  fieldHelper: {
    fontSize: 8.5,
    color: MUTED,
    marginBottom: 6,
    lineHeight: 1.4,
  },
  // Single-line input: a thin bottom-ruled line approximating a form field.
  inputLine: {
    height: 18,
    borderBottomWidth: 0.75,
    borderBottomColor: LINE,
    marginBottom: 2,
  },
  // Multi-line input: a bordered box the client types or writes into.
  inputBox: {
    minHeight: 56,
    borderWidth: 0.75,
    borderColor: LINE,
    borderRadius: 2,
    padding: 8,
    marginBottom: 2,
  },
  inputBoxTall: {
    minHeight: 84,
    borderWidth: 0.75,
    borderColor: LINE,
    borderRadius: 2,
    padding: 8,
    marginBottom: 2,
  },
  twoCol: {
    flexDirection: "row",
    gap: 16,
  },
  colHalf: {
    flex: 1,
  },
  // Table rows for colors / fonts
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: INK,
    paddingBottom: 4,
    marginBottom: 2,
  },
  tableHeaderCell: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: SOFT_INK,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: LINE,
    paddingVertical: 10,
  },
  tableCell: {
    paddingHorizontal: 2,
  },
  checkbox: {
    width: 10,
    height: 10,
    borderWidth: 0.75,
    borderColor: SOFT_INK,
    marginRight: 6,
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  checkText: {
    fontSize: 9.5,
    color: SOFT_INK,
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 56,
    right: 56,
    paddingTop: 10,
    borderTopWidth: 0.5,
    borderTopColor: LINE,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerText: {
    fontSize: 8,
    color: MUTED,
  },
});

function Field({
  label,
  helper,
  lines = 1,
}: {
  label: string;
  helper?: string;
  lines?: number;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {helper && <Text style={styles.fieldHelper}>{helper}</Text>}
      {lines === 1 ? (
        <View style={styles.inputLine} />
      ) : lines <= 3 ? (
        <View style={styles.inputBox} />
      ) : (
        <View style={styles.inputBoxTall} />
      )}
    </View>
  );
}

function TwoFields({ children }: { children: React.ReactNode }) {
  return <View style={styles.twoCol}>{children}</View>;
}

function PageFooter({ pageNum, total }: { pageNum: number; total: number }) {
  return (
    <View style={styles.footer} fixed>
      <Text style={styles.footerText}>Surroundings Group · Brand Intake</Text>
      <Text style={styles.footerText}>
        Page {pageNum} of {total}
      </Text>
    </View>
  );
}

export function IntakeFormPdf() {
  return (
    <Document title="Surroundings Group — Brand Intake Form">
      {/* ───────────── PAGE 1 ───────────── */}
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>SURROUNDINGS GROUP</Text>
          <Text style={styles.title}>Brand intake form</Text>
          <Text style={styles.subtitle}>
            Help us bring your brand to life. Fill in whatever you have — skip anything you&apos;re
            not sure about.
          </Text>
        </View>

        <View style={styles.instructionBox}>
          <Text style={styles.instructionTitle}>How to submit this form</Text>
          <Text style={styles.instructionBody}>
            This is the printable version of our online intake form, in case the online link
            can&apos;t get through your email filters. Three ways to fill it out:
          </Text>
          <View style={styles.instructionList}>
            <Text>• Open in Preview (Mac) or Adobe Reader and type directly into the fields.</Text>
            <Text>• Print it, fill in by hand, then scan or photograph each page.</Text>
            <Text>• Fill in what you can and email us notes for anything that doesn&apos;t fit.</Text>
          </View>
          <Text style={[styles.instructionBody, { marginTop: 8 }]}>
            When you&apos;re done, email the completed form + your logo files + any reference
            materials to{" "}
            <Text style={{ fontFamily: "Helvetica-Bold", color: INK }}>
              billy@surroundingsgroup.com
            </Text>
            . We&apos;ll upload everything into your brand profile for you.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Your contact info</Text>
          <TwoFields>
            <View style={styles.colHalf}>
              <Field label="Your name *" />
            </View>
            <View style={styles.colHalf}>
              <Field label="Email *" />
            </View>
          </TwoFields>
          <Field label="Phone" />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>The basics</Text>
          <TwoFields>
            <View style={styles.colHalf}>
              <Field label="Business name *" />
            </View>
            <View style={styles.colHalf}>
              <Field label="Website" />
            </View>
          </TwoFields>
          <Field
            label="Tagline / one-liner"
            helper={`A short line we can use on lower thirds or hero text in videos (e.g. "Modern Tampa apartment living"). Skip if you don't have one.`}
          />
          <Field
            label="Category / industry"
            helper="Marine · Private aviation · Automotive · Real estate · Multifamily residential · Resort & travel · Home services · Other — write in your own words."
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>About your brand</Text>
          <Field
            label="Client overview"
            helper="2–4 sentences: what you do, who your customers are, and what makes you different from competitors."
            lines={5}
          />
        </View>

        <PageFooter pageNum={1} total={4} />
      </Page>

      {/* ───────────── PAGE 2 ───────────── */}
      <Page size="LETTER" style={styles.page}>
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Look &amp; feel</Text>
          <Field
            label="Visual personality"
            helper={`How would you describe the visual personality of your brand? Is it clean and minimal like Apple, bold and adventurous like Red Bull, luxury coastal like a high-end resort, dark and cinematic like a premium car brand? There are no wrong answers.`}
            lines={5}
          />
          <Field
            label="Inspiration references"
            helper="Brands, creators, social accounts, websites, videos whose look and feel you admire — even if they're outside your industry. Links or @handles welcome."
            lines={4}
          />
          <Field
            label="What to avoid"
            helper="Styles, color palettes, editing trends, or brands whose look you want to stay away from."
            lines={3}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Audio vibe</Text>
          <Field
            label="Music &amp; audio direction"
            helper={`Describe the vibe (upbeat and modern, slow and cinematic, laid-back coastal) or drop a link to a song, artist, or Spotify/YouTube playlist that captures it.`}
            lines={4}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Audience</Text>
          <TwoFields>
            <View style={styles.colHalf}>
              <Field label="Gender" helper="e.g. Male / Female / All" />
            </View>
            <View style={styles.colHalf}>
              <Field label="Age range" helper="e.g. 25 to 40" />
            </View>
          </TwoFields>
          <Field
            label="Audience type"
            helper="Who are you speaking to? Buyers, renters, enthusiasts, decision-makers, etc."
            lines={3}
          />
        </View>

        <PageFooter pageNum={2} total={4} />
      </Page>

      {/* ───────────── PAGE 3 ───────────── */}
      <Page size="LETTER" style={styles.page}>
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Brand colors</Text>
          <Text style={styles.fieldHelper}>
            If you know your brand colors, list them here. Otherwise leave blank — we&apos;ll extract
            them from your logos.
          </Text>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderCell, { flex: 2 }]}>Name</Text>
            <Text style={[styles.tableHeaderCell, { flex: 1.3 }]}>Hex (e.g. #1A2B3C)</Text>
            <Text style={[styles.tableHeaderCell, { flex: 1.3 }]}>Role</Text>
          </View>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={styles.tableRow}>
              <View style={[styles.tableCell, { flex: 2 }]} />
              <View style={[styles.tableCell, { flex: 1.3 }]} />
              <View style={[styles.tableCell, { flex: 1.3 }]}>
                <Text style={{ fontSize: 8, color: MUTED }}>Primary / Secondary</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Brand fonts</Text>
          <Text style={styles.fieldHelper}>
            Font names and where you use them. Skip if you don&apos;t have specific fonts set.
          </Text>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderCell, { flex: 2 }]}>Font name</Text>
            <Text style={[styles.tableHeaderCell, { flex: 1.3 }]}>Role</Text>
            <Text style={[styles.tableHeaderCell, { flex: 1.8 }]}>Use case</Text>
          </View>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.tableRow}>
              <View style={[styles.tableCell, { flex: 2 }]} />
              <View style={[styles.tableCell, { flex: 1.3 }]}>
                <Text style={{ fontSize: 8, color: MUTED }}>Primary / Secondary</Text>
              </View>
              <View style={[styles.tableCell, { flex: 1.8 }]}>
                <Text style={{ fontSize: 8, color: MUTED }}>Headlines, body, etc.</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Social handles</Text>
          <TwoFields>
            <View style={styles.colHalf}>
              <Field label="Instagram" helper="@handle or full URL" />
              <Field label="YouTube" />
              <Field label="LinkedIn" />
            </View>
            <View style={styles.colHalf}>
              <Field label="Facebook" />
              <Field label="TikTok" />
            </View>
          </TwoFields>
        </View>

        <PageFooter pageNum={3} total={4} />
      </Page>

      {/* ───────────── PAGE 4 ───────────── */}
      <Page size="LETTER" style={styles.page}>
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Logos &amp; assets</Text>
          <View style={styles.instructionBox}>
            <Text style={styles.instructionTitle}>Attach these to your reply email</Text>
            <Text style={styles.instructionBody}>
              This form can&apos;t carry file attachments. When you email us the completed PDF,
              attach:
            </Text>
            <View style={styles.instructionList}>
              <Text>• Logo files in any format you have — PNG, SVG, EPS, AI</Text>
              <Text>
                • Primary logo, alternate marks, icon, and white/dark variants if available
              </Text>
              <Text>
                • Any existing brand guidelines, decks, or photo/video reference materials
              </Text>
            </View>
            <Text style={[styles.instructionBody, { marginTop: 8 }]}>
              Alternatively, share a folder link (Dropbox, Google Drive) in the field below and
              we&apos;ll pull from there.
            </Text>
          </View>
          <Field label="Asset folder link (Dropbox / Google Drive)" />
          <Field
            label="Notes about your assets"
            helper="Anything we should know — which logo is the newest, which version is approved for which background, etc."
            lines={4}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Anything else</Text>
          <Field
            label="Additional notes for the SG team"
            helper="Launches, campaigns, dates to work around, team members who should be looped in — anything that helps us start on the right foot."
            lines={6}
          />
        </View>

        <View style={{ marginTop: 24, padding: 16, borderWidth: 1, borderColor: SG_GREEN, borderRadius: 2 }}>
          <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 10, color: INK, marginBottom: 4 }}>
            Ready to send?
          </Text>
          <Text style={{ fontSize: 9.5, color: SOFT_INK, lineHeight: 1.6 }}>
            Email the completed form plus any logo / reference files to{" "}
            <Text style={{ fontFamily: "Helvetica-Bold", color: INK }}>
              billy@surroundingsgroup.com
            </Text>
            . By submitting you agree to let the SG team contact you to finalize your brand
            profile. Thanks for taking the time — we&apos;re excited to work with you.
          </Text>
        </View>

        <PageFooter pageNum={4} total={4} />
      </Page>
    </Document>
  );
}
