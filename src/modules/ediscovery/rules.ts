import { MATTERS } from "@/lib/seed/ids";

/** kv key holding a matter's coding rules / protocol text (markdown). Client-safe. */
export const CODING_RULES_KEY = (matterId: string) => `ediscovery:rules:${matterId}`;

const AFFF_RULES = `# Coding protocol — In re: AFFF Products Liability Litigation (MDL 2873)
Tier 2 custodial review · Meridian Fluorochem · Effective 2026-09-01 · Owner: J. Whitfield / T. Bradley

## Responsiveness
A document is **Responsive** if it concerns any of the following (Plaintiffs' RFP Set 1, Nos. 3–14, 22, 31):
- The toxicity, persistence, bioaccumulation or environmental fate of MF-3 / PFOS or any AFFF product (RFP 3–6).
- Any study, test or analysis of the foregoing, including funding decisions and study design (RFP 7).
- Communications with EPA, Illinois EPA, NAVSEA or any regulator concerning PFOS, AFFF or the Decatur site (RFP 9–11).
- Marketing, MSDS, product literature or qualification statements about safety, toxicity or biodegradability (RFP 12–13).
- Groundwater, wastewater or releases at Decatur (RFP 14).
- Customer inquiries or complaints about health or environmental effects (RFP 22).
- Board or senior-management consideration of any of the above (RFP 31).

**Non-responsive**: pricing, logistics, routine HR/safety, trade shows and personal messages, unless they reference the subjects above.

## Privilege
- Code **Privileged** only where a lawyer (Kaine, Suarez acting as counsel, outside counsel) is the author or a direct recipient *and* the primary purpose is legal advice, or the document is prepared in anticipation of litigation.
- Suarez wears two hats: regulatory-affairs status memos to management are **not** privileged; his legal analyses to Kaine are.
- Kaine on cc alone does not confer privilege. Business instructions from Pryce are not privileged even if counsel is copied.
- Select the basis: attorney-client / work product. Add a note describing the legal purpose for the log.
- Escalate to partner (tag \`privilege-review\`) any document where a crime-fraud or waiver argument is foreseeable.

## Hot
Flag **Hot** for documents likely to be used as exhibits by either side: knowledge admissions, instructions to limit circulation, inconsistent statements, decisions that trade safety for cost, and anything Plaintiffs' Executive Committee would put on a slide.

## Confidentiality
- **Highly Confidential** for study data, groundwater results and board materials.
- **AEO** for privileged material and legal analyses.
- **Confidential** for everything else that is not public.

## Issue codes
Apply every applicable code. TOX-01 for knowledge of toxicity; TOX-02 for the two-year study specifically; REG-01 for the 8(e) question; REG-02 for actual agency contact; ENV-01 for groundwater; MKT-01 for claims; GOV-01 for anything touching the Navy qualification (Boyle defense).

## Families
Code the family consistently. An attachment that is privileged does not make the transmittal email privileged. Duplicates inherit coding from the primary.`;

const NG_RULES = `# Coding protocol — Northgate Logistics v. Apex Freight Systems (N.D. Ill.)
Plaintiff-side production · Owner: D. Okafor

## Responsiveness (Apex RFP Set 1)
Responsive: the MTSA and all change orders and drafts; negotiation history (especially §11.1(d) and §12); the September 2025 losses; weekly ops call notes; Bright Harbor communications and chargebacks; insurance notices; damages support.
Non-responsive: unrelated lanes and customers; routine invoicing.

## Privilege
Communications with Calloway & Reyes are privileged. The October 17 demand letter and any correspondence sent to Apex are **not** privileged. Marlow Insurance correspondence is not privileged (no common-interest agreement).

## Hot
Documents establishing (1) Northgate's written rejection of CO-3, (2) Apex's single-supervisor nights, (3) the §11.1(d) negotiation, (4) camera 6.

## Issue codes
K-01 contract terms · K-02 change orders · LOSS-01 loss events · IND-01 indemnity correspondence · DMG-01 damages · LEG-01 counsel communications.`;

export const DEFAULT_CODING_RULES: Record<string, string> = {
  [MATTERS.afff]: AFFF_RULES,
  [MATTERS.northgate]: NG_RULES,
  default: `# Coding protocol
No protocol has been written for this matter yet. Describe responsiveness criteria, privilege rules, hot-document guidance and issue-code definitions here; reviewers see this text in the Codes & privilege tab and the AI batch predictor uses it as its rubric.`,
};
