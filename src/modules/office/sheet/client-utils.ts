"use client";
import type { Workbook } from "./model";

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function safeName(title: string) {
  return (title || "workbook").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "workbook";
}

export async function downloadXlsx(workbook: Workbook, title: string, docId?: string) {
  const res = await fetch("/api/office/sheet/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ docId, content: workbook, title, format: "xlsx" }) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({ error: res.statusText }))).error ?? res.statusText);
  downloadBlob(await res.blob(), `${safeName(title)}.xlsx`);
}

export async function downloadCsv(workbook: Workbook, title: string, sheet: string, docId?: string) {
  const res = await fetch("/api/office/sheet/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ docId, content: workbook, title, format: "csv", sheet }) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({ error: res.statusText }))).error ?? res.statusText);
  downloadBlob(await res.blob(), `${safeName(title)}-${safeName(sheet)}.csv`);
}

export async function importFile(file: File, matterId?: string | null): Promise<{ url: string }> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("kind", "sheet");
  if (matterId) fd.append("matterId", matterId);
  const res = await fetch("/api/office/import", { method: "POST", body: fd });
  if (!res.ok) throw new Error((await res.json().catch(() => ({ error: res.statusText }))).error ?? res.statusText);
  return (await res.json()) as { url: string };
}

export function printWorkbook() {
  window.print();
}

export function isMac() {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
}

export const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

export function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): T & { cancel: () => void } {
  let t: ReturnType<typeof setTimeout> | null = null;
  const wrapped = ((...args: Parameters<T>) => { if (t) clearTimeout(t); t = setTimeout(() => fn(...args), ms); }) as T & { cancel: () => void };
  wrapped.cancel = () => { if (t) clearTimeout(t); t = null; };
  return wrapped;
}
