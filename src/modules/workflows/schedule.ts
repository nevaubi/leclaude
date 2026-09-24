/** Schedule math shared by the scheduler (server) and the UI. Client-safe. */
import type { ScheduleConfig } from "./types";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function parseTime(t?: string): { h: number; m: number } {
  const m = String(t ?? "06:00").match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return { h: 6, m: 0 };
  return { h: Math.min(23, Number(m[1])), m: Math.min(59, Number(m[2])) };
}

export function normalizeSchedule(raw: unknown): ScheduleConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const frequency = String(s.frequency ?? "");
  if (!["hourly", "daily", "weekly", "monthly"].includes(frequency)) return null;
  const interval = Number(s.interval);
  return {
    frequency: frequency as ScheduleConfig["frequency"],
    time: typeof s.time === "string" ? s.time : "06:00",
    weekday: Number.isFinite(Number(s.weekday)) ? Math.max(0, Math.min(6, Number(s.weekday))) : 1,
    dayOfMonth: Number.isFinite(Number(s.dayOfMonth)) ? Math.max(1, Math.min(28, Number(s.dayOfMonth))) : 1,
    interval: frequency === "hourly" && Number.isFinite(interval) && interval > 1 ? Math.min(24, Math.floor(interval)) : undefined,
    weekdaysOnly: frequency === "daily" && s.weekdaysOnly === true ? true : undefined,
  };
}

function isWeekend(d: Date) { const wd = d.getDay(); return wd === 0 || wd === 6; }

/** The first occurrence strictly after `from` (server local time). */
export function nextRunAt(schedule: ScheduleConfig, from: Date): Date {
  const { h, m } = parseTime(schedule.time);
  const d = new Date(from);
  switch (schedule.frequency) {
    case "hourly": {
      const n = new Date(d);
      const every = schedule.interval && schedule.interval > 1 ? Math.floor(schedule.interval) : 1;
      n.setMinutes(m, 0, 0);
      if (every > 1) { n.setHours(n.getHours() + every); return n; }
      if (n <= d) n.setHours(n.getHours() + 1);
      return n;
    }
    case "daily": {
      const n = new Date(d);
      n.setHours(h, m, 0, 0);
      if (n <= d) n.setDate(n.getDate() + 1);
      if (schedule.weekdaysOnly) while (isWeekend(n)) n.setDate(n.getDate() + 1);
      return n;
    }
    case "weekly": {
      const n = new Date(d);
      n.setHours(h, m, 0, 0);
      const wd = schedule.weekday ?? 1;
      let diff = (wd - n.getDay() + 7) % 7;
      if (diff === 0 && n <= d) diff = 7;
      n.setDate(n.getDate() + diff);
      return n;
    }
    case "monthly": {
      const n = new Date(d);
      n.setHours(h, m, 0, 0);
      n.setDate(schedule.dayOfMonth ?? 1);
      if (n <= d) { n.setMonth(n.getMonth() + 1); n.setDate(schedule.dayOfMonth ?? 1); }
      return n;
    }
  }
}

export function describeSchedule(schedule: ScheduleConfig | null | undefined): string {
  if (!schedule) return "No schedule";
  const t = schedule.time ?? "06:00";
  switch (schedule.frequency) {
    case "hourly": return schedule.interval && schedule.interval > 1 ? `Every ${schedule.interval} hours` : `Hourly at :${parseTime(t).m.toString().padStart(2, "0")}`;
    case "daily": return schedule.weekdaysOnly ? `Weekdays at ${t}` : `Daily at ${t}`;
    case "weekly": return `Weekly on ${DAYS[schedule.weekday ?? 1]} at ${t}`;
    case "monthly": return `Monthly on day ${schedule.dayOfMonth ?? 1} at ${t}`;
  }
}

/** Approximate period of a schedule in milliseconds (used for "never fired" checks and staggering). */
export function schedulePeriodMs(schedule: ScheduleConfig | null | undefined): number {
  if (!schedule) return 0;
  switch (schedule.frequency) {
    case "hourly": return (schedule.interval && schedule.interval > 1 ? schedule.interval : 1) * 3600_000;
    case "daily": return 86400_000;
    case "weekly": return 7 * 86400_000;
    case "monthly": return 31 * 86400_000;
  }
}

export const SCHEDULE_PRESETS: { label: string; value: ScheduleConfig }[] = [
  { label: "Every weekday morning", value: { frequency: "daily", time: "06:00", weekdaysOnly: true } },
  { label: "Daily 06:00", value: { frequency: "daily", time: "06:00" } },
  { label: "Weekly (Monday 06:00)", value: { frequency: "weekly", time: "06:00", weekday: 1 } },
  { label: "Weekly (Friday 16:00)", value: { frequency: "weekly", time: "16:00", weekday: 5 } },
  { label: "Monthly (1st, 07:00)", value: { frequency: "monthly", time: "07:00", dayOfMonth: 1 } },
  { label: "Hourly", value: { frequency: "hourly", time: "00:00" } },
  { label: "Every 6 hours", value: { frequency: "hourly", time: "00:00", interval: 6 } },
];
