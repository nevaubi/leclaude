import type { Metadata } from "next";
import { Radar } from "lucide-react";
import { EmptyState } from "@/components/ui/misc";
import { PageTopbar } from "@/components/shell/page-topbar";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Intelligence" };

/**
 * Intelligence: authorities, dockets, judges, regulations, recalls and trends
 * ingested in the background and cross-analyzed. This minimal page reserves
 * the route; the intel round replaces it with the entity explorer, profiles,
 * trends, clusters, graph and chronologies.
 */
export default function IntelPage() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageTopbar icon={Radar} title="Intelligence" />
      <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        <div className="mx-auto max-w-3xl p-6">
          <h1 className="text-[17px] font-semibold tracking-tight">Intelligence</h1>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">Case law, dockets, court rules, judges, regulations, Federal Register notices, FDA recalls, MDLs, counsel data, news and the firm&apos;s own document folders, filed, chunked, embedded, entity-linked and cross-analyzed.</p>
          <EmptyState className="mt-6" icon={Radar} title="Sources come online after the intelligence round" description="Once background ingestion runs, this page lists judges, attorneys, firms, MDLs and products with profiles, trends, clusters, a knowledge graph and evidence-linked chronologies. Configure providers under Settings → Research providers and folders under Settings → Data & automation." />
        </div>
      </div>
    </div>
  );
}
