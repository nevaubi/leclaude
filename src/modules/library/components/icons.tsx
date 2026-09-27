"use client";
import { Folder, FolderOpen, LayoutTemplate, Link2, StickyNote, TextQuote, FileText, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LibraryItemType } from "@/lib/types/domain";
import { OfficeAppIcon, officeKindForType } from "@/modules/office/shared/office-app-icon";

/** Line icons for the non-office types; office types (docx/xlsx/pptx/pdf) render their application mark. */
export const TYPE_ICON: Record<LibraryItemType, LucideIcon> = { folder: Folder, docx: FileText, xlsx: FileText, pptx: FileText, pdf: FileText, template: LayoutTemplate, clause: TextQuote, link: Link2, note: StickyNote };

/** Quiet by default: every line icon is muted; the application marks carry the only colour. */
export const TYPE_COLOR: Record<LibraryItemType, string> = {
  folder: "text-muted-foreground",
  docx: "text-muted-foreground",
  xlsx: "text-muted-foreground",
  pptx: "text-muted-foreground",
  pdf: "text-muted-foreground",
  template: "text-muted-foreground",
  clause: "text-muted-foreground",
  link: "text-muted-foreground",
  note: "text-muted-foreground",
};

/** Kept for callers that expect a background class; the look is tile-free now. */
export const TYPE_BG: Record<LibraryItemType, string> = { folder: "", docx: "", xlsx: "", pptx: "", pdf: "", template: "", clause: "", link: "", note: "" };

const PX = { sm: 16, md: 20, lg: 28 } as const;

export function TypeIcon({ type, open, className }: { type: LibraryItemType; open?: boolean; className?: string }) {
  const office = officeKindForType(type);
  if (office) return <OfficeAppIcon kind={office} size={16} className={className} />;
  const Icon = type === "folder" && open ? FolderOpen : TYPE_ICON[type];
  return <Icon className={cn("size-4 shrink-0", TYPE_COLOR[type], className)} aria-hidden />;
}

/** Larger mark for cards and the preview header; no background tile. */
export function TypeGlyph({ type, size = "md", className }: { type: LibraryItemType; size?: "sm" | "md" | "lg"; className?: string }) {
  const office = officeKindForType(type);
  if (office) return <OfficeAppIcon kind={office} size={PX[size]} className={className} />;
  const Icon = TYPE_ICON[type];
  return <Icon className={cn("shrink-0", TYPE_COLOR[type], className)} style={{ width: PX[size], height: PX[size] }} aria-hidden />;
}
