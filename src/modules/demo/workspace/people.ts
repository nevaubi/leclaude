/**
 * Demo people: the two demo team members who join the workspace owner, and the fictional custodians, experts,
 * opposing counsel and presiding judge of the consumer matter. Every name is fictional; no statement anywhere in
 * the pack is attributed to a real person.
 */
import type { PersonRecord } from "@/modules/workspace/service";
import { DEMO_CUSTODIANS, DEMO_EXPERTS, DEMO_ID_PREFIX, DEMO_TEAM } from "../ids";
import { demoMeta, type DemoBuildContext } from "./context";

/** Stored person plus the demo tag (Person itself has no meta; the extra field is ignored by other modules). */
export type DemoPerson = PersonRecord & { meta?: Record<string, unknown> };

/** Fictional defense counsel (same id and name the e-discovery pack uses). */
export const DEMO_OPPOSING_COUNSEL = `${DEMO_ID_PREFIX}p_mercer`;
export const DEMO_OPPOSING_COUNSEL_NAME = "Colin Mercer";
export const DEMO_JUDGE = `${DEMO_ID_PREFIX}p_judge_aldridge`;
export const DEMO_JUDGE_NAME = "Hon. Marian K. Aldridge";
export const DEMO_DEFENDANT_ORG = "Apple Inc. (demo)";

export const DEMO_TEAM_PROFILES = {
  associate: { id: DEMO_TEAM.associate, name: "Nina Castell", local: "ncastell", title: "Senior Associate", role: "attorney" as const, firmRole: "Associate" as const, tags: ["antitrust", "class actions", "economics"] },
  paralegal: { id: DEMO_TEAM.paralegal, name: "Omar Haddad", local: "ohaddad", title: "Litigation Paralegal", role: "paralegal" as const, firmRole: "Paralegal" as const, tags: ["e-discovery", "depositions"] },
};

/** The two demo team members (active, firm roles Associate and Paralegal). `takenEmails` avoids colliding with real members. */
export function buildDemoTeam(ctx: DemoBuildContext, takenEmails: ReadonlySet<string> = new Set()): DemoPerson[] {
  const created = ctx.now.toISOString();
  return Object.values(DEMO_TEAM_PROFILES).map((p) => {
    let email = `${p.local}@${ctx.emailDomain}`;
    if (takenEmails.has(email)) email = `${p.local}.demo@${ctx.emailDomain}`;
    return {
      id: p.id,
      name: p.name,
      email,
      title: p.title,
      organization: ctx.firmName,
      role: p.role,
      firmRole: p.firmRole,
      active: true,
      tags: p.tags,
      createdAt: created,
      updatedAt: created,
      meta: demoMeta(),
    };
  });
}

const CUSTODIANS: { id: string; name: string; title: string; email: string }[] = [
  { id: DEMO_CUSTODIANS.appStorePolicy, name: "Lena Marsh", title: "Director, App Store Policy", email: "lmarsh@apple.example" },
  { id: DEMO_CUSTODIANS.developerRelations, name: "Victor Ames", title: "Senior Manager, Developer Relations", email: "vames@apple.example" },
  { id: DEMO_CUSTODIANS.paymentsFinance, name: "Rachel Okoro", title: "Finance Lead, App Store Payments", email: "rokoro@apple.example" },
  { id: DEMO_CUSTODIANS.wearables, name: "Daniel Frey", title: "Product Manager, Wearables Interoperability", email: "dfrey@apple.example" },
  { id: DEMO_CUSTODIANS.messaging, name: "Priya Nand", title: "Engineering Manager, Messaging", email: "pnand@apple.example" },
  { id: DEMO_CUSTODIANS.walletNfc, name: "Tomas Reyes", title: "Product Lead, Wallet & NFC", email: "treyes@apple.example" },
  { id: DEMO_CUSTODIANS.legal, name: "Hannah Cole", title: "Senior Counsel, Competition", email: "hcole@apple.example" },
  { id: DEMO_CUSTODIANS.gaming, name: "Marcus Lee", title: "Business Development, Games & Streaming", email: "mlee@apple.example" },
];

export const DEMO_CUSTODIAN_NAMES: Record<string, string> = Object.fromEntries(CUSTODIANS.map((c) => [c.id, c.name]));

/**
 * Fictional custodians (defendant employees), experts, defense counsel and the fictional presiding judge. The
 * e-discovery pack writes its own (richer) records for the same ids after these, so these are a floor, not a fork.
 */
export function buildDemoParties(): DemoPerson[] {
  const tag = demoMeta();
  const custodians: DemoPerson[] = CUSTODIANS.map((c) => ({ id: c.id, name: c.name, email: c.email, title: c.title, organization: DEMO_DEFENDANT_ORG, role: "custodian", tags: ["fictional custodian"], meta: tag }));
  return [
    ...custodians,
    { id: DEMO_EXPERTS.economist, name: "Dr. Elise Varga", title: "Industrial organization economist (plaintiffs)", organization: "Calder Economics Group (fictional)", role: "expert", tags: ["damages", "market definition"], meta: tag },
    { id: DEMO_EXPERTS.defenseEconomist, name: "Dr. Paul Hendry", title: "Economist (defendant)", organization: "Brightline Analytics (fictional)", role: "expert", tags: ["rebuttal"], meta: tag },
    { id: DEMO_OPPOSING_COUNSEL, name: DEMO_OPPOSING_COUNSEL_NAME, title: "Partner (defense counsel)", organization: "Hartwell & Pryor LLP (fictional)", role: "opposing", meta: tag },
    { id: DEMO_JUDGE, name: DEMO_JUDGE_NAME, title: "U.S. District Judge (fictional, demo)", organization: "N.D. Cal.", role: "judge", meta: tag },
  ];
}
