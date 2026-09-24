import { beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.LECLAUDE_DATA_DIR = `${process.env.TMPDIR || "/tmp"}/evals-vitest-${process.pid}`;
  process.env.LECLAUDE_BACKGROUND = "off";
  process.env.WORKFLOW_SCHEDULER_DISABLED = "1";
  process.env.INTEL_OFFLINE = process.env.INTEL_OFFLINE ?? "1";
  if (process.env.LECLAUDE_EVALS !== "1") process.env.OPENAI_API_KEY = "";
});

import { db, resetSqlite } from "@/lib/db";
import { loadCases, modelReady, NEEDS_MODEL_NOTE, runCase } from "../evals/harness";

/**
 * The held-out legal evals (evals/cases) as a vitest suite. Deterministic cases always run and must pass;
 * cases whose model parts need a provider run those parts only with LECLAUDE_EVALS=1 and a key, and are
 * otherwise reported as skipped model checks (the deterministic parts still must pass).
 */
beforeAll(() => { resetSqlite(); db(); });

const cases = loadCases();

describe("eval case files", () => {
  it("record id, category, input, expected behavior, pass criteria and the constitution rule", () => {
    expect(cases.length).toBeGreaterThanOrEqual(12);
    for (const c of cases) {
      expect(c.id, c.id).toMatch(/^[a-z0-9-]+$/);
      expect(c.category).toBeTruthy();
      expect(c.title).toBeTruthy();
      expect(c.constitution).toMatch(/§/);
      expect(typeof c.input).toBe("object");
      expect(c.expected.length).toBeGreaterThan(20);
      expect(c.passCriteria.length).toBeGreaterThan(0);
      expect(["code", "model"]).toContain(c.grading);
      expect(typeof c.requiresModel).toBe("boolean");
    }
    const required = ["late-qualification", "wrong-bates", "cross-matter-name-collision", "citation-exists-but-does-not-support", "no-answer-in-record", "stale-office-edit", "privilege-cc", "adverse-authority", "nonexistent-document", "oversized-artifact", "hostile-content", "ambiguous-bates"];
    for (const id of required) expect(cases.map((c) => c.id)).toContain(id);
  });
});

describe("eval cases", () => {
  for (const c of cases) {
    it(`${c.id}: ${c.title}`, async () => {
      const r = await runCase(c);
      const failed = r.checks.filter((x) => !x.ok).map((x) => `${x.name}${x.actual ? ` — ${x.actual}` : ""}`);
      expect(failed, `${c.id} failed checks`).toEqual([]);
      expect(r.status).not.toBe("fail");
      if (c.requiresModel && !modelReady()) {
        expect(r.skippedChecks.length, "model checks are reported as skipped offline").toBeGreaterThan(0);
        expect(r.note).toContain(NEEDS_MODEL_NOTE);
      } else {
        expect(r.skippedChecks).toEqual([]);
      }
    }, 60_000);
  }
});
