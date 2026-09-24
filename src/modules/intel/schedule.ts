/** Schedule math for intel sources. Client-safe (no node imports). */
import type { IntelEvery, IntelSchedule, IntelSource } from "./types";

export const EVERY_MS: Record<Exclude<IntelEvery, "manual" | "daily" | "weekly">, number> = { "10m": 10 * 60_000, "1h": 3600_000, "6h": 6 * 3600_000 };

/** Approximate period for freshness checks ("has this source fired within N periods?"). */
export function periodMs(schedule: IntelSchedule): number | undefined {
  switch (schedule.every) {
    case "manual": return undefined;
    case "daily": return 86400_000;
    case "weekly": return 7 * 86400_000;
    default: return EVERY_MS[schedule.every];
  }
}

function parseAt(at?: string): { h: number; m: number } {
  const m = (at ?? "06:00").match(/^(\d{1,2}):(\d{2})$/);
  return m ? { h: Math.min(23, Number(m[1])), m: Math.min(59, Number(m[2])) } : { h: 6, m: 0 };
}

/** First run strictly after `from` (server local time for daily/weekly). `undefined` for manual sources. */
export function computeNextRunAt(schedule: IntelSchedule, from: Date): Date | undefined {
  switch (schedule.every) {
    case "manual": return undefined;
    case "10m":
    case "1h":
    case "6h": return new Date(from.getTime() + EVERY_MS[schedule.every]);
    case "daily": {
      const { h, m } = parseAt(schedule.at);
      const n = new Date(from);
      n.setHours(h, m, 0, 0);
      if (n <= from) n.setDate(n.getDate() + 1);
      return n;
    }
    case "weekly": {
      const { h, m } = parseAt(schedule.at);
      const wd = Math.max(0, Math.min(6, schedule.weekday ?? 1));
      const n = new Date(from);
      n.setHours(h, m, 0, 0);
      let diff = (wd - n.getDay() + 7) % 7;
      if (diff === 0 && n <= from) diff = 7;
      n.setDate(n.getDate() + diff);
      return n;
    }
  }
}

export function isSourceDue(source: Pick<IntelSource, "enabled" | "schedule" | "nextRunAt" | "status">, now: Date): boolean {
  if (!source.enabled || source.schedule.every === "manual") return false;
  if (!source.nextRunAt) return true;
  return new Date(source.nextRunAt).getTime() <= now.getTime();
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function describeIntelSchedule(schedule: IntelSchedule): string {
  switch (schedule.every) {
    case "manual": return "Manual";
    case "10m": return "Every 10 minutes";
    case "1h": return "Hourly";
    case "6h": return "Every 6 hours";
    case "daily": return `Daily at ${schedule.at ?? "06:00"}`;
    case "weekly": return `Weekly on ${DAYS[schedule.weekday ?? 1]} at ${schedule.at ?? "06:00"}`;
  }
}

/** Exponential backoff with jitter: 30s, 1m, 2m, 4m … capped at 1h. */
export function backoffMs(attempt: number, base = 30_000, cap = 3600_000, random: () => number = Math.random): number {
  const exp = Math.min(cap, base * Math.pow(2, Math.max(0, attempt - 1)));
  const jitter = exp * 0.2 * (random() - 0.5);
  return Math.round(Math.min(cap, exp + jitter));
}
