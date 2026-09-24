/**
 * Eval runner: `npx tsx evals/run.ts [caseId ...] [--json]`.
 * Exits 1 when any case fails; skips (no model provider) never fail the run. Uses a scratch database.
 */
import Module from "node:module";
import os from "node:os";
import path from "node:path";

// The app's server modules import "server-only", which only resolves inside Next; point it at the test shim.
const M = Module as unknown as { _resolveFilename: (request: string, ...rest: unknown[]) => string };
const originalResolve = M._resolveFilename;
M._resolveFilename = function (request: string, ...rest: unknown[]) {
  if (request === "server-only") return path.resolve(__dirname, "../tests/server-only-shim.ts");
  return originalResolve.call(this, request, ...rest);
};

process.env.LECLAUDE_DATA_DIR = process.env.LECLAUDE_EVALS_DATA_DIR?.trim() || path.join(os.tmpdir(), `leclaude-evals-${process.pid}`);
process.env.LECLAUDE_BACKGROUND = "off";
process.env.WORKFLOW_SCHEDULER_DISABLED = "1";
process.env.INTEL_OFFLINE = process.env.INTEL_OFFLINE ?? "1";
process.env.AUTH_MODE = process.env.AUTH_MODE ?? "dev";

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const ids = args.filter((a) => !a.startsWith("--"));
  const { runAll, modelReady, NEEDS_MODEL_NOTE } = await import("./harness");
  const results = await runAll(ids);
  const counts = { pass: 0, fail: 0, skip: 0 };
  for (const r of results) counts[r.status]++;
  if (json) {
    console.log(JSON.stringify({ model: modelReady(), counts, results }, null, 2));
  } else {
    const width = Math.max(...results.map((r) => r.id.length), 4);
    console.log(`\nLeClaude legal evals — model provider ${modelReady() ? "configured" : "not configured (" + NEEDS_MODEL_NOTE + ")"}\n`);
    console.log(`${"case".padEnd(width)}  ${"status".padEnd(6)}  checks  skipped  ms`);
    for (const r of results) {
      const ok = r.checks.filter((c) => c.ok).length;
      console.log(`${r.id.padEnd(width)}  ${r.status.toUpperCase().padEnd(6)}  ${String(ok).padStart(2)}/${String(r.checks.length).padEnd(3)}  ${String(r.skippedChecks.length).padStart(7)}  ${r.durationMs}`);
      for (const c of r.checks.filter((x) => !x.ok)) console.log(`    ✗ ${c.name}${c.actual ? ` — ${c.actual}` : ""}`);
      for (const s of r.skippedChecks) console.log(`    – skipped: ${s}`);
    }
    console.log(`\n${counts.pass} passed, ${counts.fail} failed, ${counts.skip} skipped (${results.length} cases)\n`);
  }
  process.exit(counts.fail ? 1 : 0);
}

main().catch((e) => {
  console.error("eval runner crashed:", e);
  process.exit(1);
});
