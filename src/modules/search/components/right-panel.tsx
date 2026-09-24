"use client";
import * as React from "react";
import { PanelRightClose } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import type { ClaimVerdictView, ResearchSource } from "../engine/types";
import type { LaneView } from "./use-research";
import { useSearchStore, type PanelTab } from "./store";
import { LivePanel } from "./live-panel";
import { SourcesPanel } from "./sources-panel";
import { MapPanel } from "./map-panel";
import { PinsPanel, type PinsPanelProps } from "./pins-panel";

export interface RightPanelProps extends PinsPanelProps {
  lanes: LaneView[];
  sources: ResearchSource[];
  sourceMap: Record<string, ResearchSource>;
  verdicts: ClaimVerdictView[];
  streaming: boolean;
  onClose: () => void;
}

const TABS: { id: PanelTab; label: string }[] = [{ id: "live", label: "Live" }, { id: "sources", label: "Sources" }, { id: "map", label: "Map" }, { id: "pins", label: "Pins" }];

export function RightPanel(p: RightPanelProps) {
  const tab = useSearchStore((s) => s.panelTab);
  const setTab = useSearchStore((s) => s.setPanelTab);
  const pins = useSearchStore((s) => s.pins.length);
  const counts: Record<PanelTab, number> = { live: p.lanes.length, sources: p.sources.length, map: 0, pins };
  return (
    <aside className="flex h-full min-h-0 w-full flex-col bg-background" aria-label="Research panel">
      <div className="flex h-11 shrink-0 items-center gap-0.5 border-b px-2">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={cn("relative flex h-11 items-center gap-1.5 px-2.5 text-[12.5px] font-medium transition-colors cursor-pointer", tab === t.id ? "text-foreground" : "text-muted-foreground hover:text-foreground")} aria-selected={tab === t.id} role="tab">
            {t.label}
            {counts[t.id] > 0 && <span className={cn("rounded-full px-1.5 text-[10px] tabular", tab === t.id ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>{counts[t.id]}</span>}
            {tab === t.id && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-t bg-primary" />}
          </button>
        ))}
        <div className="flex-1" />
        <Tip label="Hide panel" shortcut="]"><Button variant="ghost" size="icon-xs" onClick={p.onClose} aria-label="Hide panel"><PanelRightClose className="size-4" /></Button></Tip>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin" role="tabpanel">
        {tab === "live" && <LivePanel lanes={p.lanes} sources={p.sourceMap} streaming={p.streaming} />}
        {tab === "sources" && <SourcesPanel sources={p.sources} />}
        {tab === "map" && <MapPanel question={p.question} lanes={p.lanes} sources={p.sources} verdicts={p.verdicts} />}
        {tab === "pins" && <PinsPanel question={p.question} answer={p.answer} jurisdictionLabel={p.jurisdictionLabel} matter={p.matter} userName={p.userName} />}
      </div>
    </aside>
  );
}
