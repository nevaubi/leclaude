"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { Filterbar, type FilterbarFilter } from "@/components/ui/filterbar";
import type { FilterValues } from "@/components/ui/filterbar-helpers";
import { Inspector } from "@/components/ui/inspector";
import type { IntelDocumentKind } from "../types";
import { DOC_KIND_LABEL, fmtDate, fmtInt } from "../analysis/pure";
import type { ClusterResult, ClusterSummary } from "../analysis/types";
import { DocLink, EmptySources, MethodNote, useJson } from "./shared";

export function ClustersView({ initial, options, hasKey }: { initial: ClusterResult; options: { kinds: IntelDocumentKind[]; matters: { value: string; label: string }[] }; hasKey: boolean }) {
  const router = useRouter();
  const scope = initial.scope as { matterId?: string; kinds?: IntelDocumentKind[]; k?: number };
  const [values, setValues] = React.useState<FilterValues>({ matter: scope.matterId ?? null, kinds: scope.kinds?.length ? scope.kinds : null, k: scope.k ? String(scope.k) : null });
  const [selected, setSelected] = React.useState<string | null>(null);
  const first = React.useRef(true);
  const url = React.useMemo(() => {
    const sp = new URLSearchParams();
    if (typeof values.matter === "string") sp.set("matterId", values.matter);
    const kinds = Array.isArray(values.kinds) ? values.kinds : values.kinds ? [values.kinds] : [];
    if (kinds.length) sp.set("kinds", kinds.join(","));
    if (typeof values.k === "string") sp.set("k", values.k);
    return sp.toString();
  }, [values]);
  const { data, loading, error } = useJson<ClusterResult>(first.current ? null : `/api/intel/clusters?${url}&maxChunks=500`, [url]);
  React.useEffect(() => { if (first.current) { first.current = false; return; } router.replace(url ? `/intel/clusters?${url}` : "/intel/clusters", { scroll: false }); }, [url, router]);
  const result = data ?? initial;
  const cluster = result.clusters.find((c) => c.id === selected) ?? null;

  const filters: FilterbarFilter[] = [
    { id: "matter", label: "Matter", options: options.matters },
    { id: "kinds", label: "Kinds", multi: true, options: options.kinds.map((k) => ({ value: k, label: DOC_KIND_LABEL[k] })) },
    { id: "k", label: "Clusters", options: ["2", "3", "4", "5", "6", "8", "10", "12"].map((k) => ({ value: k, label: `${k} clusters` })), pinned: false },
  ];
  const columns: DataTableColumn<ClusterSummary>[] = [
    { id: "label", header: "Topic", width: 300, minWidth: 160, locked: true, accessor: (c) => c.label, render: (c) => <span className="truncate font-medium" title={c.terms.join(", ")}>{c.label}</span> },
    { id: "terms", header: "Terms", width: 260, accessor: (c) => c.terms.join(" "), render: (c) => <span className="truncate text-muted-foreground" title={c.terms.join(", ")}>{c.terms.join(" · ")}</span> },
    { id: "size", header: "Passages", width: 90, align: "right", sortable: true, accessor: (c) => c.size, render: (c) => <span className="tabular">{fmtInt(c.size)}</span> },
    { id: "share", header: "Share", width: 72, align: "right", sortable: true, accessor: (c) => c.share, render: (c) => <span className="tabular text-muted-foreground">{Math.round(c.share * 100)}%</span> },
    { id: "docs", header: "Records", width: 84, align: "right", sortable: true, accessor: (c) => c.docIds.length, render: (c) => <span className="tabular">{fmtInt(c.docIds.length)}</span> },
    { id: "kinds", header: "Kinds", width: 220, accessor: (c) => Object.keys(c.byKind).join(" "), render: (c) => <span className="truncate text-muted-foreground">{Object.entries(c.byKind).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).map(([k, n]) => `${DOC_KIND_LABEL[k as IntelDocumentKind]} ${n}`).join(" · ")}</span> },
    { id: "range", header: "Dates", width: 190, accessor: (c) => c.dateRange?.from ?? "", render: (c) => <span className="tabular text-muted-foreground">{c.dateRange ? `${fmtDate(c.dateRange.from)} – ${fmtDate(c.dateRange.to)}` : "—"}</span> },
  ];

  if (!initial.chunks && !data) {
    return <div className="min-h-0 flex-1 overflow-auto scrollbar-thin"><div className="mx-auto max-w-3xl p-6"><EmptySources title="Nothing to cluster yet" description="Clusters need indexed passages. Enable and run sources, then run the analysis; with an OpenAI key the passages are embedded and clustered semantically, otherwise TF-IDF vectors are used." /></div></div>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Filterbar filters={filters} values={values} onChange={setValues} status={<span className="tabular">{loading ? "Clustering…" : error ? `Error: ${error}` : `${result.clusters.length} clusters · ${fmtInt(result.chunks)} passages from ${fmtInt(result.documents)} records · ${result.method === "embeddings" ? "embeddings" : "TF-IDF"} · ${result.iterations} iterations`}</span>} />
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <DataTable rows={result.clusters} columns={columns} rowId={(c) => c.id} defaultSort={{ columnId: "size", dir: "desc" }} selectionMode="single" activeId={selected} onActiveChange={setSelected} onRowClick={(c) => setSelected(c.id)} onRowActivate={(c) => setSelected(c.id)} noun="cluster" ariaLabel="Clusters" columnChooser={false} empty={<div className="p-6 text-center text-[12px] text-muted-foreground">No clusters for this scope.</div>} />
          <div className="border-t px-3 py-1.5"><MethodNote>{result.method === "embeddings" ? "Clusters are k-means++ over the stored passage embeddings (cosine), labelled by the passages' most distinctive TF-IDF terms." : `Clusters are k-means++ over TF-IDF vectors of the passages (cosine), labelled by their most distinctive terms.${hasKey ? " Embeddings are added as the background re-index runs." : " Add OPENAI_API_KEY to embed passages and cluster by meaning."}`} Deterministic for a given scope; select a row to see its representative passages.</MethodNote></div>
        </div>
        {cluster && (
          <Inspector title={cluster.label} subtitle={`${cluster.size} passages · ${cluster.docIds.length} records · ${Math.round(cluster.share * 100)}%`} onClose={() => setSelected(null)} closeShortcut="Esc" width={400} minWidth={320} maxWidth={640} resizable ariaLabel="Cluster details">
            <div className="space-y-3 p-3 text-[12px]">
              <div className="flex flex-wrap gap-1 text-[11px] text-muted-foreground">{cluster.terms.map((t) => <span key={t} className="rounded-[var(--radius-chip)] border px-1.5 py-0.5">{t}</span>)}</div>
              <div>
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Representative passages</div>
                <div className="divide-hairline">
                  {cluster.topDocs.map((t) => (
                    <div key={t.chunkId} className="py-1.5">
                      <div className="flex items-center gap-2"><DocLink doc={{ id: t.docId, title: t.title, kind: t.kind }} className="min-w-0 flex-1 font-medium" showKind /><span className="tabular text-[11px] text-muted-foreground" title="Similarity to the cluster centroid">{t.similarity.toFixed(2)}</span></div>
                      <p className="mt-0.5 font-serif text-[12.5px] leading-snug text-muted-foreground">{t.excerpt}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Inspector>
        )}
      </div>
    </div>
  );
}
