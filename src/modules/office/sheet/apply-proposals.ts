"use client";
/**
 * Apply agent proposals on the client. Every edit proposal carries the exact
 * SheetOp the server applied to its snapshot; we run it through the store
 * (undoable). Comment proposals go through the office comments API.
 */
import type { EditProposal } from "@/modules/office/shared/types";
import type { ApplyResult } from "@/modules/office/shared/agent-panel";
import { normalizeRange, parseRange, splitSheetRef } from "./a1";
import type { Workbook } from "./model";
import { opTarget, type SheetOp } from "./ops";
import type { SheetStore } from "./store";

export interface ApplyDeps {
  store: () => SheetStore;
  addComment: (input: { anchor: string; body: string; quote?: string; source?: "user" | "agent" }) => Promise<unknown>;
}

export async function applyProposals(proposals: EditProposal[], deps: ApplyDeps): Promise<ApplyResult> {
  const applied: string[] = [];
  const failed: { id: string; error: string }[] = [];
  const store = deps.store();
  const ops: { id: string; op: SheetOp }[] = [];
  for (const p of proposals) {
    if (p.kind === "add_comment") {
      const { anchor, text, quote } = p.payload as { anchor: string; text: string; quote?: string };
      try { await deps.addComment({ anchor, body: text, quote, source: "agent" }); applied.push(p.id); } catch (e) { failed.push({ id: p.id, error: (e as Error).message }); }
      continue;
    }
    const op = (p.payload as { op?: SheetOp }).op;
    if (!op) { failed.push({ id: p.id, error: "Proposal has no operation" }); continue; }
    ops.push({ id: p.id, op });
  }
  // Apply as one undoable batch so a single Undo reverts the whole agent turn.
  if (ops.length) {
    let wb: Workbook = store.workbook;
    const okIds: string[] = [];
    const good: SheetOp[] = [];
    for (const { id, op } of ops) {
      try { const { applyOp } = await import("./ops"); wb = applyOp(wb, op); good.push(op); okIds.push(id); }
      catch (e) { failed.push({ id, error: (e as Error).message }); }
    }
    if (good.length) {
      try { store.apply({ type: "batch", ops: good }); applied.push(...okIds); }
      catch (e) { for (const id of okIds) failed.push({ id, error: (e as Error).message }); }
    }
    const last = good[good.length - 1];
    if (last) {
      const target = opTarget(store.workbook, last);
      if (target) locateTarget(`${target.sheet}!${target.range}`, deps.store());
    }
  }
  return { applied, failed };
}

/** Select the target of a proposal / finding ("Sheet!A1:B4" or "A1"). */
export function locateTarget(target: string, store: SheetStore) {
  const { sheet, ref } = splitSheetRef(target);
  const wb = store.workbook;
  if (sheet) { const idx = wb.sheets.findIndex((s) => s.name === sheet || s.id === sheet); if (idx >= 0 && idx !== wb.activeSheet) store.setActiveSheet(idx); }
  try {
    const active = store.activeSheet();
    const r = normalizeRange(parseRange(ref, { maxRow: Math.max(1, Object.keys(active.cells).length ? 1000 : 100), maxCol: 30 }));
    store.selectRange(r);
  } catch { /* not a range (e.g. sheet-level proposal) */ }
}

/** Highlight the target range of a pending proposal without applying it. */
export function previewProposal(p: EditProposal | null, store: SheetStore) {
  if (!p || !p.target) { store.setPreview(null); return; }
  const { sheet, ref } = splitSheetRef(p.target);
  const wb = store.workbook;
  const s = sheet ? wb.sheets.find((x) => x.name === sheet || x.id === sheet) : wb.sheets[wb.activeSheet];
  if (!s) { store.setPreview(null); return; }
  try { store.setPreview({ sheetId: s.id, range: normalizeRange(parseRange(ref, { maxRow: 1000, maxCol: 30 })), kind: "proposal" }); } catch { store.setPreview(null); }
}
