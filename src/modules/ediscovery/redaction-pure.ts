/**
 * Redaction helpers (pure, client-safe, unit-tested): normalise and merge
 * character ranges, apply text redactions, and describe reasons/labels.
 */
import type { Redaction, RedactionReason } from "@/lib/types/domain";

export const REDACTION_REASONS: { id: RedactionReason; label: string; defaultLabel: string }[] = [
  { id: "privilege", label: "Privilege", defaultLabel: "REDACTED — PRIVILEGED" },
  { id: "pii", label: "Personal information", defaultLabel: "REDACTED — PII" },
  { id: "phi", label: "Health information", defaultLabel: "REDACTED — PHI" },
  { id: "confidential", label: "Confidential", defaultLabel: "REDACTED — CONFIDENTIAL" },
  { id: "trade-secret", label: "Trade secret", defaultLabel: "REDACTED — TRADE SECRET" },
  { id: "non-responsive", label: "Non-responsive", defaultLabel: "REDACTED — NON-RESPONSIVE" },
  { id: "other", label: "Other", defaultLabel: "REDACTED" },
];

export function defaultRedactionLabel(reason: RedactionReason): string {
  return REDACTION_REASONS.find((r) => r.id === reason)?.defaultLabel ?? "REDACTED";
}

export type TextRange = { start: number; end: number; label: string };

/** Clamp, drop empty and merge overlapping/adjacent ranges (first label wins on overlap). */
export function mergeRanges(ranges: TextRange[], length: number): TextRange[] {
  const clean = ranges
    .map((r) => ({ start: Math.max(0, Math.min(length, Math.floor(r.start))), end: Math.max(0, Math.min(length, Math.ceil(r.end))), label: r.label }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out: TextRange[] = [];
  for (const r of clean) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

/** Text redactions of a document as merged ranges. */
export function textRanges(redactions: Redaction[], length: number): TextRange[] {
  return mergeRanges(redactions.filter((r) => r.kind === "text" && r.start != null && r.end != null).map((r) => ({ start: r.start!, end: r.end!, label: r.label })), length);
}

/** Replace each redacted range with a bracketed label ("[REDACTED — PRIVILEGED]"); line breaks inside the range are kept so page layout survives. */
export function applyTextRedactions(text: string, redactions: Redaction[]): { text: string; applied: number } {
  const ranges = textRanges(redactions, text.length);
  if (!ranges.length) return { text, applied: 0 };
  let out = "";
  let cursor = 0;
  for (const r of ranges) {
    out += text.slice(cursor, r.start);
    const removed = text.slice(r.start, r.end);
    const breaks = removed.match(/\n/g)?.length ?? 0;
    out += `[${r.label}]` + "\n".repeat(breaks);
    cursor = r.end;
  }
  out += text.slice(cursor);
  return { text: out, applied: ranges.length };
}

/** Split text into rendered segments for the viewer overlay: plain runs and redacted runs. */
export function segmentText(text: string, redactions: Redaction[]): { text: string; redaction?: Redaction }[] {
  const items = redactions.filter((r) => r.kind === "text" && r.start != null && r.end != null).sort((a, b) => a.start! - b.start!);
  const out: { text: string; redaction?: Redaction }[] = [];
  let cursor = 0;
  for (const r of items) {
    const start = Math.max(cursor, Math.min(text.length, r.start!));
    const end = Math.max(start, Math.min(text.length, r.end!));
    if (end <= start) continue;
    if (start > cursor) out.push({ text: text.slice(cursor, start) });
    out.push({ text: text.slice(start, end), redaction: r });
    cursor = end;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor) });
  return out;
}

/** Validate a redaction input; returns the first problem or null. */
export function validateRedaction(input: Partial<Redaction>, textLength: number, pages: number): string | null {
  if (input.kind === "text") {
    if (typeof input.start !== "number" || typeof input.end !== "number") return "A text redaction needs start and end offsets";
    if (input.start < 0 || input.end > textLength || input.end <= input.start) return `Range must lie within the text (0–${textLength}) and be non-empty`;
    return null;
  }
  if (input.kind === "page") {
    if (typeof input.page !== "number" || input.page < 1 || input.page > Math.max(1, pages)) return `Page must be between 1 and ${Math.max(1, pages)}`;
    const r = input.rect;
    if (!r || [r.x, r.y, r.w, r.h].some((v) => typeof v !== "number" || !Number.isFinite(v))) return "A page redaction needs a rectangle";
    if (r.x < 0 || r.y < 0 || r.w <= 0 || r.h <= 0 || r.x + r.w > 1.0001 || r.y + r.h > 1.0001) return "Rectangle must be normalised to the page (0..1)";
    return null;
  }
  return "kind must be text or page";
}

/** Rectangles for a page (0..1 normalised), in creation order. */
export function pageRects(redactions: Redaction[], page: number): Redaction[] {
  return redactions.filter((r) => r.kind === "page" && r.page === page && r.rect);
}
