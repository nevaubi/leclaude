/**
 * Fill-handle autofill: extends a source run of cells into a target run.
 * Numbers → linear series (single number copies), ISO dates → day step,
 * "Item 3" → "Item 4", weekday/month names cycle, formulas shift relative refs,
 * everything else repeats.
 */
import { shiftFormula } from "./a1";
import { isoToSerial, serialToISO } from "./format";
import type { Cell } from "./model";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const WEEKDAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const QUARTERS = ["Q1", "Q2", "Q3", "Q4"];

function cycleList(v: string): string[] | null {
  for (const list of [WEEKDAYS, WEEKDAYS_SHORT, MONTHS, MONTHS_SHORT, QUARTERS]) if (list.some((x) => x.toLowerCase() === v.toLowerCase())) return list;
  return null;
}

function matchCase(template: string, value: string): string {
  if (template === template.toUpperCase()) return value.toUpperCase();
  if (template === template.toLowerCase()) return value.toLowerCase();
  return value;
}

export interface FillSource { cell: Cell | undefined; /** offset of this source cell from the first source cell along the fill axis */ index: number }

/**
 * Compute the cell to place at target position `k` (0-based, counting from the
 * first cell AFTER the source run) given the source run. `dRow`/`dCol` express
 * the geometric offset from the source cell used as the pattern origin for
 * formulas (one unit along the fill axis per step).
 */
export function autofillCell(source: (Cell | undefined)[], k: number, axis: "row" | "col", direction: 1 | -1): Cell | undefined {
  const n = source.length;
  if (!n) return undefined;
  // Pattern index within source cycling
  const srcIdx = direction === 1 ? k % n : (n - 1 - (k % n));
  const src = source[srcIdx];
  // geometric distance (in cells along the fill axis) from source cell srcIdx to target k
  const distance = direction === 1 ? (n - srcIdx) + k : -((srcIdx + 1) + k);
  if (!src) return undefined;
  const style = src.s ? { s: src.s } : {};
  if (src.f) {
    const dRow = axis === "row" ? distance : 0;
    const dCol = axis === "col" ? distance : 0;
    return { ...style, f: shiftFormula(src.f, dRow, dCol) };
  }
  const values = source.map((c) => c?.v);
  // numeric series
  const nums = values.map((v) => (typeof v === "number" ? v : null));
  if (nums.every((v) => v !== null) && n >= 2) {
    const step = (nums[n - 1]! - nums[0]!) / (n - 1);
    const pos = direction === 1 ? n + k : -(k + 1);
    const val = nums[0]! + step * pos;
    return { ...style, v: Number.isInteger(step) && Number.isInteger(nums[0]!) ? val : Number(val.toFixed(10)), t: "n" };
  }
  if (nums.every((v) => v !== null) && n === 1) return { ...style, v: nums[0]!, t: "n" };
  // date series
  const dates = values.map((v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? isoToSerial(v) : null));
  if (dates.every((v) => v !== null)) {
    const step = n >= 2 ? (dates[n - 1]! - dates[0]!) / (n - 1) : 1;
    const pos = direction === 1 ? n + k : -(k + 1);
    return { ...style, v: serialToISO(dates[0]! + step * pos), t: "d" };
  }
  // text with trailing number ("Item 3", "Vol. 2", "Depo 01")
  if (typeof src.v === "string") {
    const m = /^(.*?)(\d+)(\D*)$/.exec(src.v);
    const list = cycleList(src.v.trim());
    if (list) {
      const i = list.findIndex((x) => x.toLowerCase() === String(src.v).trim().toLowerCase());
      const next = list[(((i + distance) % list.length) + list.length) % list.length];
      return { ...style, v: matchCase(String(src.v).trim(), next), t: "s" };
    }
    if (m && n === 1) {
      const num = Number(m[2]) + distance;
      if (num < 0) return { ...style, v: src.v, t: "s" };
      return { ...style, v: `${m[1]}${String(num).padStart(m[2].length, "0")}${m[3]}`, t: "s" };
    }
    if (m && n >= 2) {
      // consistent prefix with incrementing numbers
      const parsed = values.map((v) => (typeof v === "string" ? /^(.*?)(\d+)(\D*)$/.exec(v) : null));
      if (parsed.every((p) => p && p[1] === m[1] && p[3] === m[3])) {
        const first = Number(parsed[0]![2]);
        const step = (Number(parsed[n - 1]![2]) - first) / (n - 1);
        const pos = direction === 1 ? n + k : -(k + 1);
        const num = Math.round(first + step * pos);
        if (num >= 0) return { ...style, v: `${m[1]}${String(num).padStart(m[2].length, "0")}${m[3]}`, t: "s" };
      }
    }
  }
  return { ...src };
}
