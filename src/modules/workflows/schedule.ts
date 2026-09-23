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
  return {
    frequency: frequency as ScheduleConfig["frequency"],
    time: typeof s.time === "string" ? s.time : "06:00",
    weekday: Number.isFinite(Number(s.weekday)) ? Math.max(0, Math.min(6, Number(s.weekday))) : 1,
    dayOfMonth: Number.isFinite(Number(s.dayOfMonth)) ? Math.max(1, Math.min(28, Number(s.dayOfMonth))) : 1,
  };
}

/** The first occurrence strictly after `from` (server local time). */
export function nextRunAt(schedule: ScheduleConfig, from: Date): Date {
  const { h, m } = parseTime(schedule.time);
  const d = new Date(from);
  switch (schedule.frequency) {
    case "hourly": {
      const n = new Date(d);
      n.setMinutes(m, 0, 0);
      if (n <= d) n.setHours(n.getHours() + 1);
      return n;
    }
    case "daily": {
      const n = new Date(d);
      n.setHours(h, m, 0, 0);
      if (n <= d) n.setDate(n.getDate() + 1);
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
    case "hourly": return `Hourly at :${parseTime(t).m.toString().padStart(2, "0")}`;
    case "daily": return `Daily at ${t}`;
    case "weekly": return `Weekly on ${DAYS[schedule.weekday ?? 1]} at ${t}`;
    case "monthly": return `Monthly on day ${schedule.dayOfMonth ?? 1} at ${t}`;
  }
}

export const SCHEDULE_PRESETS: { label: string; value: ScheduleConfig }[] = [
  { label: "Every weekday morning", value: { frequency: "daily", time: "06:00" } },
  { label: "Weekly (Monday 06:00)", value: { frequency: "weekly", time: "06:00", weekday: 1 } },
  { label: "Weekly (Friday 16:00)", value: { frequency: "weekly", time: "16:00", weekday: 5 } },
  { label: "Monthly (1st, 07:00)", value: { frequency: "monthly", time: "07:00", dayOfMonth: 1 } },
  { label: "Hourly", value: { frequency: "hourly", time: "00:00" } },
];
