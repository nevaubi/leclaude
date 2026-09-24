"use client";
import { FileSpreadsheet, FileText, FileType, Folder, FolderOpen, LayoutTemplate, Link2, Presentation, StickyNote, TextQuote, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LibraryItemType } from "@/lib/types/domain";

export const TYPE_ICON: Record<LibraryItemType, LucideIcon> = { folder: Folder, docx: FileText, xlsx: FileSpreadsheet, pptx: Presentation, pdf: FileType, template: LayoutTemplate, clause: TextQuote, link: Link2, note: StickyNote };

/** Token-based colors per type (chart tokens keep dark mode consistent). */
export const TYPE_COLOR: Record<LibraryItemType, string> = {
  folder: "text-warning",
  docx: "text-chart-1",
  xlsx: "text-chart-4",
  pptx: "text-chart-5",
  pdf: "text-destructive",
  template: "text-chart-2",
  clause: "text-primary",
  link: "text-info",
  note: "text-chart-3",
};

export const TYPE_BG: Record<LibraryItemType, string> = {
  folder: "bg-warning/12",
  docx: "bg-chart-1/12",
  xlsx: "bg-chart-4/12",
  pptx: "bg-chart-5/12",
  pdf: "bg-destructive/10",
  template: "bg-chart-2/12",
  clause: "bg-primary/10",
  link: "bg-info/12",
  note: "bg-chart-3/15",
};

export function TypeIcon({ type, open, className }: { type: LibraryItemType; open?: boolean; className?: string }) {
  const Icon = type === "folder" && open ? FolderOpen : TYPE_ICON[type];
  return <Icon className={cn("size-4 shrink-0", TYPE_COLOR[type], className)} />;
}

export function TypeGlyph({ type, size = "md", className }: { type: LibraryItemType; size?: "sm" | "md" | "lg"; className?: string }) {
  const Icon = TYPE_ICON[type];
  const sz = size === "sm" ? "size-7 [&>svg]:size-3.5" : size === "lg" ? "size-12 [&>svg]:size-6" : "size-9 [&>svg]:size-4.5";
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-lg", sz, TYPE_BG[type], TYPE_COLOR[type], className)}>
      <Icon />
    </span>
  );
}
