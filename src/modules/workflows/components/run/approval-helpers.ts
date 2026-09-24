/**
 * Pure helpers for run approvals. A "trust gate" is an approval raised by the
 * engine when an action step would rely on AI output that is not yet trusted
 * (unverified, below the confidence gate, contradicted). No React here so the
 * logic is unit-tested directly (tests/ui-polish.test.ts).
 */
import type { RunApproval } from "../../types";

export function isTrustGate(a: Pick<RunApproval, "kind" | "reasons">): boolean {
  return a.kind === "trust-gate" || (a.kind == null && Array.isArray(a.reasons) && a.reasons.length > 0);
}

/** Button copy for a decision on an approval: gates are lifted or skipped, plain approvals approved or rejected. */
export function approvalVerbs(a: Pick<RunApproval, "kind" | "reasons">): { approve: string; reject: string; approvedToast: string; rejectedToast: string } {
  return isTrustGate(a)
    ? { approve: "Lift gate", reject: "Skip action", approvedToast: "Gate lifted — resuming", rejectedToast: "Action skipped — the run continues without it" }
    : { approve: "Approve", reject: "Reject", approvedToast: "Approved — resuming", rejectedToast: "Rejected" };
}
