/**
 * Build context shared by the demo workspace builders (pure; no I/O).
 *
 * Task and calendar dates are computed relative to `now` so the demo always looks current; case facts, documents
 * and deposition dates are fixed.
 */
import { DEMO_TAG } from "../ids";

export interface DemoBuildContext {
  /** Load time. */
  now: Date;
  ownerId: string;
  ownerName: string;
  firmName: string;
  /** Email domain for the demo team members (the owner's domain when known). */
  emailDomain: string;
}

/** `meta` stamped on every demo record whose type carries meta. */
export const DEMO_META = { [DEMO_TAG.key]: DEMO_TAG.value, synthetic: true } as const;

export function demoMeta(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...DEMO_META, ...extra };
}

/** YYYY-MM-DD of `now` shifted by `days` (UTC calendar). */
export function dayOffset(now: Date, days: number): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days));
  return d.toISOString().slice(0, 10);
}

/** Like dayOffset, but moved forward (or back, for past dates) off a weekend so meetings land on business days. */
export function businessDay(now: Date, days: number): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days));
  const step = days < 0 ? -1 : 1;
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + step);
  return d.toISOString().slice(0, 10);
}

/** Local wall-clock timestamp (no zone), the format the home calendar stores: "2026-09-24T09:30:00". */
export function at(day: string, time: string): string {
  return `${day}T${time.length === 5 ? `${time}:00` : time}`;
}

/** ISO timestamp `hours` before now (for createdAt on tasks and updates). */
export function hoursAgo(now: Date, hours: number): string {
  return new Date(now.getTime() - hours * 3600_000).toISOString();
}

export function emailDomainOf(email: string | undefined): string {
  const m = /@([^@\s]+\.[^@\s]+)$/.exec(email ?? "");
  return m ? m[1].toLowerCase() : "example.com";
}
