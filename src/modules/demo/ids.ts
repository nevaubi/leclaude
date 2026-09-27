/**
 * Stable identifiers for the Apple antitrust demonstration dataset.
 *
 * Everything in this pack is synthetic. Case posture and the categories of allegations follow the
 * public record; every internal document, email and deposition is written by FICTIONAL company
 * employees (never real executives) and every record is tagged `meta.demo = "apple-antitrust"`
 * so it can be listed and removed. The pack is loaded on demand from Settings, never implicitly.
 */
export const DEMO_PACK = "apple-antitrust" as const;

/** Tag stored on every demo record (`meta.demo`) and prefix used by every demo id. */
export const DEMO_TAG = { key: "demo", value: DEMO_PACK } as const;

export const DEMO_MATTERS = {
  /** Consumer class action (the firm's matter; plaintiffs). */
  consumer: "m_demo_apple_consumer",
  /** Related government action tracked for coordination (not the firm's case). */
  doj: "m_demo_us_v_apple",
} as const;

/** Two demo team members joining the workspace owner. */
export const DEMO_TEAM = {
  associate: "p_demo_nina_castell", // Senior associate
  paralegal: "p_demo_omar_haddad", // Litigation paralegal / e-discovery
} as const;

/** Fictional defendant-side custodians (never real people). */
export const DEMO_CUSTODIANS = {
  appStorePolicy: "c_demo_lena_marsh", // Director, App Store Policy
  developerRelations: "c_demo_victor_ames", // Senior Manager, Developer Relations
  paymentsFinance: "c_demo_rachel_okoro", // Finance Lead, App Store Payments
  wearables: "c_demo_daniel_frey", // Product Manager, Wearables Interoperability
  messaging: "c_demo_priya_nand", // Engineering Manager, Messaging
  walletNfc: "c_demo_tomas_reyes", // Product Lead, Wallet & NFC
  legal: "c_demo_hannah_cole", // Senior Counsel, Competition (privilege)
  gaming: "c_demo_marcus_lee", // Business Development, Games & Streaming
} as const;

export const DEMO_EXPERTS = {
  economist: "x_demo_dr_elise_varga", // Plaintiffs' economist (fictional)
  defenseEconomist: "x_demo_dr_paul_hendry", // Defense economist (fictional)
} as const;

export const DEMO_DEPOSITIONS = {
  appStorePolicy: "dep_demo_marsh",
  paymentsFinance: "dep_demo_okoro",
  wearables: "dep_demo_frey",
} as const;

/** Bates prefix for the defendant's production in the consumer matter. */
export const DEMO_BATES_PREFIX = "APL-DEMO";

/** Id prefix every demo record uses, so removal can also sweep by prefix. */
export const DEMO_ID_PREFIX = "demo_apl_";

export function isDemoRecord(x: { id?: string; meta?: Record<string, unknown> } | null | undefined): boolean {
  if (!x) return false;
  return x.meta?.[DEMO_TAG.key] === DEMO_TAG.value || (typeof x.id === "string" && (x.id.startsWith(DEMO_ID_PREFIX) || x.id.includes("_demo_")));
}
