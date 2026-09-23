/**
 * Deadline calculator (FRCP 6(a)-style) — pure, client-safe.
 *
 * Methods:
 *  - "frcp6a": count calendar days; when the period is under 11 days count
 *    only court days (skip weekends and federal holidays). If the last day
 *    lands on a weekend/holiday, roll to the next court day (or the previous
 *    one when counting backward — FRCP 6(a)(5)).
 *  - "calendar": plain calendar days with last-day rollover only.
 *  - "court": every day counted is a court day (weekends/holidays skipped).
 */

export type DeadlineMethod = "frcp6a" | "calendar" | "court";
export type DeadlineDirection = "forward" | "backward";

export interface DeadlineInput {
  /** Trigger/anchor date YYYY-MM-DD. */
  trigger: string;
  /** Number of days in the period (positive). */
  days: number;
  direction?: DeadlineDirection;
  method?: DeadlineMethod;
  /** FRCP 6(d): add 3 days when service was by mail (applied after rollover). */
  addMailDays?: boolean;
  /** Additional holidays (YYYY-MM-DD) such as court closures. */
  extraHolidays?: string[];
}

export interface DeadlineStep { date: string; counted: boolean; reason?: string }

export interface DeadlineResult {
  trigger: string;
  days: number;
  direction: DeadlineDirection;
  method: DeadlineMethod;
  /** Last day of the period before rollover. */
  rawDate: string;
  /** Final due date after rollover and mail days. */
  dueDate: string;
  rolled: boolean;
  rolledReason?: string;
  mailDaysAdded: number;
  weekday: string;
  countedCourtDaysOnly: boolean;
  skipped: { date: string; reason: string }[];
  holidaysInRange: { date: string; name: string }[];
  steps: DeadlineStep[];
}

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function parseDateOnly(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) throw new Error(`Invalid date: ${s}`);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function toDateOnly(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}

function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  // month 0-11, weekday 0-6, n 1-based
  const first = new Date(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return new Date(year, month, 1 + offset + (n - 1) * 7);
}

function lastWeekday(year: number, month: number, weekday: number): Date {
  const last = new Date(year, month + 1, 0);
  const offset = (last.getDay() - weekday + 7) % 7;
  return new Date(year, month, last.getDate() - offset);
}

function observed(d: Date): Date {
  if (d.getDay() === 6) return addDays(d, -1);
  if (d.getDay() === 0) return addDays(d, 1);
  return d;
}

/** Federal holidays (5 U.S.C. § 6103) for a year, with observed dates. */
export function federalHolidays(year: number): { date: string; name: string }[] {
  const list: { date: Date; name: string }[] = [
    { date: observed(new Date(year, 0, 1)), name: "New Year's Day" },
    { date: nthWeekday(year, 0, 1, 3), name: "Birthday of Martin Luther King, Jr." },
    { date: nthWeekday(year, 1, 1, 3), name: "Washington's Birthday" },
    { date: lastWeekday(year, 4, 1), name: "Memorial Day" },
    { date: observed(new Date(year, 5, 19)), name: "Juneteenth National Independence Day" },
    { date: observed(new Date(year, 6, 4)), name: "Independence Day" },
    { date: nthWeekday(year, 8, 1, 1), name: "Labor Day" },
    { date: nthWeekday(year, 9, 1, 2), name: "Columbus Day" },
    { date: observed(new Date(year, 10, 11)), name: "Veterans Day" },
    { date: nthWeekday(year, 10, 4, 4), name: "Thanksgiving Day" },
    { date: observed(new Date(year, 11, 25)), name: "Christmas Day" },
  ];
  // New Year's Day of the following year can be observed on Dec 31.
  const nextNY = observed(new Date(year + 1, 0, 1));
  if (nextNY.getFullYear() === year) list.push({ date: nextNY, name: "New Year's Day (observed)" });
  return list.map((h) => ({ date: toDateOnly(h.date), name: h.name })).sort((a, b) => a.date.localeCompare(b.date));
}

const holidayCache = new Map<number, Map<string, string>>();
function holidayMap(year: number): Map<string, string> {
  let m = holidayCache.get(year);
  if (!m) {
    m = new Map(federalHolidays(year).map((h) => [h.date, h.name]));
    holidayCache.set(year, m);
  }
  return m;
}

export function holidayName(date: string, extra: Set<string> = new Set()): string | null {
  const y = Number(date.slice(0, 4));
  return holidayMap(y).get(date) ?? (extra.has(date) ? "Court closure" : null);
}

export function isWeekend(date: string): boolean {
  const d = parseDateOnly(date).getDay();
  return d === 0 || d === 6;
}

export function isCourtDay(date: string, extra: Set<string> = new Set()): boolean {
  return !isWeekend(date) && !holidayName(date, extra);
}

export function nonCourtReason(date: string, extra: Set<string> = new Set()): string | null {
  const d = parseDateOnly(date).getDay();
  if (d === 0 || d === 6) return DOW[d];
  return holidayName(date, extra);
}

export function computeDeadline(input: DeadlineInput): DeadlineResult {
  const direction: DeadlineDirection = input.direction ?? "forward";
  const method: DeadlineMethod = input.method ?? "frcp6a";
  const days = Math.max(0, Math.floor(input.days));
  const extra = new Set(input.extraHolidays ?? []);
  const sign = direction === "forward" ? 1 : -1;
  const courtDaysOnly = method === "court" || (method === "frcp6a" && days < 11);

  const steps: DeadlineStep[] = [];
  const skipped: { date: string; reason: string }[] = [];
  let cursor = parseDateOnly(input.trigger);
  let counted = 0;
  let guard = 0;
  while (counted < days && guard++ < 5000) {
    cursor = addDays(cursor, sign);
    const iso = toDateOnly(cursor);
    const reason = courtDaysOnly ? nonCourtReason(iso, extra) : null;
    if (reason) {
      steps.push({ date: iso, counted: false, reason });
      skipped.push({ date: iso, reason });
    } else {
      counted++;
      steps.push({ date: iso, counted: true });
    }
  }
  const rawDate = toDateOnly(cursor);

  // Last-day rollover (FRCP 6(a)(1)(C), 6(a)(5)).
  let due = cursor;
  let rolled = false;
  let rolledReason: string | undefined;
  guard = 0;
  while (guard++ < 30) {
    const iso = toDateOnly(due);
    const reason = nonCourtReason(iso, extra);
    if (!reason) break;
    rolled = true;
    rolledReason = rolledReason ?? `${iso} is ${DOW.includes(reason) ? "a " + reason : reason}`;
    due = addDays(due, sign);
  }

  // FRCP 6(d): 3 added days after the period would otherwise expire, then roll again.
  let mailDaysAdded = 0;
  if (input.addMailDays && direction === "forward") {
    due = addDays(due, 3);
    mailDaysAdded = 3;
    guard = 0;
    while (guard++ < 30 && nonCourtReason(toDateOnly(due), extra)) due = addDays(due, 1);
  }

  const dueDate = toDateOnly(due);
  const [lo, hi] = [input.trigger, dueDate].sort();
  const years = new Set([Number(lo.slice(0, 4)), Number(hi.slice(0, 4))]);
  const holidaysInRange = Array.from(years).flatMap((y) => federalHolidays(y)).filter((h) => h.date >= lo && h.date <= hi);

  return {
    trigger: input.trigger,
    days,
    direction,
    method,
    rawDate,
    dueDate,
    rolled,
    rolledReason,
    mailDaysAdded,
    weekday: DOW[due.getDay()],
    countedCourtDaysOnly: courtDaysOnly,
    skipped,
    holidaysInRange,
    steps,
  };
}

/** Common rule presets shown in the calculator UI. */
export const DEADLINE_PRESETS: { id: string; label: string; days: number; direction: DeadlineDirection; method: DeadlineMethod; rule: string; mail?: boolean }[] = [
  { id: "answer21", label: "Answer to complaint", days: 21, direction: "forward", method: "frcp6a", rule: "FRCP 12(a)(1)(A)(i)" },
  { id: "answer60", label: "Answer after waiver of service", days: 60, direction: "forward", method: "frcp6a", rule: "FRCP 12(a)(1)(A)(ii)" },
  { id: "resp14", label: "Response to motion (14 days)", days: 14, direction: "forward", method: "frcp6a", rule: "Local rule default" },
  { id: "reply7", label: "Reply brief (7 days)", days: 7, direction: "forward", method: "frcp6a", rule: "Local rule default" },
  { id: "disc30", label: "Discovery responses", days: 30, direction: "forward", method: "frcp6a", rule: "FRCP 33(b)(2), 34(b)(2)(A), 36(a)(3)" },
  { id: "disc30mail", label: "Discovery responses (served by mail)", days: 30, direction: "forward", method: "frcp6a", rule: "FRCP 33(b)(2) + 6(d)", mail: true },
  { id: "appeal30", label: "Notice of appeal (civil)", days: 30, direction: "forward", method: "frcp6a", rule: "FRAP 4(a)(1)(A)" },
  { id: "rule59", label: "Rule 59(e) motion", days: 28, direction: "forward", method: "frcp6a", rule: "FRCP 59(e)" },
  { id: "expert90", label: "Expert disclosures before trial", days: 90, direction: "backward", method: "frcp6a", rule: "FRCP 26(a)(2)(D)(i)" },
  { id: "rebuttal30", label: "Rebuttal expert disclosure", days: 30, direction: "forward", method: "frcp6a", rule: "FRCP 26(a)(2)(D)(ii)" },
  { id: "pretrial30", label: "Pretrial disclosures before trial", days: 30, direction: "backward", method: "frcp6a", rule: "FRCP 26(a)(3)(B)" },
  { id: "depo14", label: "Deposition notice (14 days)", days: 14, direction: "backward", method: "frcp6a", rule: "FRCP 32(a)(5)(A)" },
];
