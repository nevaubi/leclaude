"use client";
import * as React from "react";
import { ArrowDownAZ, ArrowUpZA, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { colToLetter, toA1, type RangeRef } from "./a1";
import { cellValueOf } from "./cell-render";
import type { Computed } from "./engine";
import type { FilterCriteria, Sheet } from "./model";

const CONDITIONS: { id: NonNullable<FilterCriteria["condition"]>["op"]; label: string; needsValue: boolean }[] = [
  { id: "contains", label: "Contains", needsValue: true },
  { id: "notContains", label: "Does not contain", needsValue: true },
  { id: "startsWith", label: "Starts with", needsValue: true },
  { id: "eq", label: "Equals", needsValue: true },
  { id: "neq", label: "Not equal", needsValue: true },
  { id: "gt", label: "Greater than", needsValue: true },
  { id: "gte", label: "Greater or equal", needsValue: true },
  { id: "lt", label: "Less than", needsValue: true },
  { id: "lte", label: "Less or equal", needsValue: true },
  { id: "blank", label: "Is blank", needsValue: false },
  { id: "notBlank", label: "Is not blank", needsValue: false },
];

export function FilterPopover({ sheet, computed, col, header, x, y, onClose, onApply, onSort }: { sheet: Sheet; computed: Computed; col: number; header: RangeRef; x: number; y: number; onClose: () => void; onApply: (c: FilterCriteria | null) => void; onSort: (order: "asc" | "desc") => void }) {
  const letter = colToLetter(col);
  const existing = sheet.filters?.criteria[letter];
  const values = React.useMemo(() => {
    const set = new Map<string, number>();
    for (let r = header.start.row + 1; r <= header.end.row; r++) { const v = cellValueOf(sheet, toA1(r, col), computed); const s = v === null ? "" : String(v); set.set(s, (set.get(s) ?? 0) + 1); }
    return Array.from(set.entries()).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
  }, [sheet, computed, col, header]);
  const [checked, setChecked] = React.useState<Set<string>>(() => new Set(existing?.values ?? values.map((v) => v[0])));
  const [search, setSearch] = React.useState("");
  const [op, setOp] = React.useState<string>(existing?.condition?.op ?? "");
  const [cv, setCv] = React.useState<string>(existing?.condition?.value == null ? "" : String(existing.condition.value));
  const ref = React.useRef<HTMLDivElement>(null);
  const headerName = String(cellValueOf(sheet, toA1(header.start.row, col), computed) ?? letter);

  React.useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [onClose]);

  const filtered = values.filter((v) => !search || v[0].toLowerCase().includes(search.toLowerCase()));
  const allChecked = filtered.every((v) => checked.has(v[0]));
  const apply = () => {
    const all = checked.size === values.length;
    const cond = op ? { op: op as NonNullable<FilterCriteria["condition"]>["op"], value: cv === "" ? undefined : Number.isFinite(Number(cv)) && cv.trim() !== "" ? Number(cv) : cv } : undefined;
    if (all && !cond) onApply(null); else onApply({ values: all ? null : Array.from(checked), condition: cond });
    onClose();
  };

  return (
    <div ref={ref} className="fixed z-50 w-64 rounded-lg border bg-popover p-2 text-xs text-popover-foreground shadow-xl animate-fade-in" style={{ left: Math.min(x, window.innerWidth - 270), top: Math.min(y, window.innerHeight - 380) }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="mb-1.5 flex items-center justify-between px-1">
        <span className="truncate font-medium">{headerName}</span>
        <span className="text-[10px] text-muted-foreground">column {letter}</span>
      </div>
      <div className="mb-2 grid grid-cols-2 gap-1">
        <Button size="xs" variant="outline" onClick={() => onSort("asc")}><ArrowDownAZ className="size-3" /> Sort A → Z</Button>
        <Button size="xs" variant="outline" onClick={() => onSort("desc")}><ArrowUpZA className="size-3" /> Sort Z → A</Button>
      </div>
      <div className="mb-2 space-y-1 rounded-md border p-1.5">
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Condition</div>
        <select value={op} onChange={(e) => setOp(e.target.value)} className="h-7 w-full rounded-md border bg-background px-1.5 text-xs">
          <option value="">None</option>
          {CONDITIONS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        {op && CONDITIONS.find((c) => c.id === op)?.needsValue && <Input value={cv} onChange={(e) => setCv(e.target.value)} placeholder="Value" className="h-7 text-xs" onKeyDown={(e) => { if (e.key === "Enter") apply(); }} />}
      </div>
      <div className="relative mb-1"><Search className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search values" className="h-7 pl-6 text-xs" /></div>
      <label className="flex items-center gap-2 px-1 py-0.5 cursor-pointer"><Checkbox checked={allChecked} onCheckedChange={(c) => setChecked((s) => { const n = new Set(s); for (const v of filtered) { if (c) n.add(v[0]); else n.delete(v[0]); } return n; })} /> <span className="font-medium">(Select all)</span><span className="ml-auto text-[10px] text-muted-foreground">{values.length}</span></label>
      <div className="max-h-44 overflow-auto scrollbar-thin">
        {filtered.map(([v, n]) => (
          <label key={v} className={cn("flex items-center gap-2 rounded px-1 py-0.5 hover:bg-accent cursor-pointer")}>
            <Checkbox checked={checked.has(v)} onCheckedChange={(c) => setChecked((s) => { const nn = new Set(s); if (c) nn.add(v); else nn.delete(v); return nn; })} />
            <span className={cn("truncate", v === "" && "italic text-muted-foreground")}>{v === "" ? "(Blanks)" : v}</span>
            <span className="ml-auto text-[10px] text-muted-foreground tabular">{n}</span>
          </label>
        ))}
        {!filtered.length && <div className="px-1 py-2 text-muted-foreground">No values</div>}
      </div>
      <div className="mt-2 flex items-center justify-between gap-1">
        <Button size="xs" variant="ghost" onClick={() => { onApply(null); onClose(); }}>Clear</Button>
        <div className="flex gap-1"><Button size="xs" variant="outline" onClick={onClose}>Cancel</Button><Button size="xs" onClick={apply}>Apply</Button></div>
      </div>
    </div>
  );
}
