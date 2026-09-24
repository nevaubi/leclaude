import type { Metadata } from "next";
import { Radar } from "lucide-react";
import { PageTopbar } from "@/components/shell/page-topbar";
import { aiConfig } from "@/lib/ai/config";
import { currentUser } from "@/lib/current-user";
import { db } from "@/lib/db";
import { intelAnalysisBootstrap } from "@/modules/intel/analysis/bootstrap";
import { analysisStatus, listInsights } from "@/modules/intel/analysis/insights";
import { InsightsView } from "@/modules/intel/components/insights-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Insights · Intelligence" };

/** Every insight (trend, cluster, pattern, chronology, profile, anomaly, alert, digest) with flags, trust badges and evidence. */
export default async function InsightsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  intelAnalysisBootstrap();
  const sp = await searchParams;
  const me = currentUser();
  const list = listInsights({ userId: me.id, status: ["published", "verified", "draft", "flagged", "dismissed"], limit: 500, rank: true });
  const matters = db().matters.all().map((m) => ({ id: m.id, shortName: m.shortName }));
  const status = analysisStatus();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageTopbar icon={<Radar />} title="Intelligence" context={`Insights · ${status.insights.published} published · ${status.insights.flagged} flagged · ${status.insights.draft} draft`} />
      <InsightsView initial={list.insights} matters={matters} userId={me.id} hasKey={aiConfig().hasKey} status={status} openId={typeof sp.insight === "string" ? sp.insight : undefined} />
    </div>
  );
}
