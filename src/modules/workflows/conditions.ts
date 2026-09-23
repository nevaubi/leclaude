/**
 * Branch condition evaluation. Each rule has an ordered list of conditions
 * joined by "all" or "any"; the first matching rule wins and its id becomes the
 * source handle the run continues through. Pure and client-safe.
 */
import { resolveTemplate, stringify, type TemplateContext, type ResolveReport } from "./template-expr";

export type ConditionOp =
  | "equals" | "not_equals" | "contains" | "not_contains" | "starts_with" | "ends_with"
  | "gt" | "gte" | "lt" | "lte" | "is_empty" | "not_empty" | "in" | "not_in" | "regex" | "truthy" | "falsy";

export interface Condition { left: string; op: ConditionOp; right?: string }
export interface BranchRule { id: string; label?: string; logic?: "all" | "any"; conditions: Condition[] }

export const CONDITION_OPS: { value: ConditionOp; label: string; unary?: boolean }[] = [
  { value: "equals", label: "equals" },
  { value: "not_equals", label: "does not equal" },
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "does not contain" },
  { value: "starts_with", label: "starts with" },
  { value: "ends_with", label: "ends with" },
  { value: "gt", label: ">" },
  { value: "gte", label: "≥" },
  { value: "lt", label: "<" },
  { value: "lte", label: "≤" },
  { value: "in", label: "is one of (comma list)" },
  { value: "not_in", label: "is not one of" },
  { value: "regex", label: "matches regex" },
  { value: "is_empty", label: "is empty", unary: true },
  { value: "not_empty", label: "is not empty", unary: true },
  { value: "truthy", label: "is true", unary: true },
  { value: "falsy", label: "is false", unary: true },
];

function isEmpty(v: unknown) {
  return v == null || v === "" || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0);
}

function truthy(v: unknown) {
  if (typeof v === "string") { const t = v.trim().toLowerCase(); return !["", "false", "0", "no", "off", "null", "undefined"].includes(t); }
  if (Array.isArray(v)) return v.length > 0;
  return Boolean(v);
}

function num(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = Number(String(v ?? "").replace(/[^0-9.+-eE]/g, ""));
  return Number.isFinite(n) && String(v ?? "").trim() !== "" ? n : null;
}

function norm(v: unknown): string {
  return stringify(v).trim().toLowerCase();
}

function list(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(norm);
  return String(v ?? "").split(/[,\n]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/** Evaluate one condition against already-resolved operands. */
export function compare(op: ConditionOp, left: unknown, right: unknown): boolean {
  switch (op) {
    case "equals": {
      const ln = num(left), rn = num(right);
      if (ln != null && rn != null && typeof left !== "string") return ln === rn;
      if (typeof left === "boolean" || typeof right === "boolean") return truthy(left) === truthy(right);
      return norm(left) === norm(right);
    }
    case "not_equals": return !compare("equals", left, right);
    case "contains": return Array.isArray(left) ? left.map(norm).includes(norm(right)) : norm(left).includes(norm(right));
    case "not_contains": return !compare("contains", left, right);
    case "starts_with": return norm(left).startsWith(norm(right));
    case "ends_with": return norm(left).endsWith(norm(right));
    case "gt": { const a = num(left), b = num(right); return a != null && b != null ? a > b : norm(left) > norm(right); }
    case "gte": { const a = num(left), b = num(right); return a != null && b != null ? a >= b : norm(left) >= norm(right); }
    case "lt": { const a = num(left), b = num(right); return a != null && b != null ? a < b : norm(left) < norm(right); }
    case "lte": { const a = num(left), b = num(right); return a != null && b != null ? a <= b : norm(left) <= norm(right); }
    case "in": return list(right).includes(norm(left));
    case "not_in": return !list(right).includes(norm(left));
    case "regex": { try { return new RegExp(String(right ?? ""), "i").test(stringify(left)); } catch { return false; } }
    case "is_empty": return isEmpty(left);
    case "not_empty": return !isEmpty(left);
    case "truthy": return truthy(left);
    case "falsy": return !truthy(left);
    default: return false;
  }
}

export interface ConditionEvaluation { left: unknown; op: ConditionOp; right: unknown; result: boolean }
export interface RuleEvaluation { ruleId: string; label: string; matched: boolean; conditions: ConditionEvaluation[] }

export function evaluateRule(rule: BranchRule, ctx: TemplateContext, report?: ResolveReport): RuleEvaluation {
  const evals: ConditionEvaluation[] = (rule.conditions ?? []).map((c) => {
    const left = resolveTemplate(c.left ?? "", ctx, report);
    const right = c.right != null ? resolveTemplate(c.right, ctx, report) : undefined;
    return { left, op: c.op, right, result: compare(c.op, left, right) };
  });
  const logic = rule.logic ?? "all";
  const matched = evals.length === 0 ? false : logic === "any" ? evals.some((e) => e.result) : evals.every((e) => e.result);
  return { ruleId: rule.id, label: rule.label ?? rule.id, matched, conditions: evals };
}

/** First matching rule id, or "else". */
export function evaluateBranch(rules: BranchRule[], ctx: TemplateContext, report?: ResolveReport): { matched: string; label: string; evaluations: RuleEvaluation[] } {
  const evaluations: RuleEvaluation[] = [];
  for (const r of rules) {
    const ev = evaluateRule(r, ctx, report);
    evaluations.push(ev);
    if (ev.matched) return { matched: r.id, label: ev.label, evaluations };
  }
  return { matched: "else", label: "else", evaluations };
}
