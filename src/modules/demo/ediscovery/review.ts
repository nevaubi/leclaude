import type { EDocument, PrivilegeLogEntry, ProductionSet, ReviewBatch, SavedSearchRecord } from "@/lib/types/domain";
import { makeQcDecision, sampleIds } from "@/modules/ediscovery/batch-pure";
import { assignBates, isProductionReady, productionOrder, qcProduction } from "@/modules/ediscovery/production-pure";
import { compareBates } from "@/modules/ediscovery/query";
import { APPLE_DEMO_BATES_PREFIX, BY_NAME, M, REVIEWER as R, tagged } from "./people";

/** Review-workflow records for the demo matter: saved searches, batches, one production volume and the privilege log. */

export const REVIEW_IDS = {
  savedSearches: {
    antiSteering: "demo_apl_ss_anti_steering",
    costVsCommission: "demo_apl_ss_cost_vs_commission",
    interop: "demo_apl_ss_interop_retention",
    privCc: "demo_apl_ss_priv_cc_challenge",
    uncodedFamilies: "demo_apl_ss_uncoded_email",
  },
  batches: { firstPass: "demo_apl_rb_first_pass_01", privChallenge: "demo_apl_rb_priv_challenge", hotQc: "demo_apl_rb_hot_qc" },
  production: "demo_apl_pr_vol001",
} as const;

const T0 = "2026-09-02T09:00:00Z";
const T1 = "2026-09-16T17:30:00Z";

export function buildSavedSearches(): SavedSearchRecord[] {
  const S = REVIEW_IDS.savedSearches;
  const ss = (id: string, name: string, description: string, q: string, ownerId: string, shared: boolean): SavedSearchRecord =>
    tagged<SavedSearchRecord>({ id, matterId: M, name, description, q, ownerId, shared, createdAt: T0, updatedAt: T0 });
  return [
    ss(S.antiSteering, "Anti-steering — purpose and enforcement", "Rejections, rationale memos and escalations about telling users of other prices (RFP 4–7).", '("price comparison" OR "purchasing mechanisms" OR "web pricing" OR "link entitlement" OR steering)', R.associate, true),
    ss(S.costVsCommission, "Commission vs. cost-to-serve", "Finance analyses comparing the commission with processing and operating costs (economist reliance set).", '(contribution OR "cost-to-serve" OR "payment processing" OR "processing cost") AND (commission OR margin)', R.associate, true),
    ss(S.interop, "Interoperability and retention", "Messaging, watch and wallet limits tied to switching or retention.", "(retention OR switching OR \"stay on the phone\" OR sticky) AND (watch OR messaging OR wallet OR nfc)", R.associate, true),
    ss(S.privCc, "Privilege log challenges — counsel only copied", "Business emails where in-house counsel is only copied; defendant's privilege calls to challenge.", "tag:privilege-cc OR tag:privilege-challenge", R.associate, false),
    ss(S.uncodedFamilies, "Uncoded email", "Email still needing a responsiveness call — code families together.", "type:email responsive:none", R.paralegal, true),
  ];
}

export function buildBatches(docs: EDocument[]): ReviewBatch[] {
  const B = REVIEW_IDS.batches;
  const sorted = [...docs].sort((a, b) => compareBates(a.bates, b.bates));
  const byId = new Map(sorted.map((d) => [d.id, d]));
  // First pass: the generated custodial documents (a realistic mix of coded and uncoded).
  const firstIds = sorted.filter((d) => /_ed_g\d{3}$/.test(d.id)).map((d) => d.id);
  const firstPass: ReviewBatch = {
    id: B.firstPass, matterId: M, name: "First pass — custodial set 01 (8 custodians)", description: "First-level review of routine custodial documents. Apply the coding protocol; flag anything touching the anti-steering or interoperability theories for second look.",
    docIds: firstIds, source: { kind: "selection" }, assigneeId: R.paralegal, priority: "high", dueAt: "2026-10-09", status: "in_progress",
    qcSamplePercent: 10, qcSampleIds: sampleIds(firstIds, 10, B.firstPass), secondPass: false, qcDecisions: {}, createdBy: R.associate, createdAt: T0, updatedAt: T1,
  };
  // Privilege challenge second pass: every privileged document plus every privilege-CC / challenge candidate.
  const privIds = sorted.filter((d) => d.coding.privileged === true || (d.tags ?? []).some((t) => t === "privilege-cc" || t === "privilege-challenge")).map((d) => d.id);
  const privChallenge: ReviewBatch = {
    id: B.privChallenge, matterId: M, name: "Second pass — privilege log challenge", description: "Compare each defendant privilege assertion with the document: counsel as author or direct recipient, legal purpose, and whether counsel was merely copied. Feeds the meet-and-confer letter on the privilege log.",
    docIds: privIds, source: { kind: "search", q: "priv:yes OR tag:privilege-cc OR tag:privilege-challenge" }, assigneeId: R.associate, priority: "normal", dueAt: "2026-10-16", status: "in_progress",
    qcSamplePercent: 0, qcSampleIds: [], secondPass: true, qcDecisions: {}, createdBy: R.associate, createdAt: T0, updatedAt: T1,
  };
  // Hot QC: half of the hot documents re-read; decisions recorded for all but the last sample, one disagreement.
  const hotIds = sorted.filter((d) => d.coding.hot).map((d) => d.id);
  const hotSample = sampleIds(hotIds, 50, B.hotQc);
  const qcDecisions: ReviewBatch["qcDecisions"] = {};
  hotSample.slice(0, Math.max(1, hotSample.length - 3)).forEach((id, i) => {
    const d = byId.get(id)!;
    const qc = i === 2 ? { ...d.coding, hot: false } : d.coding;
    qcDecisions[id] = makeQcDecision(d.coding, qc, R.associate, T1);
  });
  const hotQc: ReviewBatch = {
    id: B.hotQc, matterId: M, name: "QC — hot documents (50% sample)", description: "Second reviewer re-reads half of the hot documents before the exhibit list is built; disagreements go to the Thursday calibration call.",
    docIds: hotIds, source: { kind: "search", view: "hot" }, assigneeId: R.associate, priority: "normal", dueAt: "2026-10-02", status: "qc",
    qcSamplePercent: 50, qcSampleIds: hotSample, secondPass: false, qcDecisions, createdBy: R.associate, createdAt: T0, updatedAt: T1,
  };
  return [firstPass, privChallenge, hotQc].map((b) => tagged(b));
}

/** Volume 001: plaintiffs' production of the documents their economist relied on (Rule 26(a)(2)(B) materials considered). */
export function buildProduction(docs: EDocument[]): ProductionSet {
  const reliance = docs.filter((d) => (d.tags ?? []).includes("expert-reliance") || (d.tags ?? []).includes("key-doc"));
  const ready = productionOrder(reliance.filter(isProductionReady));
  // Keep families complete: add production-ready family members of the chosen documents.
  const byId = new Map(docs.map((d) => [d.id, d]));
  const set = new Map(ready.map((d) => [d.id, d]));
  for (const d of ready) for (const m of [d.family?.parentId, ...(d.family?.attachmentIds ?? [])]) { const x = m ? byId.get(m) : undefined; if (x && isProductionReady(x)) set.set(x.id, x); }
  const ordered = productionOrder(Array.from(set.values()));
  const prefix = "PLTFVARGA";
  const { bates } = assignBates(ordered, { prefix, padding: 6, startNumber: 1 });
  const prod: ProductionSet = {
    id: REVIEW_IDS.production, matterId: M, name: "Expert reliance materials — Dr. Varga report", volume: "VOL001", status: "qc", prefix, padding: 6, startNumber: 1,
    stampText: "HIGHLY CONFIDENTIAL — SUBJECT TO PROTECTIVE ORDER", docIds: ordered.map((d) => d.id), bates, source: { kind: "search", q: "tag:expert-reliance OR tag:key-doc" },
    createdBy: R.paralegal, createdAt: T1, updatedAt: T1,
    notes: `Documents from defendant's production (${APPLE_DEMO_BATES_PREFIX}) considered by plaintiffs' economist, re-stamped for service with the expert report. Exact duplicates suppressed; families kept together.`,
  };
  prod.qc = qcProduction({ production: prod, docs, redactions: [] }, T1);
  return tagged(prod);
}

function role(name: string): string {
  const p = BY_NAME.get(name);
  if (!p) return name;
  return `${name} (${p.title.replace(/\s*\(defense counsel\)/i, ", defense counsel")})`;
}

const TOPIC: Record<string, string> = {
  "ASC-01": "App Store commission terms", "AST-01": "guideline provisions on purchase communications", "IAP-01": "in-app purchase enforcement",
  "SUP-01": "review guidelines for apps hosting mini-apps", "CGM-01": "review guidelines for game streaming", "MSG-01": "messaging product decisions",
  "SWI-01": "responses to accessory makers", "NFC-01": "third-party NFC access", "MKT-01": "regulatory inquiries", "DMG-01": "pending and anticipated litigation",
};

/** Privilege-safe description (who, to whom, document kind, legal purpose — never the advice itself). */
function describe(d: EDocument): string {
  const topics = (d.coding.issues ?? []).filter((c) => TOPIC[c]).map((c) => TOPIC[c]);
  const topic = topics.length ? topics.slice(0, 2).join(" and ") : "pending and anticipated litigation";
  const noun = d.type === "Memo" ? "Memorandum" : d.type === "Chat" ? "Chat message" : d.type === "Email" ? "Email" : "Document";
  const author = d.from ?? d.custodianName;
  const authorIsCounsel = /counsel/i.test(BY_NAME.get(author)?.title ?? "");
  const to = (d.to ?? []).map(role).join(", ");
  if (d.coding.privilegeBasis === "work-product") return `${noun} prepared by ${role(author)}${authorIsCounsel ? "" : " at the direction of counsel"} in anticipation of litigation concerning ${topic}, reflecting counsel's mental impressions.`;
  if (authorIsCounsel) return `${noun} from ${role(author)}${to ? ` to ${to}` : ""} providing legal advice regarding ${topic}.`;
  return `${noun} from ${role(author)}${to ? ` to ${to}` : ""} requesting legal advice regarding ${topic}.`;
}

/** Defendant's privilege log as received, tracked through the plaintiffs' challenge workflow (draft → review → final). */
export function buildPrivilegeLog(docs: EDocument[]): PrivilegeLogEntry[] {
  const priv = docs.filter((d) => d.coding.privileged === true).sort((a, b) => compareBates(a.bates, b.bates));
  return priv.map((d, i) => {
    const status: PrivilegeLogEntry["status"] = ((d.tags ?? []).includes("privilege-challenge") ? "review" : i % 5 === 4 ? "draft" : "final");
    return tagged<PrivilegeLogEntry>({
      id: `demo_apl_pl_${d.id.replace(/^demo_apl_ed_/, "")}`, matterId: M, docId: d.id, bates: d.batesEnd ? `${d.bates} – ${d.batesEnd}` : d.bates, date: d.date,
      author: d.from ?? d.custodianName, recipients: [...(d.to ?? []), ...(d.cc ?? []).map((c) => `${c} (cc)`)], docType: d.type,
      basis: d.coding.privilegeBasis === "work-product" ? "Work product" : "Attorney-client", description: describe(d), status,
    }, { logEntry: `DEF-PRIV-${String(i + 1).padStart(4, "0")}` });
  });
}

/** Coding protocol shown in Codes & privilege → Coding rules (and used as the AI batch rubric). */
export const APPLE_DEMO_RULES = `# Coding protocol — In re Smartphone App Distribution Antitrust Litigation (consumer class) — DEMO
Plaintiffs' review of defendant's production · Effective 2026-08-10 · Owner: N. Castell / O. Haddad
All documents in this workspace are synthetic demonstration records authored by fictional people.

## Responsiveness (Plaintiffs' RFP Set 1)
Responsive if the document concerns any of:
- The App Store commission (30% / 15%), how it is set, margins, cost-to-serve (RFP 1–3).
- Rules on telling users about or linking to other purchase options; in-app purchase requirement; enforcement (RFP 4–8).
- Super apps / mini-programs and cloud gaming review conditions (RFP 9–11).
- Cross-platform messaging, third-party smartwatch interoperability, NFC / wallet access (RFP 12–16).
- Switching costs, installed base, market definition, consumer research (RFP 17–19).
- Consumer prices, price tiers and pass-through (RFP 20–22).
**Not responsive**: logistics, HR, facilities, travel and personal messages unless they discuss the subjects above.

## Privilege (defendant's assertions)
"Privileged" records the defendant's claim: the document was clawed back under the Rule 502(d) order and appears on its log. Sequester; do not use substantively.
- Counsel merely copied on a business email does **not** make it privileged — code Not Privileged, tag \`privilege-cc\` and add it to the log-challenge batch.
- Tag \`privilege-challenge\` where the log entry looks overbroad (business advice, facts already produced, waiver).

## Hot
Documents likely to be trial exhibits: stated vs. internal rationale, commission-vs-cost evidence, switching and retention motives, instructions to limit disclosure, pass-through.

## Issue codes
ASC-01 commission · AST-01 anti-steering · IAP-01 in-app payments · SUP-01 super apps · CGM-01 cloud gaming · MSG-01 messaging · SWI-01 smartwatch · NFC-01 NFC & wallet · MKT-01 market definition · DMG-01 damages · LEG-01 legal / privilege.

## Families
Code families consistently; an attachment's privilege does not make the transmittal privileged. Exact duplicates inherit the primary's coding.`;

export const APPLE_DEMO_TOPICS = [
  "anti-steering price comparison", "commission cost-to-serve contribution margin", "payment processing cost commission", "small business program threshold",
  "mini-app directory super app", "game streaming per-title review", "cross-platform messaging RCS", "third-party watch notifications retention",
  "NFC tap-to-pay issuer fees", "pass-through price tiers", "switching research messaging watch",
];
