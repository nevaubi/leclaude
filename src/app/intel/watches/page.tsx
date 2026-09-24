import type { Metadata } from "next";
import { Radar } from "lucide-react";
import { PageTopbar } from "@/components/shell/page-topbar";
import { currentUser } from "@/lib/current-user";
import { db } from "@/lib/db";
import { intelAnalysisBootstrap } from "@/modules/intel/analysis/bootstrap";
import { listWatches } from "@/modules/intel/analysis/watches";
import { WatchesView, type WatchRow } from "@/modules/intel/components/watches-view";
import { intelEntities, intelInsights } from "@/modules/intel/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Watches · Intelligence" };

/** Watch management: judges, dockets, MDLs, products, regulations, counsel, firms, courts and saved queries the user follows. */
export default async function WatchesPage() {
  intelAnalysisBootstrap();
  const me = currentUser();
  const rows: WatchRow[] = listWatches({ userId: me.id }).map((w) => {
    const e = intelEntities().get(w.target);
    const alerts = intelInsights().count((i) => i.kind === "alert" && i.scope.userId === me.id && i.status !== "dismissed" && (i.scope.entityIds.includes(w.target) || i.data.watchId === w.id));
    return { ...w, entity: e ? { id: e.id, type: e.type, name: e.name, documents: e.docIds.length } : null, alerts };
  });
  const matters = db().matters.all().map((m) => ({ id: m.id, shortName: m.shortName }));
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageTopbar icon={<Radar />} title="Intelligence" context={`Watches · ${rows.length} for ${me.name}`} />
      <WatchesView initial={rows} userId={me.id} matters={matters} />
    </div>
  );
}
