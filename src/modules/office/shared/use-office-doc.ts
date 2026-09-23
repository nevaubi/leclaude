"use client";
import * as React from "react";
import { toast } from "sonner";
import type { OfficeDocument, OfficeKind, OfficeVersion, OfficeComment } from "@/lib/types/domain";

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

export interface UseOfficeDocOptions<C> {
  id: string; // "new" creates a doc on first save
  kind: OfficeKind;
  /** Initial content when creating a new doc (or a template id via `templateId`). */
  emptyContent: () => C;
  templateId?: string | null;
  matterId?: string | null;
  autosaveMs?: number;
}

/**
 * Loads an office document, tracks dirty state and autosaves. Content is held
 * in a ref (editors own their live state) and pushed via `markDirty(content)`.
 */
export function useOfficeDoc<C>(opts: UseOfficeDocOptions<C>) {
  const [doc, setDoc] = React.useState<OfficeDocument | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [saveState, setSaveState] = React.useState<SaveState>("idle");
  const [lastSavedAt, setLastSavedAt] = React.useState<Date | null>(null);
  const contentRef = React.useRef<C | null>(null);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const idRef = React.useRef(opts.id);
  const optsRef = React.useRef(opts);
  optsRef.current = opts;

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        if (opts.id === "new") {
          const res = await fetch("/api/office/docs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: opts.kind, content: opts.templateId ? undefined : opts.emptyContent(), templateId: opts.templateId ?? undefined, matterId: opts.matterId ?? undefined }) });
          if (!res.ok) throw new Error((await res.json().catch(() => ({ error: res.statusText }))).error);
          const { doc } = (await res.json()) as { doc: OfficeDocument };
          if (cancelled) return;
          idRef.current = doc.id;
          contentRef.current = doc.content as C;
          setDoc(doc);
          window.history.replaceState(null, "", `/office/${opts.kind}/${doc.id}`);
        } else {
          const res = await fetch(`/api/office/docs/${opts.id}`);
          if (!res.ok) throw new Error(res.status === 404 ? "Document not found" : res.statusText);
          const { doc } = (await res.json()) as { doc: OfficeDocument };
          if (cancelled) return;
          idRef.current = doc.id;
          contentRef.current = doc.content as C;
          setDoc(doc);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.id, opts.kind]);

  const save = React.useCallback(async (extra: { title?: string; version?: { label?: string; summary?: string; authorName?: string; force?: boolean }; meta?: Record<string, unknown>; matterId?: string | null } = {}) => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (!idRef.current || idRef.current === "new") return null;
    setSaveState("saving");
    try {
      const res = await fetch(`/api/office/docs/${idRef.current}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: contentRef.current, ...extra }) });
      if (!res.ok) throw new Error(res.statusText);
      const { doc: saved } = (await res.json()) as { doc: Omit<OfficeDocument, "content"> };
      setDoc((d) => (d ? { ...d, ...saved, content: contentRef.current } : d));
      setSaveState("saved");
      setLastSavedAt(new Date());
      return saved;
    } catch (e) {
      setSaveState("error");
      toast.error(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }, []);

  const markDirty = React.useCallback((content: C) => {
    contentRef.current = content;
    setSaveState("dirty");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void save(), optsRef.current.autosaveMs ?? 1500);
  }, [save]);

  const setTitle = React.useCallback(async (title: string) => {
    setDoc((d) => (d ? { ...d, title } : d));
    await save({ title });
  }, [save]);

  // flush on unload
  React.useEffect(() => {
    const onUnload = () => {
      if (saveState === "dirty" && idRef.current && idRef.current !== "new" && contentRef.current) {
        try { navigator.sendBeacon?.(`/api/office/docs/${idRef.current}`, new Blob([JSON.stringify({ content: contentRef.current })], { type: "application/json" })); } catch {}
      }
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [saveState]);

  const versions = React.useMemo(() => ({
    list: async () => { const r = await fetch(`/api/office/docs/${idRef.current}/versions`); return ((await r.json()) as { versions: Omit<OfficeVersion, "content">[] }).versions; },
    get: async (versionId: string) => { const r = await fetch(`/api/office/docs/${idRef.current}/versions?versionId=${versionId}`); return ((await r.json()) as { version: OfficeVersion }).version; },
    checkpoint: async (label: string) => { await save(); const r = await fetch(`/api/office/docs/${idRef.current}/versions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "checkpoint", label }) }); return r.ok; },
    restore: async (versionId: string) => { const r = await fetch(`/api/office/docs/${idRef.current}/versions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restore", versionId }) }); if (!r.ok) return null; const { doc } = (await r.json()) as { doc: OfficeDocument }; contentRef.current = doc.content as C; setDoc(doc); setSaveState("saved"); return doc; },
  }), [save]);

  const comments = React.useMemo(() => ({
    list: async () => { const r = await fetch(`/api/office/docs/${idRef.current}/comments`); return ((await r.json()) as { comments: OfficeComment[] }).comments; },
    add: async (input: { anchor: string; body: string; quote?: string; source?: "user" | "agent" }) => { const r = await fetch(`/api/office/docs/${idRef.current}/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }); return ((await r.json()) as { comment: OfficeComment }).comment; },
    update: async (commentId: string, patch: { resolved?: boolean; body?: string; reply?: string }) => { const r = await fetch(`/api/office/docs/${idRef.current}/comments`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ commentId, ...patch }) }); return ((await r.json()) as { comment: OfficeComment }).comment; },
    remove: async (commentId: string) => { await fetch(`/api/office/docs/${idRef.current}/comments?commentId=${commentId}`, { method: "DELETE" }); },
  }), []);

  const docId = doc?.id ?? idRef.current;
  return React.useMemo(
    () => ({ doc, docId, loading, error, saveState, lastSavedAt, contentRef, markDirty, save, setTitle, versions, comments }),
    [doc, docId, loading, error, saveState, lastSavedAt, markDirty, save, setTitle, versions, comments],
  );
}

export function saveStateLabel(state: SaveState, lastSavedAt: Date | null) {
  switch (state) {
    case "saving": return "Saving…";
    case "dirty": return "Unsaved changes";
    case "error": return "Save failed";
    case "saved": return lastSavedAt ? `Saved ${lastSavedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Saved";
    default: return "All changes saved";
  }
}
