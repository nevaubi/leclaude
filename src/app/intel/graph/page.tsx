import type { Metadata } from "next";
import { Radar } from "lucide-react";
import { PageTopbar } from "@/components/shell/page-topbar";
import { intelAnalysisBootstrap } from "@/modules/intel/analysis/bootstrap";
import { graphExport } from "@/modules/intel/analysis/graph";
import { GraphView } from "@/modules/intel/components/graph-view";
import { intelEntities } from "@/modules/intel/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Graph · Intelligence" };

/** Knowledge graph: entities and their evidence-backed relations, centred on one entity or the most connected ones. */
export default async function GraphPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  intelAnalysisBootstrap();
  const sp = await searchParams;
  const entityId = typeof sp.entityId === "string" && sp.entityId ? sp.entityId : undefined;
  const depth = typeof sp.depth === "string" ? Math.max(1, Math.min(Number(sp.depth) || 1, 3)) : 1;
  const graph = graphExport({ entityId: entityId && intelEntities().has(entityId) ? entityId : undefined, depth, limit: 80 });
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageTopbar icon={<Radar />} title="Intelligence" context={`Graph · ${graph.nodes.length} entities · ${graph.links.length} relations`} />
      <GraphView initial={graph} />
    </div>
  );
}
