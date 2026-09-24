"use client";
import * as React from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tip } from "@/components/ui/tooltip";
import { isRangeRef, normalizeRange, parseRange, rangeToA1, toA1 } from "./a1";
import { useSheetStore } from "./store";

/** Name box + fx + formula input. Editing here mirrors the in-cell editor through the store. */
export function FormulaBar({ onFocusGrid }: { onFocusGrid: () => void }) {
  const workbook = useSheetStore((s) => s.workbook);
  const selection = useSheetStore((s) => s.selection);
  const editing = useSheetStore((s) => s.editing);
  const computed = useSheetStore((s) => s.computed);
  const store = useSheetStore;
  const sheet = workbook.sheets[workbook.activeSheet] ?? workbook.sheets[0];
  const activeRef = toA1(selection.active.row, selection.active.col);
  const primary = selection.ranges[selection.ranges.length - 1];
  const rangeLabel = primary && (primary.start.row !== primary.end.row || primary.start.col !== primary.end.col) ? rangeToA1(primary) : activeRef;
  const named = Object.entries(workbook.namedRanges).find(([, ref]) => ref.replace(/^.*!/, "") === rangeLabel && (ref.includes("!") ? ref.split("!")[0].replace(/'/g, "") === sheet.name : true))?.[0];
  const [nameBox, setNameBox] = React.useState(named ?? rangeLabel);
  const [nameFocus, setNameFocus] = React.useState(false);
  React.useEffect(() => { if (!nameFocus) setNameBox(named ?? rangeLabel); }, [rangeLabel, named, nameFocus]);

  const cell = sheet.cells[activeRef];
  const cellText = cell?.f ? cell.f : cell?.v === undefined || cell?.v === null ? "" : typeof cell.v === "boolean" ? (cell.v ? "TRUE" : "FALSE") : String(cell.v);
  const value = editing?.value ?? cellText;
  const computedValue = cell?.f ? computed[sheet.id]?.[activeRef]?.v : undefined;

  const jump = () => {
    const raw = nameBox.trim();
    if (!raw) return;
    const st = store.getState();
    const namedRef = workbook.namedRanges[raw] ?? Object.entries(workbook.namedRanges).find(([k]) => k.toLowerCase() === raw.toLowerCase())?.[1];
    const target = namedRef ?? raw;
    const bang = target.indexOf("!");
    const sheetName = bang > 0 ? target.slice(0, bang).replace(/^'|'$/g, "") : null;
    const refPart = bang > 0 ? target.slice(bang + 1) : target;
    if (!isRangeRef(refPart)) { if (!namedRef) { st.apply({ type: "add_named_range", name: raw, ref: `${sheet.name}!${rangeLabel}` }); } return; }
    if (sheetName) st.setActiveSheet(sheetName);
    try { st.selectRange(normalizeRange(parseRange(refPart, { maxRow: 1000, maxCol: 60 }))); } catch { /* ignore */ }
    setNameFocus(false);
    onFocusGrid();
  };

  return (
    <div data-formula-bar="1" className="flex h-8 shrink-0 items-center gap-1 border-b bg-background px-2 text-xs">
      <Tip label="Name box — type a cell, range or name and press Enter (typing a new name defines it for the selection)">
        <input value={nameBox} onChange={(e) => setNameBox(e.target.value)} onFocus={(e) => { setNameFocus(true); e.target.select(); }} onBlur={() => setNameFocus(false)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); jump(); } if (e.key === "Escape") { setNameBox(rangeLabel); onFocusGrid(); } }} aria-label="Name box" className="h-6 w-28 shrink-0 rounded border bg-background px-1.5 font-mono text-[11px] outline-none focus:border-ring" />
      </Tip>
      <span className="select-none px-1 font-serif italic text-muted-foreground">fx</span>
      {editing && (
        <div className="flex shrink-0 items-center">
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => { store.getState().cancelEdit(); onFocusGrid(); }} className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-destructive cursor-pointer" aria-label="Cancel"><X className="size-3.5" /></button>
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => { store.getState().commitEdit(null); onFocusGrid(); }} className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-success cursor-pointer" aria-label="Confirm"><Check className="size-3.5" /></button>
        </div>
      )}
      <input
        value={value}
        onChange={(e) => { const st = store.getState(); if (!st.editing) st.startEdit({ source: "formulaBar", initial: e.target.value }); else st.updateEdit(e.target.value); }}
        onFocus={() => { const st = store.getState(); if (!st.editing) st.startEdit({ source: "formulaBar" }); }}
        onKeyDown={(e) => {
          const st = store.getState();
          if (e.key === "Enter") { e.preventDefault(); st.commitEdit({ dRow: e.shiftKey ? -1 : 1, dCol: 0 }); onFocusGrid(); }
          else if (e.key === "Tab") { e.preventDefault(); st.commitEdit({ dRow: 0, dCol: e.shiftKey ? -1 : 1 }); onFocusGrid(); }
          else if (e.key === "Escape") { e.preventDefault(); st.cancelEdit(); onFocusGrid(); }
        }}
        onBlur={() => { setTimeout(() => { const st = store.getState(); if (st.editing?.source === "formulaBar" && !document.activeElement?.closest?.("[data-editor]")) st.commitEdit(null); }, 0); }}
        spellCheck={false}
        aria-label="Formula"
        placeholder={`Enter a value or formula for ${activeRef}`}
        className={cn("h-6 min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 outline-none focus:border-ring focus:bg-background", value.startsWith("=") && "font-mono text-[11.5px]")}
      />
      {computedValue !== undefined && !editing && <span className="hidden max-w-[220px] truncate text-[11px] text-muted-foreground lg:inline" title="Computed value">= {computedValue === null ? "" : String(computedValue)}</span>}
    </div>
  );
}
