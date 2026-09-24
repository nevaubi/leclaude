"use client";
import * as React from "react";
import { Download, FileText, ListChecks, Loader2, Users } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/misc";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { KnowledgeMap } from "../types";
import { CiteChip, KeyHint, NoKeyCallout, ProvenanceBadge, formatShortDate } from "./shared";
import { api, downloadText, exportMarkdownToWord, isNoKey, useOpenTestimony } from "./use-analysis-data";

interface Cell { entry: KnowledgeMap["entries"][number]; map: KnowledgeMap }
interface Row { key: string; personId?: string; name: string; earliest: string; cells: Map<string, Cell> }

/** People × topics × earliest date, from the saved knowledge maps of the matter. */
export function matrixRows(maps: KnowledgeMap[]): Row[] {
  const rows = new Map<string, Row>();
  for (const m of maps) for (const e of m.entries) {
    const key = e.personId ?? e.personName.trim().toLowerCase();
    const r = rows.get(key) ?? { key, personId: e.personId, name: e.personName, earliest: e.firstKnownDate, cells: new Map() };
    const cur = r.cells.get(m.id);
    if (!cur || e.firstKnownDate < cur.entry.firstKnownDate) r.cells.set(m.id, { entry: e, map: m });
    if (e.firstKnownDate < r.earliest) r.earliest = e.firstKnownDate;
    rows.set(key, r);
  }
  return Array.from(rows.values()).sort((a, b) => a.earliest.localeCompare(b.earliest) || a.name.localeCompare(b.name));
}

export function matrixCsv(maps: KnowledgeMap[]): string {
  const cell = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [["Person", "Topic", "First known", "Confidence", "Knew", "Cites"].map(cell).join(",")];
  for (const m of maps) for (const e of m.entries) lines.push([e.personName, m.topic, e.firstKnownDate, e.confidence, e.knew, e.cites.map((c) => c.cite).join("; ")].map(cell).join(","));
  return lines.join("\r\n") + "\r\n";
}

export function matrixMarkdown(maps: KnowledgeMap[]): string {
  const rows = matrixRows(maps);
  const head = `| Person | ${maps.map((m) => m.topic).join(" | ")} |`;
  const sep = `|---|${maps.map(() => "---").join("|")}|`;
  const body = rows.map((r) => `| ${r.name} | ${maps.map((m) => { const c = r.cells.get(m.id); return c ? `${c.entry.firstKnownDate} (${c.entry.confidence}) — ${c.entry.knew.replace(/\|/g, "/")} [${c.entry.cites.map((x) => x.cite).join("; ")}]` : "—"; }).join(" | ")} |`);
  return `# Who knew what, when\n\n${rows.length} people × ${maps.length} topics\n\n${[head, sep, ...body].join("\n")}\n\n${maps.map((m) => `## ${m.topic}\n\n${m.narrative}\n`).join("\n")}`;
}

const CONF_TEXT: Record<string, string> = { high: "high", medium: "med", low: "low" };

export function KnowledgeMatrix({ matterId, maps, loading, aiConfigured, topics, onSelectPerson, onOpenDocument, onChanged }: { matterId: string; maps: KnowledgeMap[]; loading: boolean; aiConfigured: boolean; topics: string[]; onSelectPerson: (id: string) => void; onOpenDocument?: (id: string) => void; onChanged: () => void }) {
  const openTestimony = useOpenTestimony();
  const [topic, setTopic] = React.useState("");
  const [running, setRunning] = React.useState(false);
  const [noKey, setNoKey] = React.useState(false);
  const rows = React.useMemo(() => matrixRows(maps), [maps]);
  const run = async () => {
    if (!topic.trim()) return;
    setRunning(true); setNoKey(false);
    try { const r = await api<{ map: KnowledgeMap }>("/api/ediscovery/analysis/knowledge-map", { method: "POST", json: { matterId, topic: topic.trim() } }); onChanged(); setTopic(""); toast.success(`Mapped “${r.map.topic}”`, { description: `${r.map.entries.length} people · verified against the record` }); }
    catch (e) { if (isNoKey(e)) setNoKey(true); else toast.error("Could not map the topic", { description: (e as Error).message }); }
    finally { setRunning(false); }
  };
  const cite = (c: KnowledgeMap["entries"][number]["cites"][number], map: KnowledgeMap) => {
    const unresolved = map.provenance?.verification?.unresolvedCites?.some((u) => u.toUpperCase() === c.cite.toUpperCase()) || !c.sourceId;
    return <CiteChip key={c.cite} cite={c.cite} kind={c.sourceKind} unresolved={unresolved} onClick={c.sourceId ? () => (c.sourceKind === "document" ? onOpenDocument?.(c.sourceId!) : openTestimony(c.sourceId!, c.cite)) : undefined} />;
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="toolbar">
        <span className="text-[12.5px] font-semibold">Who knew what, when</span>
        <span className="text-[11px] tabular text-muted-foreground">{rows.length} people · {maps.length} topic{maps.length === 1 ? "" : "s"}</span>
        <span className="flex-1" />
        <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); void run(); }}>
          <Input size="xs" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Topic — e.g. PFOS persistence and half-life" className="w-[280px]" aria-label="Topic to map" list="km-topics" />
          <datalist id="km-topics">{topics.map((t) => <option key={t} value={t} />)}</datalist>
          <KeyHint configured={aiConfigured}><Button size="xs" type="submit" disabled={running || !topic.trim()}>{running ? <Loader2 className="size-3.5 animate-spin" /> : <ListChecks className="size-3.5" />} Map topic</Button></KeyHint>
        </form>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button size="xs" variant="outline" disabled={!maps.length}><Download className="size-3.5" /> Export</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => downloadText("who-knew-what-when.csv", matrixCsv(maps), "text/csv;charset=utf-8")}><Download className="size-4" /> CSV</DropdownMenuItem>
            <DropdownMenuItem onClick={() => exportMarkdownToWord({ title: "Who knew what, when", markdown: matrixMarkdown(maps), matterId, tags: ["knowledge-map", "ediscovery"] })}><FileText className="size-4" /> Word</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {(noKey || (!aiConfigured && !loading)) && <div className="shrink-0 border-b px-3 py-2"><NoKeyCallout feature="Knowledge maps" compact /></div>}
      <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        {loading && !maps.length ? <div className="p-3 text-[12px] text-muted-foreground">Loading…</div> : !maps.length ? (
          <div className="p-6"><EmptyState icon={Users} title="No topics mapped yet" description="Map a topic to see, for each person, the earliest date the record shows they knew it, with the Bates and page:line cites. Every map is verified against the documents and transcripts before it is saved." /></div>
        ) : (
          <table className="w-max min-w-full border-collapse text-[12px]">
            <thead className="sticky top-0 z-10 bg-background">
              <tr className="grid-head">
                <th className="sticky left-0 z-20 w-[200px] min-w-[200px] border-b border-r bg-background px-3 py-1.5 text-left">Person</th>
                {maps.map((m) => (
                  <th key={m.id} className="min-w-[170px] max-w-[240px] border-b border-r px-3 py-1.5 text-left align-top font-medium text-foreground">
                    <div className="truncate" title={m.topic}>{m.topic}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] font-normal text-muted-foreground"><ProvenanceBadge record={m} /><span className="tabular">{formatShortDate(m.createdAt.slice(0, 10))}</span></div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="row-hover">
                  <td className="sticky left-0 z-10 border-b border-r bg-background px-3 py-1">
                    {r.personId ? <button type="button" onClick={() => onSelectPerson(r.personId!)} className="font-medium hover:underline cursor-pointer">{r.name}</button> : <span className="font-medium">{r.name}</span>}
                    <span className="ml-2 text-[10.5px] tabular text-muted-foreground">{formatShortDate(r.earliest)}</span>
                  </td>
                  {maps.map((m) => {
                    const c = r.cells.get(m.id);
                    if (!c) return <td key={m.id} className="border-b border-r px-3 py-1 text-muted-foreground/60">—</td>;
                    return (
                      <td key={m.id} className="border-b border-r p-0 align-top">
                        <Popover>
                          <PopoverTrigger asChild>
                            <button type="button" className={cn("flex h-7 w-full items-center gap-2 px-3 text-left hover:bg-accent/60 cursor-pointer")} title={c.entry.knew}>
                              <span className="tabular font-medium">{formatShortDate(c.entry.firstKnownDate)}</span>
                              <span className={cn("text-[10.5px]", c.entry.confidence === "low" ? "text-warning-foreground dark:text-warning" : "text-muted-foreground")}>{CONF_TEXT[c.entry.confidence] ?? c.entry.confidence}</span>
                              <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted-foreground">{c.entry.knew}</span>
                            </button>
                          </PopoverTrigger>
                          <PopoverContent align="start" className="w-[380px] p-3 text-[12px]">
                            <div className="text-[11px] text-muted-foreground">{r.name} · {c.map.topic}</div>
                            <div className="mt-1 leading-relaxed">{c.entry.knew}</div>
                            <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground"><span className="tabular">First evidence {formatShortDate(c.entry.firstKnownDate)}</span><span>·</span><span>confidence {c.entry.confidence}</span><ProvenanceBadge record={c.map} /></div>
                            <div className="mt-2 flex flex-wrap gap-1">{c.entry.cites.map((x) => cite(x, c.map))}</div>
                          </PopoverContent>
                        </Popover>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
