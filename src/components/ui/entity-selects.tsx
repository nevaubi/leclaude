"use client";
import * as React from "react";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";
import { NONE_VALUE, flattenFolders, type FolderOption, type FolderTreeNode } from "./form-helpers";

export { flattenFolders, type FolderOption } from "./form-helpers";

/**
 * Entity pickers for workflow front ends and forms. Each accepts explicit
 * options; when none are given the list is loaded once from /api/library/tree
 * (matters, people and folders in one payload) and cached for the session.
 */

export interface MatterOption { id: string; shortName: string; name?: string; caption?: string }
export interface PersonOption { id: string; name: string; title?: string }
interface TreePayload {
  roots?: FolderTreeNode[];
  matters?: { id: string; shortName: string; name?: string }[];
  people?: { id: string; name: string }[];
}

let treePromise: Promise<TreePayload | null> | null = null;
function loadTree(): Promise<TreePayload | null> {
  if (!treePromise) {
    treePromise = fetch("/api/library/tree").then((r) => (r.ok ? (r.json() as Promise<TreePayload>) : null)).catch(() => null);
  }
  return treePromise;
}

/** Test hook: forget the cached payload (e.g. after creating a folder). */
export function resetEntityCache() { treePromise = null; }


function useTree<T>(pick: (t: TreePayload) => T[], explicit?: T[]): T[] {
  const [loaded, setLoaded] = React.useState<T[]>([]);
  React.useEffect(() => {
    if (explicit) return;
    let alive = true;
    void loadTree().then((t) => { if (alive && t) setLoaded(pick(t)); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [explicit === undefined]);
  return explicit ?? loaded;
}

interface BaseProps {
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  placeholder?: string;
  /** Offer a "None" row that clears the value. */
  allowNone?: boolean;
  noneLabel?: string;
  size?: "xs" | "sm" | "default";
  disabled?: boolean;
  className?: string;
  id?: string;
  ariaLabel?: string;
}

function EntitySelect({ value, onChange, placeholder, allowNone, noneLabel = "None", size = "sm", disabled, className, id, ariaLabel, options }: BaseProps & { options: { value: string; label: React.ReactNode; text: string }[] }) {
  return (
    <Select value={value ?? (allowNone ? NONE_VALUE : "")} onValueChange={(v) => onChange(v === NONE_VALUE ? null : v)} disabled={disabled}>
      <SelectTrigger id={id} size={size} className={cn("w-full", className)} aria-label={ariaLabel}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {allowNone && <SelectItem value={NONE_VALUE}><span className="text-muted-foreground">{noneLabel}</span></SelectItem>}
        {options.map((o) => <SelectItem key={o.value} value={o.value} textValue={o.text}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export function MatterSelect({ matters, ...p }: BaseProps & { matters?: MatterOption[] }) {
  const list = useTree<MatterOption>((t) => (t.matters ?? []).map((m) => ({ id: m.id, shortName: m.shortName, name: m.name })), matters);
  return <EntitySelect {...p} placeholder={p.placeholder ?? "Matter"} ariaLabel={p.ariaLabel ?? "Matter"} options={list.map((m) => ({ value: m.id, text: `${m.shortName} ${m.name ?? ""}`, label: <span className="inline-flex min-w-0 items-baseline gap-1.5"><span className="truncate">{m.shortName}</span>{(m.caption ?? m.name) && <span className="truncate text-[11px] text-muted-foreground">{m.caption ?? m.name}</span>}</span> }))} />;
}

export function PersonSelect({ people, ...p }: BaseProps & { people?: PersonOption[] }) {
  const list = useTree<PersonOption>((t) => (t.people ?? []).map((x) => ({ id: x.id, name: x.name })), people);
  return <EntitySelect {...p} placeholder={p.placeholder ?? "Person"} ariaLabel={p.ariaLabel ?? "Person"} options={list.map((x) => ({ value: x.id, text: x.name, label: <span className="inline-flex min-w-0 items-baseline gap-1.5"><span className="truncate">{x.name}</span>{x.title && <span className="truncate text-[11px] text-muted-foreground">{x.title}</span>}</span> }))} />;
}

/** Library folder picker (indented by depth), loaded from /api/library/tree. */
export function FolderSelect({ folders, ...p }: BaseProps & { folders?: FolderOption[] }) {
  const list = useTree<FolderOption>((t) => flattenFolders(t.roots), folders);
  return <EntitySelect {...p} placeholder={p.placeholder ?? "Folder"} ariaLabel={p.ariaLabel ?? "Library folder"} noneLabel={p.noneLabel ?? "Library root"} options={list.map((f) => ({ value: f.id, text: f.path ?? f.name, label: <span className="inline-flex min-w-0 items-center" style={{ paddingLeft: (f.depth ?? 0) * 10 }}>{f.name}</span> }))} />;
}
