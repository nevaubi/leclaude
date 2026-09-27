import "server-only";
import { kv } from "@/lib/db/kv";
import { setWorkspaceUser } from "@/lib/current-user";

/**
 * Workspace record written by first-run setup: the firm and the owner account. It replaces the
 * former hardcoded demo identity. Stored in kv so it lives and dies with the database.
 */
export interface WorkspaceOwner {
  id: string;
  name: string;
  email?: string;
  role?: string;
}

export interface Workspace {
  configured: boolean;
  firmName: string;
  owner: WorkspaceOwner | null;
  createdAt?: string;
  updatedAt?: string;
}

const KEY = "workspace";

export function defaultFirmName(): string {
  return process.env.NEXT_PUBLIC_FIRM_NAME?.trim() || "Your firm";
}

export function getWorkspace(): Workspace {
  const w = kv.get<Workspace>(KEY);
  if (w && w.owner) return { ...w, configured: true, firmName: w.firmName || defaultFirmName() };
  return { configured: false, firmName: w?.firmName || defaultFirmName(), owner: null };
}

export function saveWorkspace(input: { firmName: string; owner: WorkspaceOwner }): Workspace {
  const prev = kv.get<Workspace>(KEY);
  const now = new Date().toISOString();
  const next: Workspace = { configured: true, firmName: input.firmName.trim() || defaultFirmName(), owner: input.owner, createdAt: prev?.createdAt ?? now, updatedAt: now };
  kv.set(KEY, next);
  setWorkspaceUser({ id: input.owner.id, name: input.owner.name });
  return next;
}

/** Apply the stored owner as the current identity (called once per process at database init). */
export function applyWorkspaceIdentity(): void {
  const w = kv.get<Workspace>(KEY);
  setWorkspaceUser(w?.owner ? { id: w.owner.id, name: w.owner.name } : null);
}
