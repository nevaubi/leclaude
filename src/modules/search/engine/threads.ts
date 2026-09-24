import "server-only";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import type { SearchSettings } from "../types";
import { compactSource, mergeSources } from "./sources";
import type { ResearchMessage, ResearchPin, ResearchSource, ResearchThread } from "./types";

const CURRENT_USER = { id: "p_jwhitfield", name: "Jordan Whitfield" };
const MAX_THREADS = 200;
const MAX_SOURCES_PER_THREAD = 120;

export const threads = () => db().collection<ResearchThread>("search_threads");

export function threadTitle(question: string): string {
  const q = question.replace(/\s+/g, " ").trim();
  return q.length > 72 ? q.slice(0, 71).trimEnd() + "…" : q;
}

export function listThreads(limit = 40, matterId?: string | null): ResearchThread[] {
  return threads().list({ where: matterId ? (t) => t.matterId === matterId : undefined, sortBy: "updatedAt", direction: "desc", limit });
}

/** Lightweight rows for the rail (no messages/sources payload). */
export function listThreadSummaries(limit = 40) {
  return listThreads(limit).map((t) => ({ id: t.id, title: t.title, matterId: t.matterId, updatedAt: t.updatedAt, createdAt: t.createdAt, messages: t.messages.length, sources: t.sources.length, pins: t.pins.length, lastQuestion: [...t.messages].reverse().find((m) => m.role === "user")?.content ?? t.title }));
}

export function getThread(id: string): ResearchThread | null {
  return threads().get(id);
}

export function createThread(input: { id?: string; question: string; settings: SearchSettings; createdAt?: string }): ResearchThread {
  const now = input.createdAt ?? new Date().toISOString();
  const t: ResearchThread = { id: input.id ?? `thr_${nanoid(10)}`, title: threadTitle(input.question), matterId: input.settings.matterId ?? null, settings: input.settings, ownerId: CURRENT_USER.id, createdAt: now, updatedAt: now, messages: [], sources: [], pins: [], runIds: [] };
  threads().put(t);
  trimThreads();
  return t;
}

export function appendToThread(id: string, input: { question: string; answer: ResearchMessage; sources: ResearchSource[]; runId: string; settings?: SearchSettings }): ResearchThread | null {
  const t = threads().get(id);
  if (!t) return null;
  const now = new Date().toISOString();
  const user: ResearchMessage = { id: `msg_${nanoid(8)}`, role: "user", content: input.question, createdAt: input.answer.createdAt ?? now };
  const merged = mergeSources(t.sources, input.sources.map(compactSource));
  const next: ResearchThread = {
    ...t,
    settings: input.settings ?? t.settings,
    matterId: input.settings?.matterId ?? t.matterId,
    messages: [...t.messages, user, input.answer],
    sources: merged.slice(-MAX_SOURCES_PER_THREAD),
    runIds: [...t.runIds, input.runId],
    updatedAt: now,
  };
  threads().put(next);
  return next;
}

export function setThreadPins(id: string, pins: ResearchPin[]): ResearchThread | null {
  return threads().update(id, (t) => ({ ...t, pins: pins.slice(0, 200), updatedAt: new Date().toISOString() }));
}

export function renameThread(id: string, title: string): ResearchThread | null {
  return threads().update(id, (t) => ({ ...t, title: title.trim().slice(0, 120) || t.title, updatedAt: new Date().toISOString() }));
}

export function deleteThread(id: string): boolean {
  return threads().delete(id);
}

function trimThreads() {
  const all = threads().list({ sortBy: "updatedAt", direction: "desc" });
  for (const old of all.slice(MAX_THREADS)) threads().delete(old.id);
}
