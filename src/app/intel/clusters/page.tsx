import type { Metadata } from "next";
import { Radar } from "lucide-react";
import { PageTopbar } from "@/components/shell/page-topbar";
import { aiConfig } from "@/lib/ai/config";
import { db } from "@/lib/db";
import { intelAnalysisBootstrap } from "@/modules/intel/analysis/bootstrap";
import { clusterScope } from "@/modules/intel/analysis/clusters";
import { ClustersView } from "@/modules/intel/components/clusters-view";
import { intelDocuments } from "@/modules/intel/store";
import type { IntelDocumentKind } from "@/modules/intel/types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Clusters · Intelligence" };

/** Topic clusters over the corpus (embeddings when present, TF-IDF otherwise) per scope. */
export default async function ClustersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  intelAnalysisBootstrap();
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" && sp[k] ? (sp[k] as string) : undefined);
  const kinds = s("kinds")?.split(",").filter(Boolean) as IntelDocumentKind[] | undefined;
  const k = s("k") ? Math.max(1, Math.min(Number(s("k")) || 4, 20)) : undefined;
  const result = clusterScope({ matterId: s("matterId"), kinds, k, maxChunks: 500, chunksPerDoc: 2 });
  const kindsPresent = Array.from(new Set(intelDocuments().all().map((d) => d.kind))).sort();
  const matters = db().matters.all().map((m) => ({ value: m.id, label: m.shortName }));
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageTopbar icon={<Radar />} title="Intelligence" context={`Clusters · ${result.clusters.length} topics over ${result.documents.toLocaleString()} records`} />
      <ClustersView initial={result} options={{ kinds: kindsPresent, matters }} hasKey={aiConfig().hasKey} />
    </div>
  );
}
