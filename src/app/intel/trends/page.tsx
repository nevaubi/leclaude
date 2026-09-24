import type { Metadata } from "next";
import { Radar } from "lucide-react";
import { PageTopbar } from "@/components/shell/page-topbar";
import { intelAnalysisBootstrap } from "@/modules/intel/analysis/bootstrap";
import { buildTrends, trendOptions } from "@/modules/intel/analysis/trends";
import { TrendsView } from "@/modules/intel/components/trends-view";
import { trendQueryFromParams } from "@/modules/intel/components/models";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Trends · Intelligence" };

/** Month-bucketed series by jurisdiction, court, judge, kind, motion type and more, with anomalies and compare mode. */
export default async function TrendsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  intelAnalysisBootstrap();
  const sp = await searchParams;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") params.set(k, v);
  const now = new Date();
  const { period: _p, compareMode: _c, ...query } = trendQueryFromParams(params, now);
  void _p; void _c;
  const initial = buildTrends(query);
  const options = trendOptions();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageTopbar icon={<Radar />} title="Intelligence" context={`Trends · ${initial.sample.toLocaleString()} records in range`} />
      <TrendsView initial={initial} options={options} initialParams={params.toString()} now={now.toISOString()} />
    </div>
  );
}
