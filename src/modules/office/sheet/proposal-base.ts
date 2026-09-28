/**
 * Base versions for agent proposals (constitution §31 / §44 "stale office edit").
 * Each proposal records content hashes of exactly what its op reads or overwrites
 * (the target range, the whole sheet for structural ops, or the workbook's sheet
 * list and names for workbook-level ops) as they were when the agent proposed it.
 * Before applying, the client recomputes those hashes on its current workbook and
 * rejects the proposal as stale on any mismatch — it never silently overwrites
 * cells the user changed in the meantime.
 */
import { hashValue, rangeHash } from "./hash";
import { getSheet, type Workbook } from "./model";
import { applyOp, opTarget, type SheetOp } from "./ops";

export interface ProposalBase {
  /** Model sheet id, or null for a workbook-level base. */
  sheetId: string | null;
  /** A1 range on the sheet, or null for the whole sheet / workbook. */
  range: string | null;
  hash: string;
  label: string;
}

const STRUCTURAL = new Set<SheetOp["type"]>(["insert_rows", "delete_rows", "insert_cols", "delete_cols", "sort_range", "replace_workbook"]);
const WORKBOOK_LEVEL = new Set<SheetOp["type"]>(["add_sheet", "rename_sheet", "delete_sheet", "reorder_sheet", "set_active_sheet", "add_named_range", "remove_named_range", "set_page_setup"]);

function workbookHash(wb: Workbook): string {
  return hashValue({ sheets: wb.sheets.map((s) => [s.id, s.name]), names: wb.namedRanges });
}

function basesFor(wb: Workbook, op: SheetOp, out: ProposalBase[]) {
  if (op.type === "batch") { for (const o of op.ops) basesFor(wb, o, out); return; }
  if (WORKBOOK_LEVEL.has(op.type)) { out.push({ sheetId: null, range: null, hash: workbookHash(wb), label: "workbook sheets and names" }); return; }
  let sheet;
  try { sheet = getSheet(wb, (op as { sheet?: string }).sheet ?? null); } catch { return; } // sheet created later in the same turn
  if (STRUCTURAL.has(op.type)) { out.push({ sheetId: sheet.id, range: null, hash: rangeHash(wb, sheet.id, null), label: `sheet "${sheet.name}"` }); return; }
  const t = opTarget(wb, op);
  if (!t) { out.push({ sheetId: sheet.id, range: null, hash: rangeHash(wb, sheet.id, null), label: `sheet "${sheet.name}"` }); return; }
  const target = wb.sheets.find((s) => s.name === t.sheet) ?? sheet;
  if (/^\d+:\d+$|^[A-Z]+:[A-Z]+$/.test(t.range)) { out.push({ sheetId: target.id, range: null, hash: rangeHash(wb, target.id, null), label: `sheet "${target.name}"` }); return; }
  out.push({ sheetId: target.id, range: t.range, hash: rangeHash(wb, target.id, t.range), label: `${target.name}!${t.range}` });
}

/** Base version of an op, computed on the workbook state the op will be applied to. */
export function proposalBase(wb: Workbook, op: SheetOp): ProposalBase[] {
  const out: ProposalBase[] = [];
  basesFor(wb, op, out);
  const seen = new Set<string>();
  return out.filter((b) => { const k = `${b.sheetId}|${b.range}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** Null when every base still matches `wb`; otherwise a human-readable reason. */
export function staleReason(wb: Workbook, bases: ProposalBase[] | undefined): string | null {
  if (!bases?.length) return null;
  for (const b of bases) {
    const now = b.sheetId === null ? workbookHash(wb) : rangeHash(wb, b.sheetId, b.range);
    if (now !== b.hash) return `Stale proposal: ${b.label} changed after the assistant proposed this edit. Ask the assistant again so it works from the current content.`;
  }
  return null;
}

export interface CheckedItem { id: string; op: SheetOp; base?: ProposalBase[] }

/**
 * Apply proposals in order, each checked against the running workbook. A stale or failing proposal is
 * rejected (never rebased silently) and the rest continue from the unchanged state.
 */
export function applyChecked(wb: Workbook, items: CheckedItem[]): { workbook: Workbook; applied: { id: string; op: SheetOp }[]; failed: { id: string; error: string; stale?: boolean }[] } {
  let cur = wb;
  const applied: { id: string; op: SheetOp }[] = [];
  const failed: { id: string; error: string; stale?: boolean }[] = [];
  for (const it of items) {
    const reason = staleReason(cur, it.base);
    if (reason) { failed.push({ id: it.id, error: reason, stale: true }); continue; }
    try { cur = applyOp(cur, it.op); applied.push({ id: it.id, op: it.op }); }
    catch (e) { failed.push({ id: it.id, error: (e as Error).message }); }
  }
  return { workbook: cur, applied, failed };
}
