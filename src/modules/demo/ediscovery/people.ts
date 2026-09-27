import type { Person } from "@/lib/types/domain";
import { DEMO_CUSTODIANS, DEMO_EXPERTS, DEMO_MATTERS, DEMO_PACK, DEMO_TEAM } from "../ids";

/**
 * People of the Apple antitrust demonstration matter. Every name here is FICTIONAL: the defendant-side custodians,
 * their colleagues, counterparties, experts and defense counsel are invented for the demo and never stand for real
 * executives, employees, attorneys or judges.
 */

export const M = DEMO_MATTERS.consumer;

/** Tag stored on every demo record. */
export const DEMO_META = { demo: DEMO_PACK, synthetic: true } as const;
export type DemoMeta = { demo: typeof DEMO_PACK; synthetic: true; [k: string]: unknown };

/** Adds the demo tag to a record (the shared domain types that lack `meta` still round-trip it through the db). */
export function tagged<T extends object>(x: T, extra: Record<string, unknown> = {}): T & { meta: DemoMeta } {
  const prev = (x as { meta?: Record<string, unknown> }).meta ?? {};
  return { ...x, meta: { ...prev, ...extra, ...DEMO_META } };
}

/**
 * Bates prefix used for the defendant's production in the demo corpus. The contract value `DEMO_BATES_PREFIX`
 * ("APL-DEMO") contains a hyphen, which the review services reject (`normalizeBatesPrefix` and `parseBates` accept
 * 2–8 letters) and which the testimony cross-reference scanner cannot match (2–6 letters). "APLD" satisfies every
 * Bates parser in the app, so range search, settings, cross references and citation resolution all work.
 */
export const APPLE_DEMO_BATES_PREFIX = "APLD";
export const APPLE_DEMO_BATES_WIDTH = 7;

const DOMAIN = "apple.example";

export interface DemoPerson { key: string; id: string; name: string; title: string; org: string; email?: string; role: Person["role"]; tags?: string[] }

const CO = "Apple Inc. (demo)";

/** The eight defendant-side custodians (ids fixed by the demo contract). */
export const CUST = {
  marsh: { key: "marsh", id: DEMO_CUSTODIANS.appStorePolicy, name: "Lena Marsh", title: "Director, App Store Policy", org: CO, email: `lmarsh@${DOMAIN}`, role: "custodian" },
  ames: { key: "ames", id: DEMO_CUSTODIANS.developerRelations, name: "Victor Ames", title: "Senior Manager, Developer Relations", org: CO, email: `vames@${DOMAIN}`, role: "custodian" },
  okoro: { key: "okoro", id: DEMO_CUSTODIANS.paymentsFinance, name: "Rachel Okoro", title: "Finance Lead, App Store Payments", org: CO, email: `rokoro@${DOMAIN}`, role: "custodian" },
  frey: { key: "frey", id: DEMO_CUSTODIANS.wearables, name: "Daniel Frey", title: "Product Manager, Wearables Interoperability", org: CO, email: `dfrey@${DOMAIN}`, role: "custodian" },
  nand: { key: "nand", id: DEMO_CUSTODIANS.messaging, name: "Priya Nand", title: "Engineering Manager, Messaging", org: CO, email: `pnand@${DOMAIN}`, role: "custodian" },
  reyes: { key: "reyes", id: DEMO_CUSTODIANS.walletNfc, name: "Tomas Reyes", title: "Product Lead, Wallet & NFC", org: CO, email: `treyes@${DOMAIN}`, role: "custodian" },
  cole: { key: "cole", id: DEMO_CUSTODIANS.legal, name: "Hannah Cole", title: "Senior Counsel, Competition", org: CO, email: `hcole@${DOMAIN}`, role: "custodian" },
  lee: { key: "lee", id: DEMO_CUSTODIANS.gaming, name: "Marcus Lee", title: "Business Development, Games & Streaming", org: CO, email: `mlee@${DOMAIN}`, role: "custodian" },
} as const satisfies Record<string, DemoPerson>;
export type CustKey = keyof typeof CUST;
export const CUSTODIAN_ORDER: CustKey[] = ["marsh", "ames", "okoro", "lee", "nand", "frey", "reyes", "cole"];

/** Fictional non-custodian colleagues, counterparties, experts and counsel. */
export const EXTRA = {
  whitaker: { key: "whitaker", id: "demo_apl_p_whitaker", name: "Graham Whitaker", title: "Vice President, App Store Business", org: CO, email: `gwhitaker@${DOMAIN}`, role: "witness", tags: ["non-custodian"] },
  lindqvist: { key: "lindqvist", id: "demo_apl_p_lindqvist", name: "Sofia Lindqvist", title: "Senior Manager, Services Finance", org: CO, email: `slindqvist@${DOMAIN}`, role: "witness", tags: ["non-custodian"] },
  park: { key: "park", id: "demo_apl_p_park", name: "Jae Park", title: "Manager, App Review", org: CO, email: `jpark@${DOMAIN}`, role: "witness", tags: ["non-custodian"] },
  calloway: { key: "calloway", id: "demo_apl_p_calloway", name: "Ben Calloway", title: "Senior Software Engineer, Messaging", org: CO, email: `bcalloway@${DOMAIN}`, role: "witness", tags: ["non-custodian"] },
  hartley: { key: "hartley", id: "demo_apl_p_hartley", name: "Owen Hartley", title: "Director, Messaging Product", org: CO, email: `ohartley@${DOMAIN}`, role: "witness", tags: ["non-custodian"] },
  kowal: { key: "kowal", id: "demo_apl_p_kowal", name: "Beatrice Kowal", title: "Senior Director, Wearables Product", org: CO, email: `bkowal@${DOMAIN}`, role: "witness", tags: ["non-custodian"] },
  morita: { key: "morita", id: "demo_apl_p_morita", name: "Kenji Morita", title: "Engineering Lead, Watch Connectivity", org: CO, email: `kmorita@${DOMAIN}`, role: "witness", tags: ["non-custodian"] },
  ferreira: { key: "ferreira", id: "demo_apl_p_ferreira", name: "Alicia Ferreira", title: "Partnerships Manager, Wallet", org: CO, email: `aferreira@${DOMAIN}`, role: "witness", tags: ["non-custodian"] },
  adeyemi: { key: "adeyemi", id: "demo_apl_p_adeyemi", name: "Ruth Adeyemi", title: "Associate General Counsel, Litigation", org: CO, email: `radeyemi@${DOMAIN}`, role: "opposing", tags: ["in-house counsel"] },
  solberg: { key: "solberg", id: "demo_apl_p_solberg", name: "Mira Solberg", title: "Chief Executive Officer", org: "Kitebird Labs (fictional)", email: "mira@kitebird.example", role: "other", tags: ["developer"] },
  petrakis: { key: "petrakis", id: "demo_apl_p_petrakis", name: "Jonah Petrakis", title: "Head of Partnerships", org: "Streamforge Inc. (fictional)", email: "jonah.petrakis@streamforge.example", role: "other", tags: ["developer"] },
  moreau: { key: "moreau", id: "demo_apl_p_moreau", name: "Ines Moreau", title: "VP Product", org: "Pulsewear Ltd. (fictional)", email: "ines.moreau@pulsewear.example", role: "other", tags: ["accessory maker"] },
  mehta: { key: "mehta", id: "demo_apl_p_mehta", name: "Arjun Mehta", title: "Head of Mobile", org: "Tandem Pay (fictional)", email: "arjun@tandempay.example", role: "other", tags: ["payments app"] },
  mercer: { key: "mercer", id: "demo_apl_p_mercer", name: "Colin Mercer", title: "Partner (defense counsel)", org: "Hartwell & Pryor LLP (fictional)", email: "cmercer@hartwellpryor.example", role: "opposing", tags: ["defense counsel"] },
  holt: { key: "holt", id: "demo_apl_p_holt", name: "Serena Holt", title: "Counsel (defense counsel)", org: "Hartwell & Pryor LLP (fictional)", email: "sholt@hartwellpryor.example", role: "opposing", tags: ["defense counsel"] },
  varga: { key: "varga", id: DEMO_EXPERTS.economist, name: "Dr. Elise Varga", title: "Plaintiffs' economic expert", org: "Calder Economics Group (fictional)", role: "expert", tags: ["plaintiffs-expert"] },
  hendry: { key: "hendry", id: DEMO_EXPERTS.defenseEconomist, name: "Dr. Paul Hendry", title: "Defense economic expert", org: "Brightline Analytics (fictional)", role: "expert", tags: ["defense-expert"] },
} as const satisfies Record<string, DemoPerson>;
export type ExtraKey = keyof typeof EXTRA;

export const ALL_PEOPLE: DemoPerson[] = [...Object.values(CUST), ...Object.values(EXTRA)];

/** Display name → person (exact names used in headers and testimony). */
export const BY_NAME = new Map<string, DemoPerson>(ALL_PEOPLE.map((p) => [p.name, p]));

/** Email address for a header name (unknown names are printed as given). */
export function addr(name: string): string {
  const p = BY_NAME.get(name);
  return p?.email ? `${name} <${p.email}>` : name;
}

/** Examining and defending counsel for the demo depositions (the firm's associate and fictional defense counsel). */
export const TAKEN_BY = "Nina Castell (Class Counsel)";
export const DEFENDED_BY = "Colin Mercer (Hartwell & Pryor LLP)";
export const EXAMINER = "Ms. Castell";
export const DEFENDER = "Mr. Mercer";

/** Reviewers of the demo matter (the two demo team members). */
export const REVIEWER = { associate: DEMO_TEAM.associate, paralegal: DEMO_TEAM.paralegal } as const;

/** Person records for the matter: custodians plus the fictional colleagues, counterparties, experts and counsel. */
export function buildPeople(): Person[] {
  return ALL_PEOPLE.map((p) => tagged<Person>({ id: p.id, name: p.name, email: p.email, title: p.title, organization: p.org, role: p.role, tags: [...(p.tags ?? []), "demo"] }));
}
