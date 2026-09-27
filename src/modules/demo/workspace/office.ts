import "server-only";
/**
 * Content of the demo office documents, built with the editors' own builders so every document opens as real,
 * editable work product: a Word research memo and a Word RFP set (TipTap JSON), an Excel damages model with live
 * formulas (workbook JSON), a PowerPoint strategy deck (deck JSON) and a PDF deposition outline (pdf-lib spec).
 *
 * Evidence cited in the deck and the outline comes from the e-discovery documents actually loaded with the pack
 * (their real Bates numbers); nothing here invents a Bates number or a source.
 */
import type { EDocument } from "@/lib/types/domain";
import { buildDoc } from "@/modules/office/word/templates";
import { captionBlock, discoveryDefinitions, signatureBlock, type FirmInfo } from "@/modules/office/word/sections";
import type { PMNode } from "@/modules/office/word/doc-model";
import { buildWorkbook, cells, inputs, section, table, title, widths, LABEL_STYLE, NOTE_STYLE, TOTAL_STYLE } from "@/modules/office/sheet/builders";
import type { SheetOp } from "@/modules/office/sheet/ops";
import type { Workbook } from "@/modules/office/sheet/model";
import { deckFromOutline } from "@/modules/office/slides/templates";
import type { DeckContent } from "@/modules/office/slides/model";
import type { Block, DocSpec } from "@/modules/office/pdf/generate";
import { DEMO_ID_PREFIX } from "../ids";
import { dayOffset, type DemoBuildContext } from "./context";
import { DEMO_CASE_NUMBER, DEMO_CONSUMER_NAME } from "./matters";
import { DEMO_JUDGE_NAME, DEMO_OPPOSING_COUNSEL_NAME } from "./people";

export const DEMO_OFFICE_IDS = {
  memo: `${DEMO_ID_PREFIX}doc_memo_market_definition`,
  rfp: `${DEMO_ID_PREFIX}doc_rfp_set_one`,
  damages: `${DEMO_ID_PREFIX}doc_damages_model`,
  deck: `${DEMO_ID_PREFIX}doc_strategy_deck`,
  outline: `${DEMO_ID_PREFIX}doc_reyes_outline`,
} as const;

export const DEMO_OUTLINE_BLOB = `${DEMO_ID_PREFIX}blob_reyes_outline`;

const fmtDate = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const clean = (s: string) => s.replace(/\|/g, "/").replace(/\s+/g, " ").trim();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

function firm(ctx: DemoBuildContext): FirmInfo {
  return { name: ctx.firmName, address1: "[Firm address]", address2: "[City, State ZIP]", phone: "[Telephone]", email: `[Email]` };
}

// ---------------------------------------------------------------------------
// Word: research memo
// ---------------------------------------------------------------------------

export function researchMemo(ctx: DemoBuildContext): PMNode {
  return buildDoc([
    "# MEMORANDUM",
    "@caption **PRIVILEGED AND CONFIDENTIAL — ATTORNEY WORK PRODUCT** · Demonstration document (synthetic)",
    `**TO:** ${ctx.ownerName}`,
    "**FROM:** Nina Castell",
    `**DATE:** ${fmtDate(dayOffset(ctx.now, -5))}`,
    `**RE:** Market definition and the anti-steering theory — ${DEMO_CONSUMER_NAME}, Case No. ${DEMO_CASE_NUMBER} (N.D. Cal.)`,
    "## Questions presented",
    "1. Which relevant product market should the class prove for the Section 2 claims: all U.S. smartphones, a narrower performance-smartphone market, or an aftermarket for iOS app distribution?\n2. Can the anti-steering rules support classwide antitrust injury to consumers, given that the commission is charged to developers?",
    "## Short answers",
    "1. Plead and prove the performance-smartphone market in the alternative to the broader smartphone market. Switching costs (purchased apps, data migration, group messaging and accessory lock-in) and price discrimination between device tiers support a narrower market under the hypothetical monopolist test. The app-distribution market is best framed as a single-brand aftermarket only if the class can show consumers could not reasonably account for lifecycle costs at purchase; that is a harder showing and should be secondary.\n2. Yes, if the expert can show pass-through. The class theory is that anti-steering rules suppressed price competition from alternative payment channels, allowing supra-competitive commissions that developers passed on in app and in-app prices. Common impact turns on a uniform commission structure plus a reliable pass-through estimate.",
    "## Background (public record and demo facts)",
    "The complaint challenges App Store distribution and anti-steering rules, restrictions on super apps and cloud game streaming, cross-platform messaging, smartwatch interoperability and tap-to-pay wallet access. Prior developer litigation over anti-steering rules resulted in an injunction addressing link-out restrictions (Epic Games, Inc. v. Apple Inc., 67 F.4th 946 (9th Cir. 2023)). A government monopolization action addressing overlapping conduct is pending in the District of New Jersey and is tracked as a separate matter.",
    "Everything in this memorandum about the defendant's internal documents or testimony refers to the synthetic demonstration record loaded in e-discovery.",
    "## Analysis",
    "### A. Market definition",
    "**1. Hypothetical monopolist test.** A small but significant non-transitory increase in price for performance smartphones would be profitable if enough consumers would not switch to entry-level devices or rival ecosystems. Evidence of switching costs is central: loss of purchased apps, friction in moving data, degraded group messaging with users of other platforms, and smartwatch incompatibility.",
    "**2. Two-sided platform question.** Defendant will argue that app distribution is a two-sided transaction platform, requiring the court to consider both the developer and consumer sides (Ohio v. American Express Co., 585 U.S. 529 (2018)). Our response: the consumer class purchases devices and digital content; the relevant harm is to consumers on the side of the market where they pay, and the expert should model net effects on both sides to foreclose the argument.",
    "**3. Aftermarket theory.** A single-brand aftermarket requires showing lock-in and information costs at the time of device purchase. Keep as an alternative; do not lead with it.",
    "### B. Anti-steering and classwide injury",
    "**1. Mechanism.** Anti-steering rules prevent developers from telling users about cheaper purchase options. Without competitive pressure from alternative channels, the commission remains above the but-for level.",
    "**2. Pass-through.** The class must show that commission overcharges were passed through to consumer prices. The damages workbook in the matter folder implements overcharge × volume × pass-through by year; inputs are placeholders until Dr. Varga's analysis is final.",
    "**3. Class certification standards.** Plaintiffs must prove Rule 23 requirements by a preponderance of the evidence, and the presence of some uninjured class members does not automatically defeat predominance (Olean Wholesale Grocery Coop. v. Bumble Bee Foods LLC, 31 F.4th 651 (9th Cir. 2022) (en banc)). The damages model must measure only damages attributable to the theory of liability (Comcast Corp. v. Behrend, 569 U.S. 27 (2013)).",
    "## Evidence to develop",
    "- Commission-rate analyses from the payments custodians (Okoro set) showing awareness of competitive constraints.\n- Guideline-review materials from the App Store Policy custodian (Marsh set).\n- Developer outreach on link-out entitlements (Ames set).\n- Switching-cost evidence from messaging and wearables custodians (Nand and Frey sets).",
    "## Recommendation",
    "Proceed on the performance-smartphone market with the smartphone market in the alternative; have the expert test both with the transaction data; build the anti-steering injury theory around uniform commission terms and a reliable pass-through estimate.",
    "@caption [VERIFY all citations and pin cites before relying on this memorandum in any filing.]",
  ]);
}

// ---------------------------------------------------------------------------
// Word: Plaintiffs' First Requests for Production
// ---------------------------------------------------------------------------

const RFP_REQUESTS = [
  "All Documents Concerning the adoption, revision, enforcement or rationale of the Anti-Steering Rules, including drafts, presentations and communications among the App Store Policy, Developer Relations and Payments teams.",
  "Documents sufficient to show, for each year of the Relevant Period, the commission rates You charged on App Store purchases of digital goods and services, including subscription, Small Business Program and reader-app tiers.",
  "All analyses, models or forecasts Concerning the revenue or margin effect of permitting developers to link to or communicate about purchasing options outside the App Store.",
  "Transaction-level data for all App Store purchases by U.S. accounts during the Relevant Period, in native form, with a data dictionary, as described in Instruction 3.",
  "All Documents Concerning any assessment of consumer switching between iPhone and other smartphones, including surveys, churn analyses and win/loss reports.",
  "All Documents Concerning the decision to limit third-party smartwatch access to notifications, pairing or connectivity APIs.",
  "All Documents Concerning the quality of messaging between iPhone users and users of other smartphones, including any evaluation of a messaging client for other platforms.",
  "All Documents Concerning access by third-party wallets or payment apps to the NFC controller or tap-to-pay functionality, including requests for access and the reasons for any denial.",
  "All Documents Concerning review guidelines for apps that host mini-apps, mini-games or game-streaming catalogs.",
  "Organizational charts sufficient to identify the persons responsible for App Store policy, developer relations, payments, wearables, messaging and wallet products during the Relevant Period.",
  "All Documents You provided to any government agency in connection with an investigation of the conduct alleged in the Complaint, to the extent not privileged.",
  "Documents sufficient to show Your document-retention policies applicable to the custodians identified in Your initial disclosures.",
];

export function rfpDraft(ctx: DemoBuildContext): PMNode {
  const caption = captionBlock({
    court: "IN THE UNITED STATES DISTRICT COURT\nFOR THE NORTHERN DISTRICT OF CALIFORNIA",
    division: "SAN JOSE DIVISION",
    plaintiff: DEMO_CONSUMER_NAME.toUpperCase(),
    defendant: "",
    caseNo: `Case No. ${DEMO_CASE_NUMBER}`,
    judge: `${DEMO_JUDGE_NAME} (fictional)`,
    documentTitle: "Plaintiffs' First Set of Requests for Production of Documents",
    extra: "This Document Relates To: All Consumer Actions",
  });
  const requests = RFP_REQUESTS.map((r, i) => `**REQUEST FOR PRODUCTION NO. ${i + 1}:**\n\n${r}`);
  return buildDoc([
    caption,
    "@caption DRAFT — demonstration document (synthetic)",
    "**PROPOUNDING PARTY:** Plaintiffs",
    "**RESPONDING PARTY:** Defendant Apple Inc.",
    "**SET NUMBER:** One",
    "Pursuant to Rules 26 and 34 of the Federal Rules of Civil Procedure, Plaintiffs request that Defendant produce the documents and things described below within thirty (30) days of service, in accordance with the Definitions and Instructions below and the parties' ESI Protocol.",
    discoveryDefinitions({ requesting: "Plaintiffs", responding: "Apple" }),
    "## REQUESTS FOR PRODUCTION",
    ...requests,
    signatureBlock({ date: fmtDate(dayOffset(ctx.now, 3)), attorney: ctx.ownerName, title: "Interim Class Counsel for", forParty: "Plaintiffs and the Proposed Class", firm: firm(ctx) }),
  ]);
}

// ---------------------------------------------------------------------------
// Excel: damages model (overcharge × volume by year)
// ---------------------------------------------------------------------------

/** Synthetic yearly inputs shared by the workbook and the deck chart. $M of U.S. consumer App Store billings. */
export const DAMAGES_YEARS: { year: number; billings: number; effective: number }[] = [
  { year: 2019, billings: 15_800, effective: 0.287 },
  { year: 2020, billings: 19_900, effective: 0.284 },
  { year: 2021, billings: 22_600, effective: 0.272 },
  { year: 2022, billings: 23_400, effective: 0.266 },
  { year: 2023, billings: 25_100, effective: 0.261 },
  { year: 2024, billings: 26_700, effective: 0.257 },
  { year: 2025, billings: 27_900, effective: 0.253 },
];
export const DAMAGES_INPUTS = { butFor: 0.12, passThrough: 0.7, classShare: 0.86 } as const;

/** Same arithmetic as the workbook formulas: consumer overcharge in $M per year. */
export function consumerOvercharge(): { year: number; value: number }[] {
  return DAMAGES_YEARS.map((y) => ({ year: y.year, value: Math.round(y.billings * DAMAGES_INPUTS.classShare * (y.effective - DAMAGES_INPUTS.butFor) * DAMAGES_INPUTS.passThrough) }));
}

export function damagesWorkbook(ctx: DemoBuildContext): Workbook {
  const M1 = "#,##0.0" as const;
  const PCT = "0.0%" as const;
  const inp = inputs("A4", [
    { label: "But-for commission rate", value: DAMAGES_INPUTS.butFor, fmt: PCT, name: "ButFor", note: "Placeholder benchmark pending Dr. Varga's report" },
    { label: "Pass-through rate to consumers", value: DAMAGES_INPUTS.passThrough, fmt: PCT, name: "PassThrough", note: "Placeholder; see sensitivity table" },
    { label: "Class share of U.S. consumer billings", value: DAMAGES_INPUTS.classShare, fmt: PCT, name: "ClassShare", note: "Excludes business and government accounts" },
    { label: "Model as of", value: dayOffset(ctx.now, -2), fmt: "mmm d yyyy" },
  ]);
  const first = 11;
  const rows = DAMAGES_YEARS.map((y, i) => {
    const r = first + i;
    return [y.year, y.billings, y.effective, "=ButFor", `=C${r}-D${r}`, `=B${r}*ClassShare`, `=F${r}*E${r}`, `=G${r}*PassThrough`];
  });
  const last = first + DAMAGES_YEARS.length - 1;
  const total = last + 1;
  const s = total + 3;
  const ops: SheetOp[] = [
    ...title("Apple Antitrust (Consumer Class) — Damages Model", "Overcharge × volume by year. Synthetic demonstration figures ($ millions); inputs in yellow are placeholders until the expert's analysis is final.", 1, 8),
    ...inp.ops,
    ...section("A9", "Consumer overcharge by year ($M)", 8),
    ...table({ anchor: "A10", headers: ["Year", "U.S. consumer billings", "Effective commission", "But-for commission", "Overcharge rate", "Class billings", "Developer overcharge", "Consumer overcharge"], rows, formats: { 1: M1, 2: PCT, 3: PCT, 4: PCT, 5: M1, 6: M1, 7: M1 }, total: { columns: [1, 5, 6, 7] }, freeze: true, widths: [70, 150, 150, 140, 130, 130, 150, 160], align: { 0: "left" } }),
    { type: "style_range", range: `B${first}:C${last}`, style: { fill: "#FFF8E1" } },
    ...section(`A${s}`, "Summary", 4),
    cells([
      [`A${s + 1}`, "Consumer overcharge (single damages)", LABEL_STYLE], [`B${s + 1}`, `=H${total}`, { numFmt: M1 }],
      [`A${s + 2}`, "Trebled (Clayton Act § 4, 15 U.S.C. § 15)", LABEL_STYLE], [`B${s + 2}`, `=B${s + 1}*3`, { numFmt: M1 }],
      [`A${s + 3}`, "Weighted average overcharge rate", LABEL_STYLE], [`B${s + 3}`, `=G${total}/F${total}`, { numFmt: PCT }],
      [`A${s + 4}`, "Share of damages from 2023 onward", LABEL_STYLE], [`B${s + 4}`, `=SUM(H${last - 2}:H${last})/H${total}`, { numFmt: PCT }],
    ]),
    ...section(`A${s + 6}`, "Sensitivity: pass-through rate", 4),
    cells([
      [`A${s + 7}`, "Pass-through", TOTAL_STYLE], [`B${s + 7}`, "Consumer overcharge", TOTAL_STYLE], [`C${s + 7}`, "Trebled", TOTAL_STYLE],
      ...[0.5, 0.6, 0.7, 0.8, 0.9].flatMap((p, i): [string, string | number, Record<string, unknown>][] => {
        const r = s + 8 + i;
        return [[`A${r}`, p, { numFmt: PCT, border: "thin" }], [`B${r}`, `=G${total}*A${r}`, { numFmt: M1, border: "thin" }], [`C${r}`, `=B${r}*3`, { numFmt: M1, border: "thin" }]];
      }),
    ] as Parameters<typeof cells>[0]),
    cells([[`A${s + 14}`, "Formula: consumer overcharge = billings × class share × (effective − but-for commission) × pass-through. All figures are synthetic demonstration data.", NOTE_STYLE]]),
    { type: "merge_cells", range: `A${s + 14}:H${s + 14}` },
    ...widths({ A: 300 }),
    { type: "add_chart", chart: { type: "bar", title: "Consumer overcharge by year ($M)", range: `H10:H${last}`, categoryRange: `A${first}:A${last}`, hasHeader: true, position: { x: 700, y: (s - 1) * 24, w: 520, h: 280 } } },
  ];
  return buildWorkbook([{ name: "Damages", ops }], { namedRanges: Object.fromEntries(Object.entries(inp.named).map(([k, v]) => [k, `Damages!${v}`])) });
}

// ---------------------------------------------------------------------------
// PowerPoint: case strategy deck
// ---------------------------------------------------------------------------

export interface KeyDocRow { bates: string; date: string; subject: string; custodian: string; issue: string }

export function keyDocRows(docs: EDocument[], limit = 6): KeyDocRow[] {
  return docs
    .filter((d) => d.coding?.hot)
    .sort((a, b) => (b.aiScore ?? 0) - (a.aiScore ?? 0) || a.date.localeCompare(b.date))
    .slice(0, limit)
    .map((d) => ({ bates: d.bates, date: d.date.slice(0, 10), subject: clip(clean(d.subject), 26), custodian: d.custodianName, issue: clean((d.coding.issues ?? d.aiIssues ?? []).slice(0, 2).join(", ")) || "—" }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function strategyDeck(ctx: DemoBuildContext, keyDocs: KeyDocRow[]): DeckContent {
  const over = consumerOvercharge();
  const total = over.reduce((n, x) => n + x.value, 0);
  const docRows = keyDocs.length
    ? keyDocs.map((d) => `| ${d.bates} | ${d.date} | ${d.subject} | ${d.custodian} |`).join("\n")
    : "| Pending | — | Hot documents appear here once the production is coded | — |";
  const outline = `# Apple antitrust — consumer class: case strategy
kicker: Case No. ${DEMO_CASE_NUMBER} (N.D. Cal.) · Demonstration data · Privileged
subtitle: Theory, record, damages and the path to class certification
date: ${fmtDate(ctx.now.toISOString())} · Litigation team working session

# Agenda
- Posture and schedule
- Theory of the case
- What the record shows so far
- Damages model
- Risks and recommendations
- Next steps

# Posture and schedule
layout: two_column
left: The case
- **Court:** N.D. Cal. · ${DEMO_JUDGE_NAME} (fictional)
- **Class:** U.S. iPhone and App Store purchasers
- **Claims:** Sherman Act § 2 monopolization and attempt
- **Defense counsel:** ${DEMO_OPPOSING_COUNSEL_NAME}, Hartwell & Pryor LLP (fictional)
right: Key dates
- **${fmtDate(dayOffset(ctx.now, 24))}** — substantial completion of production
- **${fmtDate(dayOffset(ctx.now, 52))}** — class certification motion and expert reports
- **${fmtDate(dayOffset(ctx.now, 95))}** — close of fact discovery
- **${fmtDate(dayOffset(ctx.now, 150))}** — class certification hearing
notes: Anchor the dates; the class certification motion drives every workstream.

# Theory of the case
- **Monopoly power** in performance smartphones, protected by switching costs
- **Anti-steering rules** kept commissions above the competitive level
- **Conduct that raised switching costs:** messaging, smartwatch and wallet restrictions
- **Consumer injury:** commission overcharges passed through to app prices
notes: Every theme maps to a custodian set and a witness: Marsh and Ames (policy), Okoro (commissions), Nand, Frey and Reyes (switching costs).

# Chronology
layout: timeline
timeline:
- 2008-07 — App Store launches — public record
- 2021-09 — Injunction in developer litigation over anti-steering rules — public record
- 2024-03 — Government monopolization action filed (D.N.J.) — public record
- 2024-04 — Consumer class action filed — demo matter
- Today — Fact discovery; depositions of policy, payments and wearables custodians taken
notes: Internal events in the demo record are on the e-discovery timeline with source links.

# What the record shows so far
layout: table
| Bates | Date | Document | Custodian |
${docRows}
caption: Hot documents from the loaded e-discovery set; open each in E-discovery → Review for the full text.
notes: These rows are generated from documents coded hot in the demo production; the Bates numbers resolve in the review workspace.

# Damages: consumer overcharge by year
layout: chart
chart: bar | ${over.map((o) => o.year).join(" | ")}
chart-title: Consumer overcharge ($M, synthetic placeholder inputs)
Overcharge: ${over.map((o) => o.value).join(", ")}
unit: $
- Total single damages about $${Math.round(total).toLocaleString("en-US")}M before trebling
- Inputs are placeholders pending Dr. Varga's report
notes: Same formula as the damages workbook: billings × class share × (effective − but-for commission) × pass-through.

# Risks and recommendations
layout: comparison
left: Risks
- Two-sided market framing narrows consumer injury
- Pass-through contested for free apps with in-app purchases
- Privilege assertions over commission-tier discussions
right: Recommendations
- Model both sides of the platform in the expert report
- Build the pass-through record from developer price changes
- Challenge log entries where counsel is merely copied

# Next steps
- Finalize the Reyes outline; take the Ames, Reyes and Nand depositions
- Letter brief to compel structured transaction data
- Serve Rule 30(b)(6) topics on commission structure and wallet access
- Class certification brief: predominance outline to partner review
notes: Owners and due dates are on the matter task list.`;
  return deckFromOutline(outline, "seeger-navy");
}

// ---------------------------------------------------------------------------
// PDF: deposition outline (Tomas Reyes, Wallet & NFC)
// ---------------------------------------------------------------------------

export function reyesOutlineSpec(ctx: DemoBuildContext, exhibits: EDocument[]): DocSpec {
  const depoDate = fmtDate(dayOffset(ctx.now, 16));
  const exRows = exhibits.slice(0, 8).map((d, i) => [`PX-${140 + i}`, d.bates, d.date.slice(0, 10), clean(d.subject).slice(0, 60)]);
  return {
    title: "Deposition outline — Tomas Reyes (Wallet & NFC)",
    author: ctx.firmName,
    subject: "Attorney work product — demonstration data",
    keywords: ["deposition", "outline", "NFC", "wallet", "demo"],
    caption: {
      court: ["United States District Court", "Northern District of California", "San Jose Division"],
      left: ["IN RE SMARTPHONE APP DISTRIBUTION", "ANTITRUST LITIGATION", "(CONSUMER CLASS) — DEMO"],
      right: [`Case No. ${DEMO_CASE_NUMBER}`, `${DEMO_JUDGE_NAME} (fictional)`],
      title: ["DEPOSITION OUTLINE: TOMAS REYES", "(PRODUCT LEAD, WALLET & NFC)"],
    },
    draftStamp: "WORK PRODUCT",
    blocks: [
      { type: "keyvalue", rows: [["Date", depoDate], ["Location", "Remote (videoconference)"], ["Examining", "Nina Castell"], ["Second chair", ctx.ownerName], ["Defending", `${DEMO_OPPOSING_COUNSEL_NAME} (Hartwell & Pryor LLP, fictional)`], ["Time", "7 hours on the record (FRCP 30(d)(1))"]] },
      { type: "paragraph", text: "Privileged and confidential attorney work product. Demonstration document: the witness, facts and exhibits are synthetic.", italic: true },
      { type: "heading", text: "Goals", level: 1 },
      { type: "bullets", items: ["Establish the witness's role in decisions on third-party access to the NFC controller and tap-to-pay.", "Lock in the stated security rationale and test whether it was the contemporaneous reason.", "Connect wallet restrictions to switching costs and to fees charged to card issuers.", "Authenticate the exhibits below as business records."] },
      { type: "heading", text: "I. Background and role", level: 1 },
      { type: "numbered", number: "1.", text: "Employment history; reporting line; teams responsible for Wallet and NFC." },
      { type: "numbered", number: "2.", text: "Documents reviewed to prepare; persons consulted; time spent." },
      { type: "heading", text: "II. Third-party NFC access requests", level: 1 },
      { type: "numbered", number: "3.", text: "Process for evaluating requests from banks and payment apps for tap-to-pay access." },
      { type: "numbered", number: "4.", text: "Who decided; criteria applied; whether any request was granted before the demo cut-off." },
      { type: "numbered", number: "5.", text: "Whether revenue from issuer fees was discussed alongside security in the same meetings." },
      { type: "heading", text: "III. Security rationale", level: 1 },
      { type: "numbered", number: "6.", text: "Identify every document stating the security rationale; ask whether alternatives (secure element partitioning, certification programs) were evaluated." },
      { type: "numbered", number: "7.", text: "Confront with any exhibit showing the rationale was drafted after the access decision (check dates on the e-discovery timeline)." },
      { type: "heading", text: "IV. Switching costs", level: 1 },
      { type: "numbered", number: "8.", text: "Customer research on wallet use and device retention; whether wallet adoption was tracked as a retention metric." },
      { type: "heading", text: "Exhibits", level: 1 },
      // Numbered entries rather than a table: the generator's table header currently prints literal emphasis markers.
      ...(exRows.length
        ? exRows.map(([exh, bates, date, desc]): Block => ({ type: "numbered", number: `${exh}`, text: `**${bates}** (${date}) — ${desc}`, indent: 54 }))
        : [{ type: "paragraph", text: "Exhibit list pending: no wallet or NFC documents have been loaded for this matter yet." } satisfies Block]),
      { type: "paragraph", text: "Bates numbers are taken from the loaded production; confirm against the production index before marking.", italic: true, size: 9 },
    ],
    footer: { left: "Attorney work product — demo", right: "Reyes outline" },
  };
}
