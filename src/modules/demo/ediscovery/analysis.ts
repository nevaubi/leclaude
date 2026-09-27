import type { Conflict, Deposition, EDocument, Relationship, TimelineEvent } from "@/lib/types/domain";
import type { Story, StoryEvidence, StoryFact } from "@/modules/ediscovery/analysis/types";
import { DEMO_DEPOSITIONS, DEMO_MATTERS, DEMO_TEAM } from "../ids";
import type { DocIndex } from "./depo-helpers";
import { BY_NAME, CUST, EXTRA, M, tagged } from "./people";

/**
 * Chronology, people graph, conflicts and the seeded story for the demo matter. Every source is resolved against the
 * built corpus and transcripts (Bates from the document index, excerpts from the actual testimony), so nothing here
 * can cite a document or a page:line that does not exist.
 */

const DEP = DEMO_DEPOSITIONS;
const WITNESS: Record<string, string> = { [DEP.appStorePolicy]: "Marsh", [DEP.paymentsFinance]: "Okoro", [DEP.wearables]: "Frey" };
const P = (k: keyof typeof CUST) => CUST[k].id;
const X = (k: keyof typeof EXTRA) => EXTRA[k].id;

export interface AnalysisContext {
  ix: DocIndex;
  depositions: Deposition[];
}

function testimony(ctx: AnalysisContext, depId: string, page: number, line: number) {
  const dep = ctx.depositions.find((d) => d.id === depId);
  const q = dep?.transcript.find((t) => t.page === page && t.line === line);
  if (!dep || !q) throw new Error(`demo analysis cites missing testimony ${depId} ${page}:${line}`);
  return { dep, qa: q, cite: `${WITNESS[depId]} ${page}:${line}` };
}

/** Exact excerpt from a document (throws when the phrase is not in the text, so excerpts cannot drift). */
function quote(d: EDocument, phrase: string): string {
  if (!d.text.includes(phrase)) throw new Error(`demo analysis: "${phrase.slice(0, 40)}…" is not in ${d.id}`);
  return phrase;
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

type Src = TimelineEvent["sources"][number];

export function buildTimeline(ctx: AnalysisContext): TimelineEvent[] {
  const { ix } = ctx;
  const doc = (slug: string, phrase?: string): Src => { const d = ix.doc(slug); return { kind: "document", id: d.id, bates: d.bates, ...(phrase ? { excerpt: quote(d, phrase) } : {}) }; };
  const depo = (depId: string, page: number, line: number): Src => { const t = testimony(ctx, depId, page, line); return { kind: "deposition", id: depId, cite: t.cite, excerpt: t.qa.answer.slice(0, 220) }; };
  const ext = (cite: string, excerpt?: string): Src => ({ kind: "external", cite, ...(excerpt ? { excerpt } : {}) });
  let n = 0;
  const ev = (date: string, title: string, category: TimelineEvent["category"], significance: TimelineEvent["significance"], sources: Src[], extra: Partial<TimelineEvent> = {}): TimelineEvent => {
    n += 1;
    return tagged<TimelineEvent>({ id: `demo_apl_tl_${String(n).padStart(3, "0")}`, matterId: M, date, title, category, significance, sources, createdBy: "user", verified: true, ...extra });
  };
  const MA = DEP.appStorePolicy, OK = DEP.paymentsFinance, FR = DEP.wearables;
  return [
    ev("2008-07-10", "App Store opens with a 70/30 revenue split for paid apps", "product", 3, [ext("Public record: App Store launch, July 2008")], { description: "Background. The standard 30% commission has been unchanged since launch (see FY2017 contribution summary para. 5(a)).", precision: "month" }),
    ev("2016-03-01", "Wallet issuer agreement bars issuers from other contactless presentment on the device", "corporate", 3, [doc("c02", "Issuer shall not enable contactless presentment of provisioned cards on the device other than through the wallet.")], { personIds: [P("reyes")] }),
    ev("2016-06-02", "Finance models the year-two 15% subscription rate", "corporate", 3, [doc("k01", "most subscription revenue is still in first-year cohorts"), doc("k02")], { personIds: [P("okoro"), X("whitaker"), X("lindqvist")] }),
    ev("2016-06-15", "Year-two subscription commission reduced to 15% (public announcement)", "product", 2, [ext("Public record: developer announcement, June 2016")], { precision: "month" }),
    ev("2016-09-12", "Policy annotation treats a price mention without a link as steering", "corporate", 2, [doc("a01", "\"Direct\" includes price comparisons that name a lower price elsewhere, even without a link.")], { personIds: [P("marsh")] }),
    ev("2016-10-25", "Messaging scoped a client for the other major platform: feasible in ~9 months; leadership sees switching cost", "product", 5, [doc("m02", "shipping this makes switching easier, and we would be paying for it."), doc("m01")], { personIds: [P("nand"), X("hartley"), X("calloway")] }),
    ev("2016-11-08", "Wallet memo: keep the NFC controller closed; issuer fees depend on exclusivity", "corporate", 4, [doc("n01", "Issuer fees on wallet transactions depend on the wallet being the only way to tap to pay.")], { personIds: [P("reyes")] }),
    ev("2017-01-12", "Cross-platform messaging client deferred indefinitely; fallback fixes also withheld", "product", 4, [doc("m03", "improving the cross-platform experience undercuts the reason not to ship the client.")], { personIds: [X("hartley"), P("nand")] }),
    ev("2017-03-16", "Watch Connectivity: third-party watch limits are 'policy, not physics'", "communication", 4, [doc("w03", "the background limits on third-party watches are policy, not physics."), depo(FR, 28, 5)], { personIds: [X("morita"), P("frey"), X("kowal")] }),
    ev("2017-04-06", "Tandem Pay's request for tap-to-pay answered with security rationale only", "communication", 3, [doc("n02"), doc("n03", "Keep it to security and the provisioning alternative; do not discuss fees or timing.")], { personIds: [P("reyes"), X("ferreira"), X("mehta")] }),
    ev("2017-05-09", "Marsh rejects Kitebird's web-price text: 'the price comparison does the work for them'", "communication", 5, [doc("a03", "the price comparison does the work for them and the purchase leaves the app."), doc("a02"), depo(MA, 22, 5)], { personIds: [P("marsh"), P("ames"), X("solberg")] }),
    ev("2017-08-30", "Switching research: messaging (47%), app repurchases (39%) and the watch (22%) keep users", "scientific", 4, [doc("x01", "Group messaging with friends/family would not work the same"), depo(MA, 151, 6)], { personIds: [P("marsh")] }),
    ev("2017-09-12", "Services offsite: 'Purchases made in the store stay with the platform. Web purchases travel.'", "corporate", 4, [doc("pr01", "Purchases made in the store stay with the platform. Web purchases travel."), depo(MA, 157, 3)], { personIds: [X("whitaker"), P("marsh")] }),
    ev("2017-11-06", "Finance: payment processing is 2.5–3.5% of gross against a 30% commission", "corporate", 5, [doc("p01", "averaged 2.5%–3.5% of gross purchase value"), depo(OK, 29, 5)], { personIds: [P("okoro")] }),
    ev("2018-02-14", "FY2017 contribution summary: 85.2 per 100 of commission before shared engineering", "corporate", 5, [doc("k03", "The commission rate is not set by reference to cost."), depo(OK, 36, 10), depo(OK, 37, 4)], { personIds: [P("okoro"), X("lindqvist")] }),
    ev("2018-02-15", "Instruction to keep the contribution margin off the board slide", "communication", 4, [doc("k04", "Graham asked that the contribution margin line stay off the board slide."), depo(OK, 60, 12)], { personIds: [X("lindqvist"), P("okoro"), X("whitaker")], disputed: true, description: "Okoro testified the line was left off 'for space' (60:12); the email gives a different reason." }),
    ev("2018-05-30", "Kowal declines Pulsewear: watch keeps customers on the phone; 'cite privacy and battery'", "communication", 5, [doc("w06", "When you respond to Ines, cite privacy and battery. Both are true enough."), depo(FR, 51, 4), depo(FR, 23, 8)], { personIds: [X("kowal"), P("frey"), X("moreau")], disputed: true }),
    ev("2018-07-17", "Draft rationale memo: 'main effect' of enforcement is to protect the commission", "communication", 4, [doc("a07", "The main effect of consistent enforcement is to protect the commission on digital purchases"), depo(MA, 31, 5)], { personIds: [P("marsh")] }),
    ev("2018-07-19", "Final anti-steering rationale memo leads with user trust; commission effect kept internal", "corporate", 4, [doc("a05", "externally, the trust rationale is the one we explain"), depo(MA, 35, 1)], { personIds: [P("marsh"), X("whitaker"), X("park")] }),
    ev("2018-10-04", "Mini-app memo: a host-app directory is a 'store-within-a-store' that makes switching easier", "corporate", 4, [doc("s02", "If users' most-used services live inside a host app that works everywhere, the device matters less and switching gets easier."), depo(MA, 45, 3)], { personIds: [P("marsh"), X("solberg")] }),
    ev("2018-10-05", "Whitaker holds Kitebird's build: 'they won't be able to'", "communication", 4, [doc("s03", "If they can live with it, fine — they won't be able to."), depo(MA, 48, 2)], { personIds: [X("whitaker"), P("marsh")] }),
    ev("2019-01-15", "Outbound switching falls to 4.4% while store spend per device rises", "scientific", 2, [doc("x02", "outbound switching has declined every year")], { personIds: [P("okoro")] }),
    ev("2019-02-11", "Finance models revenue at risk if third-party payment processors were allowed", "corporate", 3, [doc("p02", "The big number is not the commission rate; it is leakage."), doc("p03")], { personIds: [P("okoro"), X("lindqvist")] }),
    ev("2019-04-22", "Board Services review presents growth without margin or cost information", "corporate", 3, [doc("k10", "Protect the integrity of in-app purchase")], { personIds: [X("whitaker")] }),
    ev("2019-06-06", "Known cross-platform messaging gaps catalogued; every fix 'Not planned'", "product", 3, [doc("m05", "Group threads split on reply"), doc("m04")], { personIds: [P("nand"), X("calloway")] }),
    ev("2019-08-12", "Wearables strategy deck: 24-month retention 94% (watch owners) vs. 83%", "corporate", 4, [doc("w07", "Opening watch interfaces to third parties would reduce this advantage."), depo(FR, 81, 3)], { personIds: [P("frey"), X("kowal")] }),
    ev("2019-09-10", "Policy memo recommends a small-developer rate but not relaxing purchase communication limits", "corporate", 3, [doc("k05", "That change affects the entire commission base, not a tier."), depo(MA, 59, 8)], { personIds: [P("marsh"), X("whitaker")] }),
    ev("2019-11-19", "Streaming memo: per-title review 'unworkable' — 'a feature, not a bug'", "communication", 4, [doc("g02", "Several people here see that as a feature, not a bug"), depo(MA, 113, 4)], { personIds: [P("lee"), P("marsh"), X("whitaker"), X("petrakis")] }),
    ev("2020-03-03", "Pass-through analysis: prices rose in 64% of cases after proceeds fell", "scientific", 5, [doc("d01", "Where proceeds fell, prices rose in 64% of cases"), depo(OK, 88, 4), depo(OK, 142, 3)], { personIds: [P("okoro")], description: "Admission at 88:4 narrowed on cross at 142:3 (top-grossing apps only)." }),
    ev("2020-08-24", "Enforcement against a game developer's in-app direct payment option", "corporate", 3, [doc("p04", "We are not changing the guideline or making exceptions.")], { personIds: [P("marsh"), X("whitaker"), P("ames")] }),
    ev("2020-08-25", "Legal hold issued to App Store, payments and interoperability custodians", "litigation", 2, [doc("l09")], { personIds: [P("cole")] }),
    ev("2020-09-11", "Streaming guideline requires a separate listing for each streamed game", "product", 4, [doc("g04", "each streamed game offered as a separate app"), ext("Public record: App Review Guidelines update, September 2020")], { personIds: [P("lee"), X("petrakis")] }),
    ev("2020-09-14", "Games BD: providers go browser-only — 'that was the idea'", "communication", 4, [doc("g05", "that was the idea")], { personIds: [P("lee"), X("whitaker")] }),
    ev("2020-09-28", "Small Business Program scenarios: ~98% of developers for ~2.4 points of commission", "corporate", 4, [doc("k06", "At $1M the program reaches ~98% of developers for ~2.4 points of commission."), depo(OK, 101, 4)], { personIds: [P("okoro")], disputed: true, description: "Okoro dated her first sight of SBP modelling to November 2020 (101:4)." }),
    ev("2020-11-03", "Small Business Program messaging plan; counsel only copied", "communication", 3, [doc("k07", "Hannah, copying you so you have the timing."), depo(MA, 75, 3)], { personIds: [P("marsh"), P("ames"), X("whitaker"), P("cole")] }),
    ev("2020-11-18", "Small Business Program: 15% for developers under the proceeds threshold", "product", 3, [doc("c01", "the commission on paid apps and in-app purchases is 15% of the customer price"), ext("Public record: program announcement, November 2020")], { personIds: [P("marsh")] }),
    ev("2021-03-18", "First cost-to-serve estimate: 13–16 cents of direct cost per dollar of commission", "corporate", 4, [doc("k09", "First time this estimate has been assembled"), depo(OK, 45, 2)], { personIds: [P("okoro")] }),
    ev("2021-04-19", "Audit & Finance Committee: commission is the largest contributor to services gross margin", "corporate", 2, [doc("b02", "Store commission remains the largest single contributor to services gross margin.")], { personIds: [X("lindqvist")] }),
    ev("2021-09-14", "Reader apps to get a single account-management link", "product", 2, [doc("a08")], { personIds: [P("ames"), X("park")] }),
    ev("2022-01-20", "Link entitlement tracked as a 'pressure valve'; fees of 20–27% on linked purchases modelled", "communication", 4, [doc("a09", "the entitlement is a pressure valve we can point to"), doc("a10"), depo(MA, 132, 2)], { personIds: [P("marsh"), P("okoro")] }),
    ev("2022-06-15", "Finance: tier update should not be described as price-neutral for consumers", "communication", 3, [doc("d02", "We should not describe the update as price-neutral for consumers."), depo(OK, 153, 19)], { personIds: [P("okoro"), X("lindqvist")] }),
    ev("2022-09-09", "RCS declined for the next cycle: 'not in a hurry to erase it'", "communication", 4, [doc("m07", "we're not in a hurry to erase it"), doc("m06")], { personIds: [X("hartley"), P("nand")] }),
    ev("2024-03-21", "United States and states file monopolization action against Apple (D.N.J.)", "litigation", 3, [ext("Public record: United States v. Apple Inc. (D.N.J., filed March 2024)", `Related government action tracked for coordination (${DEMO_MATTERS.doj}).`)], { description: "Coordination reference only; this workspace's matter is the consumer class action." }),
    ev("2026-04-14", "Marsh deposition: early admission on anti-steering purpose, qualified after lunch", "testimony", 4, [depo(MA, 18, 4), depo(MA, 97, 3), depo(MA, 64, 10)], { personIds: [P("marsh")], disputed: true }),
    ev("2026-05-20", "Okoro deposition: no cost comparison before 2021; commission did not track costs", "testimony", 4, [depo(OK, 41, 3), depo(OK, 88, 4)], { personIds: [P("okoro")] }),
    ev("2026-07-09", "Frey deposition: 'only reasons' were battery and privacy, then Kowal's retention rationale", "testimony", 4, [depo(FR, 23, 8), depo(FR, 51, 4), depo(FR, 58, 6)], { personIds: [P("frey")], disputed: true }),
  ];
}

// ---------------------------------------------------------------------------
// Relationships (explicit org / counsel / counterpart edges + edges derived from headers)
// ---------------------------------------------------------------------------

export function buildRelationships(ctx: AnalysisContext, docs: EDocument[]): Relationship[] {
  const { ix } = ctx;
  const ev = (slug: string, excerpt?: string) => { const d = ix.doc(slug); return { bates: d.bates, docId: d.id, ...(excerpt ? { excerpt: quote(d, excerpt) } : { excerpt: d.subject }) }; };
  const tv = (depId: string, page: number, line: number) => { const t = testimony(ctx, depId, page, line); return { excerpt: `${t.cite}: ${t.qa.answer.slice(0, 140)}` }; };
  const rel = (slug: string, fromId: string, toId: string, kind: Relationship["kind"], weight: number, label?: string, evidence?: Relationship["evidence"]): Relationship =>
    tagged<Relationship>({ id: `demo_apl_rel_${slug}`, matterId: M, fromId, toId, kind, weight, ...(label ? { label } : {}), ...(evidence ? { evidence } : {}) });
  const MA = DEP.appStorePolicy, OK = DEP.paymentsFinance, FR = DEP.wearables;
  const explicit: Relationship[] = [
    rel("org_01", P("marsh"), X("whitaker"), "reports_to", 3, "Director, App Store Policy → VP, App Store Business", [tv(MA, 7, 15)]),
    rel("org_02", P("ames"), X("whitaker"), "reports_to", 2, "Developer Relations → VP, App Store Business"),
    rel("org_03", P("lee"), X("whitaker"), "reports_to", 2, "Games & Streaming BD → VP, App Store Business", [ev("x03")]),
    rel("org_04", P("okoro"), X("lindqvist"), "reports_to", 3, "App Store Payments Finance → Services Finance", [tv(OK, 7, 17)]),
    rel("org_05", P("frey"), X("kowal"), "reports_to", 3, "Wearables Interoperability → Wearables Product", [tv(FR, 7, 2)]),
    rel("org_06", X("morita"), X("kowal"), "reports_to", 1, "Watch Connectivity (dotted line)", [ev("w03")]),
    rel("org_07", P("nand"), X("hartley"), "reports_to", 3, "Messaging Engineering → Messaging Product", [ev("m03")]),
    rel("org_08", X("calloway"), P("nand"), "reports_to", 2, "Messaging engineer → engineering manager", [ev("m04")]),
    rel("org_09", X("ferreira"), P("reyes"), "reports_to", 2, "Wallet partnerships → Wallet & NFC product lead", [ev("n03")]),
    rel("org_10", P("cole"), X("adeyemi"), "reports_to", 2, "Senior Counsel → Associate General Counsel"),
    rel("sup_01", X("whitaker"), P("marsh"), "supervises", 3),
    rel("sup_02", X("kowal"), P("frey"), "supervises", 3, undefined, [ev("w06")]),
    rel("sup_03", X("lindqvist"), P("okoro"), "supervises", 3, undefined, [ev("k04")]),
    rel("sup_04", X("hartley"), P("nand"), "supervises", 3, undefined, [ev("m03")]),
    // Counsel
    rel("rep_01", X("mercer"), P("marsh"), "represents", 3, "Defending deposition (14 Apr 2026)", [tv(MA, 170, 1)]),
    rel("rep_02", X("mercer"), P("okoro"), "represents", 3, "Defending deposition (20 May 2026)", [tv(OK, 135, 1)]),
    rel("rep_03", X("mercer"), P("frey"), "represents", 3, "Defending deposition (9 Jul 2026)", [tv(FR, 115, 1)]),
    rel("rep_04", P("cole"), P("marsh"), "represents", 2, "In-house competition advice (logged; clawed back)", [ev("l02"), ev("l14")]),
    rel("rep_05", P("cole"), P("okoro"), "represents", 2, "In-house advice to Finance (logged)", [ev("k08"), ev("l11")]),
    rel("rep_06", X("adeyemi"), P("marsh"), "represents", 2, "Enforcement advice (logged)", [ev("p05")]),
    rel("ret_01", DEMO_TEAM.associate, X("varga"), "retained", 3, "Class counsel retained Dr. Varga (class-wide impact and damages)"),
    rel("ret_02", X("mercer"), X("hendry"), "retained", 2, "Defense retained Dr. Hendry (market definition, pass-through)", [ev("l21")]),
    // Counterparties
    rel("cp_01", P("ames"), X("solberg"), "other", 3, "Kitebird escalations (web pricing, mini-programs)", [ev("a02"), ev("a04"), ev("s01")]),
    rel("cp_02", P("lee"), X("petrakis"), "other", 2, "Streamforge catalog streaming submission", [ev("g01"), ev("g04")]),
    rel("cp_03", P("frey"), X("moreau"), "other", 2, "Pulsewear interoperability requests", [ev("w04")]),
    rel("cp_04", P("reyes"), X("mehta"), "other", 2, "Tandem Pay NFC access request", [ev("n02")]),
    // Meetings
    rel("mtg_01", P("lee"), P("marsh"), "meeting", 1, "16 Jan 2020 streaming policy review", [ev("g03")]),
    rel("mtg_02", P("lee"), X("whitaker"), "meeting", 1, "16 Jan 2020 streaming policy review", [ev("g03")]),
    rel("mtg_03", P("reyes"), X("ferreira"), "meeting", 1, "21 Apr 2020 wallet access review", [ev("n07")]),
    // Testimony about
    rel("test_01", P("marsh"), X("whitaker"), "testified_about", 3, "Mini-app hold; 'they won't be able to'", [tv(MA, 48, 2)]),
    rel("test_02", P("marsh"), P("ames"), "testified_about", 2, "Kitebird rejection instructions", [tv(MA, 22, 18)]),
    rel("test_03", P("marsh"), P("cole"), "testified_about", 2, "Counsel copied only (SBP messaging, link tracking)", [tv(MA, 75, 3), tv(MA, 132, 20)]),
    rel("test_04", P("okoro"), X("lindqvist"), "testified_about", 3, "Board slide instruction", [tv(OK, 60, 12)]),
    rel("test_05", P("okoro"), P("marsh"), "testified_about", 3, "No one was told the commission tracked costs (contradicts Marsh 64:10)", [tv(OK, 41, 3)]),
    rel("test_06", P("frey"), X("kowal"), "testified_about", 3, "Pulsewear decision and stated reasons", [tv(FR, 51, 4)]),
    rel("test_07", P("frey"), X("morita"), "testified_about", 2, "'Policy, not physics'", [tv(FR, 28, 5)]),
    rel("exp_01", X("varga"), P("okoro"), "other", 1, "Relies on Finance analyses (contribution, pass-through)", [ev("k03"), ev("d01")]),
  ];
  // Derived: from → to (emailed) and from → cc (cc), aggregated per pair, only between known people of this matter.
  const agg = new Map<string, Relationship>();
  for (const d of docs) {
    if (d.isDuplicateOf) continue;
    const from = d.from ? BY_NAME.get(d.from) : undefined;
    if (!from) continue;
    const add = (name: string, kind: "emailed" | "cc") => {
      const to = BY_NAME.get(name);
      if (!to || to.id === from.id) return;
      const key = `${from.key}|${to.key}|${kind}`;
      let r = agg.get(key);
      if (!r) { r = tagged<Relationship>({ id: `demo_apl_rel_mail_${kind}_${from.key}_${to.key}`, matterId: M, fromId: from.id, toId: to.id, kind, weight: 0, evidence: [] }); agg.set(key, r); }
      r.weight += 1;
      if ((r.evidence?.length ?? 0) < 6) r.evidence!.push({ bates: d.bates, docId: d.id, excerpt: d.subject });
    };
    for (const t of d.to ?? []) add(t, "emailed");
    for (const c of d.cc ?? []) add(c, "cc");
  }
  return [...explicit, ...Array.from(agg.values()).sort((a, b) => a.id.localeCompare(b.id))];
}

// ---------------------------------------------------------------------------
// Conflicts
// ---------------------------------------------------------------------------

export function buildConflicts(ctx: AnalysisContext): Conflict[] {
  const { ix } = ctx;
  type Side = Conflict["sides"][number];
  const depo = (label: string, depId: string, page: number, line: number): Side => { const t = testimony(ctx, depId, page, line); return { label, sourceKind: "deposition", sourceId: depId, cite: t.cite, excerpt: t.qa.answer }; };
  const doc = (label: string, slug: string, phrase: string): Side => { const d = ix.doc(slug); return { label, sourceKind: "document", sourceId: d.id, cite: d.bates, excerpt: quote(d, phrase) }; };
  const cf = (n: number, c: Omit<Conflict, "id" | "matterId" | "createdBy">): Conflict => tagged<Conflict>({ id: `demo_apl_cf_${String(n).padStart(2, "0")}`, matterId: M, createdBy: "user", ...c });
  const MA = DEP.appStorePolicy, OK = DEP.paymentsFinance, FR = DEP.wearables;
  return [
    cf(1, {
      kind: "testimony_vs_testimony", severity: "high", status: "open",
      title: "Marsh: Finance said the commission 'roughly tracked' the cost of the store vs. Okoro: no one compared the rate to costs, and it did not track them",
      sides: [depo("Marsh testimony", MA, 64, 10), depo("Okoro testimony", OK, 41, 3), doc("FY2017 contribution summary", "k03", "The commission rate is not set by reference to cost.")],
      analysis: "The two witnesses cannot both be right. Okoro's account is corroborated by her own contribution summary (direct costs 14.8 per 100 of commission) and by the 2021 estimate describing itself as the first such comparison. Marsh could not name who in Finance told her (65:2) and served an errata softening 64:10 to 'someone in Finance'. Use in the class certification reply to show the rate is untethered from cost.",
    }),
    cf(2, {
      kind: "testimony_vs_document", severity: "high", status: "open",
      title: "Frey: battery and privacy are the only reasons for third-party watch limits vs. Kowal's retention rationale and Morita's 'policy, not physics'",
      sides: [depo("Frey testimony", FR, 23, 8), doc("Kowal email, 30 May 2018", "w06", "The watch is one of the best reasons people stay on the phone; a third-party watch that works just as well removes that reason."), doc("Morita email, 16 Mar 2017", "w03", "the background limits on third-party watches are policy, not physics.")],
      analysis: "Frey's categorical answer is contradicted by his director's stated reason and by his engineering lead's feasibility estimate. He acknowledged Kowal's reasoning (51:4) and that he cited privacy and battery as instructed (51:20) but refused to withdraw 23:8 (58:6). Strong impeachment sequence for trial: 23:8 → Frey-6 → 51:20 → 58:6.",
    }),
    cf(3, {
      kind: "testimony_vs_document", severity: "high", status: "open",
      title: "Marsh 97:3: user trust is the main purpose of anti-steering vs. her 2017 email and first draft",
      sides: [depo("Marsh qualification", MA, 97, 3), doc("Marsh email, 9 May 2017", "a03", "If they can tell users the price is lower on the web, the price comparison does the work for them and the purchase leaves the app."), doc("Rationale memo draft v1", "a07", "The main effect of consistent enforcement is to protect the commission on digital purchases")],
      analysis: "The qualification tracks the final memo's external framing but is inconsistent with the contemporaneous email (no mention of trust, 98:1) and the first draft. It was offered after a lunch-break conversation with counsel (99:2–99:16). Preserve both 18:4 and 97:3; argue the contemporaneous documents show the operative purpose.",
    }),
    cf(4, {
      kind: "position_inconsistency", severity: "medium", status: "open",
      title: "Marsh 18:4 (purpose was to keep the purchase in the app) vs. Marsh 97:3 (purpose is user trust; commission is an effect)",
      sides: [depo("Marsh, morning session", MA, 18, 4), depo("Marsh, after lunch", MA, 97, 3)],
      analysis: "Late qualification by the same witness. Neither passage supersedes the other on this record; digests and designations must cite both. The qualification does not withdraw the admission that keeping the purchase in the app was a purpose.",
    }),
    cf(5, {
      kind: "document_vs_document", severity: "medium", status: "open",
      title: "Rationale memo draft v1 ('main effect … protect the commission') vs. final ('also protects the commission')",
      sides: [doc("Draft v1, 17 Jul 2018", "a07", "The main effect of consistent enforcement is to protect the commission on digital purchases"), doc("Final, 19 Jul 2018", "a05", "Consistent enforcement also protects the commission on digital purchases.")],
      analysis: "The only substantive change between drafts is paragraph 3. Defendant logged counsel's comments of 18 Jul 2018 (clawed back); the edit itself is visible in the produced drafts. Consider a privilege challenge on the business portion of the comments.",
    }),
    cf(6, {
      kind: "testimony_vs_document", severity: "high", status: "open",
      title: "Okoro: margin line left off the board slide 'for space' vs. Lindqvist: kept off because it 'invites a conversation about the rate'",
      sides: [depo("Okoro testimony", OK, 60, 12), doc("Lindqvist email, 15 Feb 2018", "k04", "that is the story the board has seen before and it does not invite a conversation about the rate.")],
      analysis: "The email records an instruction from the VP and a reason unrelated to space. Okoro conceded the email says nothing about space (61:3). Supports an inference that margin information was deliberately withheld from the board.",
    }),
    cf(7, {
      kind: "date_inconsistency", severity: "medium", status: "open",
      title: "Okoro dates first SBP modelling to November 2020, after the decision; her team's deck is dated 28 September 2020",
      sides: [depo("Okoro testimony", OK, 101, 4), doc("SBP scenarios deck", "k06", "Prepare announcement materials for November.")],
      analysis: "The witness conceded she may have misremembered (101:15). The September date shows the program's reach-versus-cost trade-off was modelled before the decision, undercutting the 'listening to small developers' framing in the messaging email.",
    }),
    cf(8, {
      kind: "testimony_vs_document", severity: "medium", status: "open",
      title: "Marsh: commission 'never came into' the mini-app restriction vs. her memo's 'do not review and do not collect on'",
      sides: [depo("Marsh testimony", MA, 52, 4), doc("Mini-app policy memo", "s02", "A host app with its own directory, identity and payments becomes a distribution channel we do not review and do not collect on.")],
      analysis: "Her own memo lists the store-within-a-store and switching concerns as 'the business reasons' to be kept internal (45:3). Her reading of 'collect on' (52:20) is strained.",
    }),
  ];
}

// ---------------------------------------------------------------------------
// Story (analysis module chronology narrative)
// ---------------------------------------------------------------------------

export function buildStory(ctx: AnalysisContext, timeline: TimelineEvent[]): Story {
  const { ix } = ctx;
  const d = (slug: string, phrase?: string): StoryEvidence => { const x = ix.doc(slug); return { kind: "document", docId: x.id, bates: x.bates, ...(phrase ? { excerpt: quote(x, phrase) } : {}) }; };
  const t = (depId: string, page: number, line: number): StoryEvidence => { const r = testimony(ctx, depId, page, line); return { kind: "testimony", depositionId: depId, witness: r.dep.witnessName, page, line }; };
  const e = (title: string): StoryEvidence => { const ev = timeline.find((x) => x.title === title); if (!ev) throw new Error(`demo story: no timeline event "${title}"`); return { kind: "event", eventId: ev.id, title: ev.title }; };
  let n = 0;
  const fact = (date: string, text: string, evidence: StoryEvidence[], extra: Partial<StoryFact> = {}): StoryFact => { n += 1; return { id: `demo_apl_sf_${String(n).padStart(2, "0")}`, order: n, date, precision: "day", text, evidence, confidence: 0.9, verified: true, origin: "timeline", ...extra }; };
  const MA = DEP.appStorePolicy, OK = DEP.paymentsFinance, FR = DEP.wearables;
  return {
    id: "demo_apl_story_platform", matterId: M, title: "How the platform rules protected the commission and raised the cost of switching",
    theme: "Anti-steering, in-app payment and interoperability limits, 2016–2022 (plaintiffs' theory of the case)",
    createdAt: "2026-08-28T15:00:00.000Z", updatedAt: "2026-09-18T10:30:00.000Z", createdBy: DEMO_TEAM.associate,
    meta: { seeded: true, demo: "apple-antitrust", synthetic: true },
    facts: [
      fact("2016-10-25", "Messaging engineering found a client for the other major platform feasible in about nine months; leadership viewed it as removing a switching cost and deferred it.", [d("m02", "shipping this makes switching easier, and we would be paying for it."), d("m03"), e("Messaging scoped a client for the other major platform: feasible in ~9 months; leadership sees switching cost")], { personIds: [P("nand"), X("hartley")] }),
      fact("2016-11-08", "Wallet kept the NFC controller closed to third-party payment apps; the memo ties issuer fees to exclusivity.", [d("n01"), d("c02"), e("Wallet memo: keep the NFC controller closed; issuer fees depend on exclusivity")], { personIds: [P("reyes")] }),
      fact("2017-05-09", "Policy rejected a one-line statement of a lower web price because the comparison would move purchases out of the app.", [d("a03", "the price comparison does the work for them and the purchase leaves the app."), t(MA, 22, 5), t(MA, 18, 4), e("Marsh rejects Kitebird's web-price text: 'the price comparison does the work for them'")], { personIds: [P("marsh"), P("ames")] }),
      fact("2017-11-06", "Payment processing cost 2.5–3.5% of gross, about a tenth of the 30% commission.", [d("p01"), t(OK, 29, 5), e("Finance: payment processing is 2.5–3.5% of gross against a 30% commission")], { personIds: [P("okoro")], confidence: 0.95 }),
      fact("2018-02-14", "Direct costs were 14.8 per 100 of commission; the rate was 'not set by reference to cost', and the margin was kept off the board slide.", [d("k03"), d("k04"), t(OK, 37, 4), t(OK, 41, 3), t(MA, 64, 10)], { personIds: [P("okoro"), X("lindqvist")], disputed: true, confidence: 0.85 }),
      fact("2018-05-30", "Third-party watch limits were kept because the watch retains phone customers; privacy and battery were the reasons given externally.", [d("w06"), d("w03"), t(FR, 23, 8), t(FR, 51, 4), e("Kowal declines Pulsewear: watch keeps customers on the phone; 'cite privacy and battery'")], { personIds: [X("kowal"), P("frey")], disputed: true }),
      fact("2018-07-19", "The anti-steering rationale memo led externally with user trust while recording that enforcement protects the commission; the first draft called that the 'main effect'.", [d("a07"), d("a05"), t(MA, 97, 3), t(MA, 31, 5)], { personIds: [P("marsh")], disputed: true, confidence: 0.85 }),
      fact("2018-10-04", "A super-app directory was restricted as a 'store-within-a-store' that would make switching easier.", [d("s02"), d("s03"), t(MA, 45, 3), t(MA, 52, 4)], { personIds: [P("marsh"), X("whitaker")] }),
      fact("2019-11-19", "Per-title review for streamed games was adopted knowing it would keep catalog streaming off the platform.", [d("g02"), d("g05"), e("Games BD: providers go browser-only — 'that was the idea'")], { personIds: [P("lee"), X("whitaker")] }),
      fact("2020-03-03", "Finance's own analysis showed developers move consumer prices when proceeds change — evidence of pass-through for class-wide impact (narrowed on cross to top-grossing apps).", [d("d01"), t(OK, 88, 4), t(OK, 142, 3)], { personIds: [P("okoro")], confidence: 0.8 }),
      fact("2022-01-20", "The reader-app link was tracked as a 'pressure valve' for regulators while fees on linked purchases were modelled.", [d("a09"), d("a10"), t(MA, 132, 2)], { personIds: [P("marsh"), P("okoro")] }),
    ],
  };
}
