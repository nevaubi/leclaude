"use client";

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public payload?: unknown) { super(message); this.name = "ApiError"; }
}

/** Small fetch wrapper: JSON in/out, throws ApiError with the server's message and code. */
export async function api<T>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(url, { ...rest, headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers ?? {}) }, body: json !== undefined ? JSON.stringify(json) : rest.body });
  const text = await res.text();
  let payload: unknown = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!res.ok) {
    const p = payload as { error?: string; code?: string } | null;
    throw new ApiError(p?.error ?? `${res.status} ${res.statusText}`, res.status, p?.code, payload);
  }
  return payload as T;
}

export const isNoKeyError = (e: unknown) => e instanceof ApiError && (e.code === "no_api_key" || e.status === 503);

/** Trigger a browser download for text content. */
export function downloadText(filename: string, content: string, mime = "text/markdown;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function downloadFromResponse(res: Response, fallbackName: string) {
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") ?? "";
  const m = cd.match(/filename="?([^";]+)"?/);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = m?.[1] ?? fallbackName; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
