/**
 * Client-safe jurisdiction catalogue. Keys mirror COURT_GROUPS in
 * src/lib/ai/toolkit/legal.ts (a test keeps them in sync); the court id lists
 * are duplicated here because the toolkit is server-only.
 */
import type { Authority } from "./types";

export interface Jurisdiction {
  key: string;
  label: string;
  group: "Federal" | "Circuits" | "State";
  /** CourtListener court ids (space separated). Empty = all courts. */
  courts: string;
  /** Courts whose decisions bind trial courts in this jurisdiction. */
  binding: string[];
  hint?: string;
}

export const JURISDICTIONS: Jurisdiction[] = [
  { key: "all-federal", label: "All federal", group: "Federal", courts: "", binding: ["scotus"], hint: "All federal and state courts; SCOTUS treated as binding" },
  { key: "scotus", label: "Supreme Court", group: "Federal", courts: "scotus", binding: ["scotus"] },
  { key: "federal-appellate", label: "Federal appellate", group: "Federal", courts: "ca1 ca2 ca3 ca4 ca5 ca6 ca7 ca8 ca9 ca10 ca11 cadc cafc", binding: ["scotus"] },
  { key: "4th-circuit", label: "4th Circuit (D.S.C., N.C., Md., Va., W. Va.)", group: "Circuits", courts: "ca4 dsc dnc dmd dvae dvaw dwvn dwvs", binding: ["scotus", "ca4"] },
  { key: "7th-circuit", label: "7th Circuit (Ill., Ind., Wis.)", group: "Circuits", courts: "ca7 ilnd ilcd ilsd innd insd wied wiwd", binding: ["scotus", "ca7"] },
  { key: "9th-circuit", label: "9th Circuit (Cal. districts)", group: "Circuits", courts: "ca9 cacd caed cand casd", binding: ["scotus", "ca9"] },
  { key: "11th-circuit", label: "11th Circuit (Fla., Ga., Ala.)", group: "Circuits", courts: "ca11 flnd flmd flsd gand gamd gasd alnd almd alsd", binding: ["scotus", "ca11"] },
  { key: "california-state", label: "California", group: "State", courts: "cal calctapp", binding: ["scotus", "cal", "calctapp"] },
  { key: "new-york-state", label: "New York", group: "State", courts: "ny nyappdiv nysupct", binding: ["scotus", "ny", "nyappdiv"] },
  { key: "delaware", label: "Delaware", group: "State", courts: "del delch delsuperct", binding: ["scotus", "del"] },
  { key: "texas-state", label: "Texas", group: "State", courts: "tex texapp", binding: ["scotus", "tex", "texapp"] },
  { key: "illinois-state", label: "Illinois", group: "State", courts: "ill illappct", binding: ["scotus", "ill", "illappct"] },
];

export function jurisdictionByKey(key: string | undefined | null) {
  return JURISDICTIONS.find((j) => j.key === key) ?? JURISDICTIONS[0];
}

/** Parent circuit for the district courts we know about. */
export const CIRCUIT_OF: Record<string, string> = {
  dsc: "ca4", dnc: "ca4", dmd: "ca4", dvae: "ca4", dvaw: "ca4", dwvn: "ca4", dwvs: "ca4", ncwd: "ca4", nced: "ca4", ncmd: "ca4",
  ilnd: "ca7", ilcd: "ca7", ilsd: "ca7", innd: "ca7", insd: "ca7", wied: "ca7", wiwd: "ca7",
  cacd: "ca9", caed: "ca9", cand: "ca9", casd: "ca9", wawd: "ca9", waed: "ca9", ord: "ca9", azd: "ca9", nvd: "ca9", hid: "ca9", idd: "ca9", mtd: "ca9", akd: "ca9",
  flnd: "ca11", flmd: "ca11", flsd: "ca11", gand: "ca11", gamd: "ca11", gasd: "ca11", alnd: "ca11", almd: "ca11", alsd: "ca11",
  nysd: "ca2", nyed: "ca2", nynd: "ca2", nywd: "ca2", ctd: "ca2", vtd: "ca2",
  ded: "ca3", njd: "ca3", paed: "ca3", pamd: "ca3", pawd: "ca3",
  txnd: "ca5", txsd: "ca5", txed: "ca5", txwd: "ca5", laed: "ca5", lamd: "ca5", lawd: "ca5", msnd: "ca5", mssd: "ca5",
  ohnd: "ca6", ohsd: "ca6", mied: "ca6", miwd: "ca6", kyed: "ca6", kywd: "ca6", tned: "ca6", tnmd: "ca6", tnwd: "ca6",
  mnd: "ca8", moed: "ca8", mowd: "ca8", ared: "ca8", arwd: "ca8", iand: "ca8", iasd: "ca8", ned: "ca8", nDd: "ca8", sdd: "ca8",
  cod: "ca10", ksd: "ca10", nmd: "ca10", oked: "ca10", oknd: "ca10", okwd: "ca10", utd: "ca10", wyd: "ca10",
  mad: "ca1", med: "ca1", nhd: "ca1", rid: "ca1", prd: "ca1",
  dcd: "cadc",
};

/** Human court abbreviations for Bluebook parentheticals. */
export const COURT_ABBR: Record<string, string> = {
  scotus: "U.S.", ca1: "1st Cir.", ca2: "2d Cir.", ca3: "3d Cir.", ca4: "4th Cir.", ca5: "5th Cir.", ca6: "6th Cir.", ca7: "7th Cir.", ca8: "8th Cir.", ca9: "9th Cir.", ca10: "10th Cir.", ca11: "11th Cir.", cadc: "D.C. Cir.", cafc: "Fed. Cir.",
  dsc: "D.S.C.", dnc: "D.N.C.", dmd: "D. Md.", dvae: "E.D. Va.", dvaw: "W.D. Va.", dwvn: "N.D. W. Va.", dwvs: "S.D. W. Va.", nced: "E.D.N.C.", ncmd: "M.D.N.C.", ncwd: "W.D.N.C.",
  ilnd: "N.D. Ill.", ilcd: "C.D. Ill.", ilsd: "S.D. Ill.", innd: "N.D. Ind.", insd: "S.D. Ind.", wied: "E.D. Wis.", wiwd: "W.D. Wis.",
  cacd: "C.D. Cal.", caed: "E.D. Cal.", cand: "N.D. Cal.", casd: "S.D. Cal.", wawd: "W.D. Wash.", ord: "D. Or.", azd: "D. Ariz.", nvd: "D. Nev.",
  flnd: "N.D. Fla.", flmd: "M.D. Fla.", flsd: "S.D. Fla.", gand: "N.D. Ga.", gamd: "M.D. Ga.", gasd: "S.D. Ga.", alnd: "N.D. Ala.", almd: "M.D. Ala.", alsd: "S.D. Ala.",
  nysd: "S.D.N.Y.", nyed: "E.D.N.Y.", nynd: "N.D.N.Y.", nywd: "W.D.N.Y.", ctd: "D. Conn.", ded: "D. Del.", njd: "D.N.J.", paed: "E.D. Pa.", pamd: "M.D. Pa.", pawd: "W.D. Pa.",
  txnd: "N.D. Tex.", txsd: "S.D. Tex.", txed: "E.D. Tex.", txwd: "W.D. Tex.", laed: "E.D. La.", ohnd: "N.D. Ohio", ohsd: "S.D. Ohio", mied: "E.D. Mich.", miwd: "W.D. Mich.",
  mnd: "D. Minn.", moed: "E.D. Mo.", mowd: "W.D. Mo.", cod: "D. Colo.", ksd: "D. Kan.", mad: "D. Mass.", dcd: "D.D.C.",
  cal: "Cal.", calctapp: "Cal. Ct. App.", ny: "N.Y.", nyappdiv: "N.Y. App. Div.", nysupct: "N.Y. Sup. Ct.", del: "Del.", delch: "Del. Ch.", delsuperct: "Del. Super. Ct.", tex: "Tex.", texapp: "Tex. App.", ill: "Ill.", illappct: "Ill. App. Ct.",
};

/** Case-law court id derived from a free-text `courts` override (first token) or a jurisdiction. */
export function resolveCourts(jurisdictionKey: string, courtsOverride?: string): string {
  const override = (courtsOverride ?? "").trim().toLowerCase().replace(/[,\s]+/g, " ");
  if (override) return override;
  return jurisdictionByKey(jurisdictionKey).courts;
}

/**
 * Binding vs persuasive relative to the selected jurisdiction (or free-text
 * courts). Rule of thumb for trial-court research: SCOTUS and the governing
 * circuit (or state high court / intermediate appellate court) bind; other
 * courts, including sister district courts, persuade.
 */
export function classifyAuthority(courtId: string | undefined, jurisdictionKey: string, courtsOverride?: string): Authority {
  if (!courtId) return "n/a";
  const id = courtId.toLowerCase();
  if (id === "scotus") return "binding";
  const override = (courtsOverride ?? "").trim().toLowerCase().split(/[\s,]+/).filter(Boolean);
  if (override.length) {
    const bindingSet = new Set<string>();
    for (const c of override) {
      if (/^ca\d+$|^cadc$|^cafc$/.test(c)) bindingSet.add(c);
      const circ = CIRCUIT_OF[c];
      if (circ) bindingSet.add(circ);
      if (["cal", "calctapp", "ny", "nyappdiv", "del", "tex", "texapp", "ill", "illappct"].includes(c)) bindingSet.add(c);
      if (c === "calctapp" || c === "cal") { bindingSet.add("cal"); bindingSet.add("calctapp"); }
      if (c.startsWith("ny")) { bindingSet.add("ny"); bindingSet.add("nyappdiv"); }
      if (c.startsWith("del")) bindingSet.add("del");
      if (c.startsWith("tex")) { bindingSet.add("tex"); bindingSet.add("texapp"); }
      if (c.startsWith("ill")) { bindingSet.add("ill"); bindingSet.add("illappct"); }
    }
    return bindingSet.has(id) ? "binding" : "persuasive";
  }
  const j = jurisdictionByKey(jurisdictionKey);
  if (j.key === "all-federal" || j.key === "federal-appellate") return "persuasive";
  return j.binding.includes(id) ? "binding" : "persuasive";
}

export function courtAbbreviation(courtId?: string, courtName?: string) {
  if (courtId && COURT_ABBR[courtId.toLowerCase()]) return COURT_ABBR[courtId.toLowerCase()];
  return courtName ?? courtId ?? "";
}
