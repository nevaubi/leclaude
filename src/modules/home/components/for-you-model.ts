/** Pure model for the Home "For you" slot (no React; unit-tested). */
import type { Provenance } from "@/lib/integrity/types";

/**
 * Minimal shape the Home slot needs from an intelligence insight. The intel
 * round owns the real records (`IntelInsight`); this reads only what it renders.
 */
export interface ForYouInsight {
  id: string;
  kind?: string;
  title: string;
  summary?: string;
  confidence?: number;
  provenance?: Provenance;
  scope?: { matterId?: string };
  href?: string;
  updatedAt?: string;
}

/** Accept `{ insights }`, `{ items }` or a bare array; anything else is "no insights". */
export function parseInsights(payload: unknown): ForYouInsight[] {
  const list = Array.isArray(payload) ? payload : payload && typeof payload === "object" ? ((payload as { insights?: unknown; items?: unknown }).insights ?? (payload as { items?: unknown }).items) : undefined;
  if (!Array.isArray(list)) return [];
  return list.filter((x): x is ForYouInsight => Boolean(x) && typeof x === "object" && typeof (x as ForYouInsight).id === "string" && typeof (x as ForYouInsight).title === "string");
}

export const INSIGHT_KIND_LABEL: Record<string, string> = { trend: "Trend", cluster: "Cluster", pattern: "Pattern", chronology: "Chronology", profile: "Profile", anomaly: "Anomaly", alert: "Alert", digest: "Digest" };
