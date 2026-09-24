import type { Metadata } from "next";
import { Radar } from "lucide-react";
import { PageTopbar } from "@/components/shell/page-topbar";
import { db } from "@/lib/db";
import { intelAnalysisBootstrap } from "@/modules/intel/analysis/bootstrap";
import { buildChronology } from "@/modules/intel/analysis/chronology";
import type { ChronologyQuery } from "@/modules/intel/analysis/types";
import { ChronologyView } from "@/modules/intel/components/chronology-view";
import { intelDocuments, intelEntities } from "@/modules/intel/store";
import type { IntelDocumentKind } from "@/modules/intel/types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Chronologies · Intelligence" };

/** Sourced chronologies for a matter, MDL, product or any entity, merged with the e-discovery timeline. */
export default async function ChronologiesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  intelAnalysisBootstrap();
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" && sp[k] ? (sp[k] as string) : undefined);
  const matters = db().matters.all().map((m) => ({ value: m.id, label: m.shortName, records: intelDocuments().count((d) => d.matterIds.includes(m.id)) }));
  const mdls = intelEntities().find((e) => e.type === "mdl").map((e) => ({ value: e.id, label: e.name }));
  const products = intelEntities().find((e) => e.type === "product").map((e) => ({ value: e.id, label: e.name }));
  const scope = { matterId: s("matterId"), mdlId: s("mdlId"), productId: s("productId"), entityId: s("entityId") };
  const hasScope = Boolean(scope.matterId || scope.mdlId || scope.productId || scope.entityId);
  const fallback = matters.filter((m) => m.records > 0).sort((a, b) => b.records - a.records)[0]?.value;
  const query: ChronologyQuery = { ...(hasScope ? scope : { matterId: fallback }), kinds: s("kinds")?.split(",").filter(Boolean) as IntelDocumentKind[] | undefined, includeEdiscovery: s("ediscovery") !== "0", from: s("from"), to: s("to") };
  const initial = query.matterId || query.mdlId || query.productId || query.entityId ? buildChronology(query) : null;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageTopbar icon={<Radar />} title="Intelligence" context={initial ? `Chronology · ${initial.label} · ${initial.entries.length} events` : "Chronologies"} />
      <ChronologyView initial={initial} options={{ matters, mdls, products }} entityName={scope.entityId ? intelEntities().get(scope.entityId)?.name : undefined} />
    </div>
  );
}
