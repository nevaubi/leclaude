/** Pure helpers for the condensed matter header (unit-tested; no React). */
import type { ChipTone } from "@/components/ui/misc";

/** Countdown label and tone for a production deadline, from days left. */
export function deadlineLabel(daysLeft: number): { label: string; tone: "destructive" | "warning" | "outline" } {
  if (daysLeft < 0) return { label: `${Math.abs(daysLeft)}d overdue`, tone: "destructive" };
  if (daysLeft === 0) return { label: "due today", tone: "destructive" };
  if (daysLeft <= 7) return { label: `in ${daysLeft}d`, tone: "destructive" };
  if (daysLeft <= 30) return { label: `in ${daysLeft}d`, tone: "warning" };
  if (daysLeft < 60) return { label: `in ${Math.round(daysLeft / 7)} wk`, tone: "outline" };
  return { label: `in ${Math.round(daysLeft / 30)} mo`, tone: "outline" };
}

/** Compact variant: tone + short label. */
export function deadlineChip(daysLeft: number): { tone: ChipTone; label: string } {
  if (daysLeft < 0) return { tone: "danger", label: `${Math.abs(daysLeft)}d overdue` };
  if (daysLeft === 0) return { tone: "danger", label: "today" };
  if (daysLeft <= 7) return { tone: "warning", label: `${daysLeft}d` };
  if (daysLeft <= 30) return { tone: "accent", label: `${daysLeft}d` };
  return { tone: "quiet", label: `${daysLeft}d` };
}
