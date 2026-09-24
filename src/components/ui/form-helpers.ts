/** Pure helpers for the form primitives (FileDrop, selects). No React. */

export interface DroppedFile { id: string; name: string; size: number; type: string; file?: File }

/** Normalise an accept list: ".pdf" | "pdf" | "application/pdf" | "image/*". */
export function normalizeAccept(accept: string[] | string | undefined): string[] {
  const list = Array.isArray(accept) ? accept : accept ? accept.split(",") : [];
  return list.map((a) => a.trim().toLowerCase()).filter(Boolean).map((a) => (a.includes("/") || a.startsWith(".") ? a : `.${a}`));
}

/** True when the file matches the accept list (extensions, exact MIME types or `type/*`). An empty list accepts everything. */
export function acceptsFile(name: string, type: string, accept: string[] | string | undefined): boolean {
  const rules = normalizeAccept(accept);
  if (!rules.length) return true;
  const lower = name.toLowerCase();
  const mime = (type || "").toLowerCase();
  return rules.some((r) => {
    if (r.startsWith(".")) return lower.endsWith(r);
    if (r.endsWith("/*")) return mime.startsWith(r.slice(0, -1));
    return mime === r;
  });
}

export function formatAccept(accept: string[] | string | undefined): string {
  return normalizeAccept(accept).map((a) => (a.startsWith(".") ? a.slice(1).toUpperCase() : a)).join(", ");
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

export interface AddFilesResult<T extends DroppedFile> { files: T[]; rejected: { name: string; reason: "type" | "size" | "count" | "duplicate" }[] }

/**
 * Merge incoming files into the list: duplicates (same name and size) are
 * skipped, the accept list and size cap are enforced, and `maxFiles` truncates.
 */
export function addFiles<T extends DroppedFile>(current: T[], incoming: T[], opts: { accept?: string[] | string; maxFiles?: number; maxSize?: number; multiple?: boolean } = {}): AddFilesResult<T> {
  const rejected: AddFilesResult<T>["rejected"] = [];
  const limit = opts.multiple === false ? 1 : opts.maxFiles ?? Infinity;
  const files: T[] = opts.multiple === false ? [] : [...current];
  for (const f of incoming) {
    if (!acceptsFile(f.name, f.type, opts.accept)) { rejected.push({ name: f.name, reason: "type" }); continue; }
    if (opts.maxSize != null && f.size > opts.maxSize) { rejected.push({ name: f.name, reason: "size" }); continue; }
    if (files.some((x) => x.name === f.name && x.size === f.size)) { rejected.push({ name: f.name, reason: "duplicate" }); continue; }
    if (files.length >= limit) { rejected.push({ name: f.name, reason: "count" }); continue; }
    files.push(f);
  }
  return { files, rejected };
}

export function describeFiles(files: { size: number }[]): string {
  if (!files.length) return "No files";
  const total = files.reduce((n, f) => n + f.size, 0);
  return `${files.length} file${files.length === 1 ? "" : "s"} · ${formatFileSize(total)}`;
}

/** Radix Select cannot hold an empty-string value; this sentinel stands in for "none". */
export const NONE_VALUE = "__none__";
