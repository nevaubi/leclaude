import type { Metadata } from "next";
import { Radar } from "lucide-react";
import { PageTopbar } from "@/components/shell/page-topbar";
import { currentUser } from "@/lib/current-user";
import { intelAnalysisBootstrap } from "@/modules/intel/analysis/bootstrap";
import { listEntities } from "@/modules/intel/analysis/entities";
import { analysisStatus } from "@/modules/intel/analysis/insights";
import { EntityExplorer } from "@/modules/intel/components/entity-explorer";
import { intelSources } from "@/modules/intel/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Intelligence" };

/**
 * Intelligence explorer: every resolved entity (judges, attorneys, firms,
 * parties, courts, MDLs, products, agencies, regulations, statutes, experts)
 * in one dense table with type filters, search, counts and watch toggles.
 */
export default async function IntelPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  intelAnalysisBootstrap();
  const sp = await searchParams;
  const me = currentUser();
  const list = listEntities({ watchedBy: me.id, limit: 2000 });
  const status = analysisStatus();
  const sources = intelSources().all();
  const initialParams = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") initialParams.set(k, v);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageTopbar icon={<Radar />} title="Intelligence" context={`${list.total.toLocaleString()} entities · ${status.documents.toLocaleString()} records · ${status.relations.toLocaleString()} relations`} />
      <EntityExplorer initial={list} userId={me.id} status={status} sources={{ total: sources.length, enabled: sources.filter((s) => s.enabled).length }} initialParams={initialParams.toString()} />
    </div>
  );
}
