/**
 * Pure helpers for the office chrome (no React, no DOM) so they can be unit
 * tested under vitest's node environment. office-chrome.tsx re-exports them.
 */
import type * as React from "react";
import type { LucideIcon } from "lucide-react";
import type { OfficeKind } from "@/lib/types/domain";
import type { Provenance } from "@/lib/integrity/types";
import type { EditProposal } from "./types";

export type ChromeSaveState = "idle" | "dirty" | "saving" | "saved" | "error";

/** Any icon component: lucide icons or a compatible `{ className }` component. */
export type IconLike = LucideIcon | React.ComponentType<{ className?: string }>;

/** File-type badge shown in the editor header. */
export const KIND_BADGE: Record<OfficeKind, string> = { word: "DOCX", sheet: "XLSX", slides: "PPTX", pdf: "PDF" };

export interface ChromeMenuItem { label: React.ReactNode; icon?: IconLike; onSelect?: () => void; shortcut?: string; hint?: string; disabled?: boolean; destructive?: boolean; href?: string; download?: string }
export type ChromeMenuEntry = ChromeMenuItem | "separator" | { heading: string };

/** Download menu item (alternative shape accepted by OfficeChrome's `download`). */
export interface DownloadItem { id: string; label: React.ReactNode; icon?: IconLike; onSelect?: () => void; shortcut?: string; hint?: string; separatorBefore?: boolean; disabled?: boolean; href?: string; download?: string }

export function downloadItemsToEntries(items: DownloadItem[]): ChromeMenuEntry[] {
  const out: ChromeMenuEntry[] = [];
  for (const it of items) {
    if (it.separatorBefore && out.length) out.push("separator");
    out.push({ label: it.label, icon: it.icon, onSelect: it.onSelect, shortcut: it.shortcut, hint: it.hint, disabled: it.disabled, href: it.href, download: it.download });
  }
  return out;
}


export function saveTone(state: ChromeSaveState): "muted" | "warning" | "destructive" {
  if (state === "error") return "destructive";
  if (state === "dirty" || state === "saving") return "warning";
  return "muted";
}

export function saveButtonLabel(state: ChromeSaveState): string {
  switch (state) {
    case "saving": return "Saving…";
    case "dirty": return "Save";
    case "error": return "Retry";
    default: return "Saved";
  }
}

export function formatClock(d: Date): string {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** "Saved 3:08 PM" / "Unsaved changes" / "Saving…" / "Save failed" / "All changes saved". */
export function savedAtLabel(state: ChromeSaveState, lastSavedAt: Date | null): string {
  switch (state) {
    case "saving": return "Saving…";
    case "dirty": return "Unsaved changes";
    case "error": return "Save failed";
    case "saved": return lastSavedAt ? `Saved ${formatClock(lastSavedAt)}` : "Saved";
    default: return lastSavedAt ? `Saved ${formatClock(lastSavedAt)}` : "All changes saved";
  }
}

function looksLikeProvenance(x: unknown): x is Provenance {
  return Boolean(x && typeof x === "object" && typeof (x as Provenance).model === "string" && typeof (x as Provenance).generatedAt === "string" && Array.isArray((x as Provenance).sources));
}

/**
 * The office agent stream ends with an `office-provenance` artifact. Older servers send the run
 * provenance directly; newer ones send `{ run, proposals: [{id, provenance}], findings: [...] }`.
 * Accept both and return the run-level provenance plus per-proposal provenance when present.
 */
export function extractRunProvenance(data: unknown): { run: Provenance | null; proposals: Record<string, Provenance>; findings: Record<string, Provenance> } {
  const out = { run: null as Provenance | null, proposals: {} as Record<string, Provenance>, findings: {} as Record<string, Provenance> };
  if (!data || typeof data !== "object") return out;
  if (looksLikeProvenance(data)) { out.run = data; return out; }
  const d = data as { run?: unknown; provenance?: unknown; proposals?: unknown; findings?: unknown };
  if (looksLikeProvenance(d.run)) out.run = d.run;
  else if (looksLikeProvenance(d.provenance)) out.run = d.provenance;
  for (const [key, bucket] of [["proposals", out.proposals], ["findings", out.findings]] as const) {
    const list = d[key];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const it = item as { id?: unknown; provenance?: unknown };
      if (typeof it?.id === "string" && looksLikeProvenance(it.provenance)) bucket[it.id] = it.provenance;
    }
  }
  return out;
}

/** Research was requested but the run read nothing: warn before anyone relies on the answer. */
export function needsNotSourceBackedBanner(research: boolean, provenance: Provenance | null | undefined): boolean {
  if (!research) return false;
  if (!provenance) return true;
  return provenance.sources.length === 0;
}

export type AuditedProposalStatus = "applied" | "discarded" | "failed";

/** Body for POST /api/office/docs/[id]/audit-apply: the proposals with their final status and provenance. */
export function proposalAuditPayload(proposals: (EditProposal & { provenance?: Provenance })[], statusOf: (p: EditProposal) => AuditedProposalStatus, extra: { mode?: string; message?: string } = {}) {
  return {
    proposals: proposals.map((p) => ({ id: p.id, kind: p.kind, title: p.title, summary: p.summary?.slice(0, 300), target: p.target, targetLabel: p.targetLabel, risk: p.risk, status: statusOf(p), provenance: p.provenance })),
    mode: extra.mode,
    message: extra.message?.slice(0, 300),
  };
}

/** Compact "Comments (3)" style label. */
export function countLabel(label: string, count: number | undefined): string {
  return count ? `${label} (${count})` : label;
}

/** Approximate page count from words: legal double-spaced pages run ~275 words, 1.15 spacing ~500. */
export function approximatePages(words: number, lineSpacing: number): number {
  const perPage = lineSpacing >= 2 ? 275 : lineSpacing >= 1.5 ? 360 : 500;
  return Math.max(1, Math.ceil(words / perPage));
}

// ---------------------------------------------------------------------------
// Status-bar / strip labels and platform hints (used by the Sheet, Slides and
// PDF editors; tested in tests/office-chrome-labels.test.ts).
// ---------------------------------------------------------------------------

/** Upper-case file-type badge label: DOCX / XLSX / PPTX / PDF. */
export function kindBadgeLabel(kind: OfficeKind): string {
  return KIND_BADGE[kind];
}

/** "5 tracked changes" / "1 tracked change" / "No tracked changes". */
export function trackedChangesLabel(count: number): string {
  if (count <= 0) return "No tracked changes";
  return `${count} tracked change${count === 1 ? "" : "s"}`;
}

/** "3 / 5" position label, or "–" when there is nothing to step through. */
export function changePositionLabel(index: number, count: number): string {
  if (count <= 0) return "–";
  return `${Math.max(0, Math.min(index, count - 1)) + 1} / ${count}`;
}

export function pluralize(n: number, noun: string, plural = `${noun}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? noun : plural}`;
}

/** "Rows 1–100" style range label for the sheet status bar. */
export function rowRangeLabel(first: number, last: number): string {
  return first === last ? `Row ${first}` : `Rows ${first}–${last}`;
}

/** "Page 1 of 3". */
export function pageOfLabel(page: number, pages: number): string {
  return `Page ${Math.max(1, page)} of ${Math.max(1, pages)}`;
}

/** Platform modifier for shortcut hints: ⌘ on Apple platforms, Ctrl elsewhere. */
export function modKeyFor(platform: string | undefined): "⌘" | "Ctrl" {
  if (!platform) return "⌘";
  if (/Mac|iPhone|iPad|iPod/i.test(platform)) return "⌘";
  return /Win|Linux|Android|CrOS|X11/i.test(platform) ? "Ctrl" : "⌘";
}

/** Rewrites "⌘" in a shortcut hint for the current platform. */
export function shortcutFor(hint: string, mod: "⌘" | "Ctrl"): string {
  return mod === "Ctrl" ? hint.replace(/⌘/g, "Ctrl+") : hint;
}

/** Viewports narrower than this open editors with side panels collapsed. */
export const NARROW_VIEWPORT = 1180;
