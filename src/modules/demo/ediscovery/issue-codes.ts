import type { IssueCode } from "@/lib/types/domain";
import { M, tagged } from "./people";

/** Issue codes of the demo matter (plaintiffs' coding scheme for the defendant's production). */
export const IC = {
  commission: "ASC-01",
  antiSteering: "AST-01",
  iap: "IAP-01",
  superApps: "SUP-01",
  cloudGaming: "CGM-01",
  messaging: "MSG-01",
  smartwatch: "SWI-01",
  nfc: "NFC-01",
  market: "MKT-01",
  damages: "DMG-01",
  legal: "LEG-01",
} as const;
export type IssueKey = keyof typeof IC;

const code = (slug: string, c: string, label: string, description: string, color: string, parentId?: string): IssueCode =>
  tagged<IssueCode>({ id: `demo_apl_ic_${slug}`, matterId: M, code: c, label, description, color, ...(parentId ? { parentId } : {}) });

export function buildIssueCodes(): IssueCode[] {
  return [
    code("asc01", IC.commission, "App Store commission", "The 30% / 15% commission: rate setting, subscription and Small Business Program changes, margins and cost-to-serve.", "chart-1"),
    code("ast01", IC.antiSteering, "Anti-steering", "Rules limiting developers from telling users about, or linking to, purchase options outside the app; enforcement and rationale.", "chart-1", "demo_apl_ic_asc01"),
    code("iap01", IC.iap, "In-app payment requirement", "Mandatory use of the platform's in-app purchase system for digital goods; payment-processing costs; third-party processors.", "chart-2", "demo_apl_ic_asc01"),
    code("sup01", IC.superApps, "Super apps / mini-programs", "Restrictions on apps that host mini-apps, mini-games or directories of other developers' content.", "chart-3"),
    code("cgm01", IC.cloudGaming, "Cloud gaming / game streaming", "Per-title review and other conditions on catalog game-streaming apps.", "chart-3"),
    code("msg01", IC.messaging, "Messaging interoperability", "Cross-platform messaging quality, a messaging client for other platforms, RCS, and switching costs from group messaging.", "chart-4"),
    code("swi01", IC.smartwatch, "Smartwatch interoperability", "API, notification and connectivity limits on third-party smartwatches; watch attach and iPhone retention.", "chart-4"),
    code("nfc01", IC.nfc, "NFC & Wallet", "Access to the NFC controller and tap-to-pay for third-party wallets and bank apps; issuer fee economics.", "chart-5"),
    code("mkt01", IC.market, "Market definition & switching", "Smartphone and app-distribution markets, installed base, switching costs and consumer research.", "info"),
    code("dmg01", IC.damages, "Damages / pass-through", "Evidence on consumer overcharge: price tiers, commission pass-through, class-wide impact.", "warning"),
    code("leg01", IC.legal, "Legal advice / privilege", "Communications with in-house or outside counsel; defendant's privilege assertions under review for challenge.", "destructive"),
  ];
}
