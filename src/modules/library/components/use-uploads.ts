"use client";
import * as React from "react";
import { toast } from "sonner";
import { OFFICE_IMPORT_EXTENSIONS } from "../types";
import { api } from "./api";

export interface UploadResult { file: File; ok: boolean; kind: "office" | "blob"; url?: string; libraryItemId?: string; officeDocId?: string; error?: string }

interface OfficeImportResponse { doc: { id: string; title: string }; kind: string; url: string }
interface BlobResponse { id: string; url: string; size: number; mime: string; name?: string }

const TEXT_LIKE = /^(text\/|application\/json)/;

/**
 * Upload orchestration used by the Library and the Office home:
 * office-type files go to /api/office/import (and open in the editor);
 * everything else is stored as a blob and registered as a library link.
 * Auto-tagging runs afterwards through /api/library/ai (skipped without a key).
 */
export function useUploads(opts: { onDone?: (results: UploadResult[]) => void | Promise<void>; openSingle?: (url: string) => void }) {
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState<{ done: number; total: number; current?: string } | null>(null);
  const optsRef = React.useRef(opts);
  optsRef.current = opts;

  const upload = React.useCallback(async (files: File[] | FileList, target: { folderId?: string | null; matterId?: string | null } = {}) => {
    const list = Array.from(files);
    if (!list.length) return [] as UploadResult[];
    setBusy(true);
    setProgress({ done: 0, total: list.length, current: list[0]?.name });
    const id = toast.loading(`Uploading ${list.length} file${list.length === 1 ? "" : "s"}…`, { description: list[0]?.name });
    const results: UploadResult[] = [];
    for (const [i, file] of list.entries()) {
      setProgress({ done: i, total: list.length, current: file.name });
      toast.loading(`Uploading ${i + 1} of ${list.length}…`, { id, description: file.name });
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      try {
        if (OFFICE_IMPORT_EXTENSIONS.has(ext)) {
          const fd = new FormData();
          fd.append("file", file);
          if (target.folderId) fd.append("folderId", target.folderId);
          if (target.matterId) fd.append("matterId", target.matterId);
          const r = await api<OfficeImportResponse>("/api/office/import", { method: "POST", body: fd });
          results.push({ file, ok: true, kind: "office", url: r.url, officeDocId: r.doc.id });
          void api("/api/library/ai", { method: "POST", json: { action: "autotag", officeDocId: r.doc.id } }).catch(() => {});
        } else {
          const fd = new FormData();
          fd.append("file", file);
          const b = await api<BlobResponse>("/api/blobs", { method: "POST", body: fd });
          const item = await api<{ item: { id: string } }>("/api/library/items", { method: "POST", json: { type: "link", name: file.name, url: b.url, size: b.size, parentId: target.folderId ?? null, matterId: target.matterId ?? undefined, description: `Uploaded file · ${b.mime || "binary"} · ${formatSize(b.size)}`, tags: ["upload", ext || "file"].filter(Boolean) } });
          results.push({ file, ok: true, kind: "blob", url: b.url, libraryItemId: item.item.id });
          if (TEXT_LIKE.test(b.mime)) void api("/api/library/ai", { method: "POST", json: { action: "autotag", id: item.item.id } }).catch(() => {});
        }
      } catch (e) {
        results.push({ file, ok: false, kind: OFFICE_IMPORT_EXTENSIONS.has(ext) ? "office" : "blob", error: e instanceof Error ? e.message : String(e) });
      }
    }
    setProgress({ done: list.length, total: list.length });
    const ok = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    if (failed.length && !ok.length) toast.error(`Upload failed`, { id, description: failed[0].error });
    else if (failed.length) toast.warning(`${ok.length} uploaded, ${failed.length} failed`, { id, description: failed[0].error });
    else if (ok.length === 1 && ok[0].kind === "office" && ok[0].url) {
      const url = ok[0].url;
      toast.success(`Imported ${ok[0].file.name}`, { id, description: "Opening in the editor", action: { label: "Open", onClick: () => optsRef.current.openSingle?.(url) } });
    } else toast.success(`Uploaded ${ok.length} file${ok.length === 1 ? "" : "s"}`, { id, description: ok.map((r) => r.file.name).slice(0, 3).join(", ") });
    setBusy(false);
    setTimeout(() => setProgress(null), 800);
    await optsRef.current.onDone?.(results);
    if (ok.length === 1 && ok[0].kind === "office" && ok[0].url) optsRef.current.openSingle?.(ok[0].url);
    return results;
  }, []);

  return { upload, busy, progress };
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Native drag-and-drop helpers for file drops (distinguishes files from internal item drags). */
export function isFileDrag(e: React.DragEvent) {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

export const ITEM_DRAG_MIME = "application/x-leclaude-library-items";

export function readItemDrag(e: React.DragEvent): string[] {
  try { const raw = e.dataTransfer.getData(ITEM_DRAG_MIME); return raw ? (JSON.parse(raw) as string[]) : []; } catch { return []; }
}
