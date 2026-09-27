/* eslint-disable @next/next/no-img-element -- static brand marks from /public; next/image adds nothing for a 16px svg */
import * as React from "react";
import { cn } from "@/lib/utils";

/** Office document kinds that have an app mark. */
export type OfficeAppKind = "word" | "sheet" | "slides" | "pdf";

const FILE: Record<OfficeAppKind, string> = { word: "word", sheet: "excel", slides: "powerpoint", pdf: "pdf" };

/**
 * The application mark for an office document kind (Word, Excel, PowerPoint, PDF) from /public/brand/office.
 * Decorative: the surrounding text always names the kind, so the image is hidden from assistive technology.
 * 16px in rows, 20–24px in the "New" row; never on a background tile.
 */
export function OfficeAppIcon({ kind, size = 16, className }: { kind: OfficeAppKind; size?: number; className?: string }) {
  return <img src={`/brand/office/${FILE[kind] ?? "word"}.svg`} alt="" aria-hidden width={size} height={size} draggable={false} className={cn("inline-block shrink-0 select-none", className)} style={{ width: size, height: size }} />;
}

/** Map a file extension or library item type to an office kind (for rows that show files, not office docs). */
export function officeKindForType(type: string | undefined | null): OfficeAppKind | null {
  const t = (type ?? "").toLowerCase().replace(/^\./, "");
  if (t === "docx" || t === "doc" || t === "word" || t === "dotx") return "word";
  if (t === "xlsx" || t === "xls" || t === "csv" || t === "sheet" || t === "xlsm") return "sheet";
  if (t === "pptx" || t === "ppt" || t === "slides" || t === "potx") return "slides";
  if (t === "pdf") return "pdf";
  return null;
}
