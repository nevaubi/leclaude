/**
 * Intelligence layer CLI (no server needed).
 *
 *   npx tsx scripts/intel-run.ts sources                      list sources with health and counts
 *   npx tsx scripts/intel-run.ts run <sourceId|adapterId> [--max N]   run one source now (inline)
 *   npx tsx scripts/intel-run.ts backfill <dir> [<dir>...] [--matter <id>]   index local folders (ad-hoc local-corpus run)
 *   npx tsx scripts/intel-run.ts tick [--limit N] [--seconds S]  run due jobs (what the background loop / cron does)
 *   npx tsx scripts/intel-run.ts sweep                        run the steward sweep
 *   npx tsx scripts/intel-run.ts jobs [--status failed,escalated]  list recent jobs
 *   npx tsx scripts/intel-run.ts health                       print health, config and provider status
 *
 * Uses LECLAUDE_DATA_DIR like the app. Never starts the background loop.
 */
process.env.LECLAUDE_BACKGROUND = "off";

// `server-only` is provided by Next at build time and is not an installed package; map it to the test shim under tsx.
import Module from "node:module";
import path from "node:path";
const SERVER_ONLY_SHIM = path.join(__dirname, "..", "tests", "server-only-shim.ts");
const cjs = Module as unknown as { _resolveFilename: (request: string, ...rest: unknown[]) => string };
const originalResolve = cjs._resolveFilename;
cjs._resolveFilename = function (request: string, ...rest: unknown[]) {
  return request === "server-only" ? SERVER_ONLY_SHIM : originalResolve.call(this, request, ...rest);
};

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function positional(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) { if (args[i].startsWith("--")) { i++; continue; } out.push(args[i]); }
  return out;
}

async function main() {
  const [cmd = "help", ...rest] = process.argv.slice(2);
  const args = positional(rest);
  const { db } = await import("../src/lib/db");
  db();
  const { ensureIntelSeeded } = await import("../src/modules/intel/seed");
  ensureIntelSeeded();
  const store = await import("../src/modules/intel/store");
  const jobs = await import("../src/modules/intel/jobs");

  switch (cmd) {
    case "sources": {
      const { listSources, sourceSummary } = await import("../src/modules/intel/service");
      for (const s of listSources().map(sourceSummary)) {
        console.log(`${s.enabled ? "on " : "off"}  ${s.id.padEnd(28)} ${s.adapter.padEnd(24)} ${String(s.documents).padStart(5)} docs  ${s.health.ok ? "ok" : "ERR"}  next ${s.nextRunAt ?? "-"}  ${s.name}${s.health.lastError ? `\n      last error: ${s.health.lastError}` : ""}`);
      }
      return;
    }
    case "run": {
      const target = args[0];
      if (!target) throw new Error("usage: run <sourceId|adapterId>");
      const source = store.intelSources().get(target) ?? store.intelSources().findOne((s) => s.adapter === target);
      if (!source) throw new Error(`No source with id or adapter "${target}"`);
      const max = flag(rest, "max");
      console.log(`Running ${source.name} (${source.adapter})…`);
      const job = await jobs.runSourceNow(source.id, { wait: true, force: true, maxDocs: max ? Number(max) : undefined });
      console.log(`${job.status}: ${JSON.stringify(job.result ?? job.error, null, 1)}`);
      for (const l of job.log.slice(-15)) console.log(`  ${l.at} ${l.level.padEnd(5)} ${l.msg}`);
      return;
    }
    case "backfill": {
      if (!args.length) throw new Error("usage: backfill <dir> [<dir>...] [--matter <id>]");
      const { runSource } = await import("../src/modules/intel/run");
      const matter = flag(rest, "matter");
      const source = store.intelSources().findOne((s) => s.adapter === "local-corpus");
      if (!source) throw new Error("local-corpus source missing (run the seed)");
      const adhoc = { ...source, config: { ...source.config, dirs: args, maxFiles: 5000 }, scope: matter ? { matterIds: [matter] } : source.scope };
      console.log(`Indexing ${args.join(", ")}…`);
      const result = await runSource(adhoc, { log: (l) => { if (l.level !== "debug") console.log(`  ${l.level.padEnd(5)} ${l.msg}`); } });
      console.log(JSON.stringify({ added: result.added, updated: result.updated, skipped: result.skipped, errors: result.errors.length, chunks: result.chunks, durationMs: result.durationMs }, null, 1));
      return;
    }
    case "tick": {
      const limit = Number(flag(rest, "limit") ?? 20);
      const seconds = Number(flag(rest, "seconds") ?? 55);
      const r = await jobs.runDue({ limit, deadlineMs: seconds * 1000, housekeeping: true });
      console.log(JSON.stringify(r, null, 1));
      return;
    }
    case "sweep": {
      const { sweep } = await import("../src/modules/intel/steward");
      const r = await sweep({ log: (l) => console.log(`  ${l.level.padEnd(5)} ${l.msg}`) });
      console.log(JSON.stringify(r, null, 1));
      return;
    }
    case "jobs": {
      const status = flag(rest, "status")?.split(",") as NonNullable<Parameters<typeof jobs.listJobs>[0]>["status"];
      for (const j of jobs.listJobs({ status, limit: Number(flag(rest, "limit") ?? 30) }).items) {
        console.log(`${j.status.padEnd(10)} ${j.kind.padEnd(14)} ${j.id}  ${j.sourceId ?? ""}  attempts ${j.attempts}/${j.maxAttempts}  ${j.error ? `${j.error.code}: ${j.error.message.slice(0, 80)}` : ""}${j.fixes.length ? `  fixes: ${j.fixes.map((f) => f.action).join(",")}` : ""}`);
      }
      return;
    }
    case "health": {
      const { intelHealth, intelConfigView } = await import("../src/modules/intel/health");
      console.log(JSON.stringify({ health: intelHealth(), config: { ...intelConfigView(), adapters: undefined, staleAfterDays: undefined } }, null, 1));
      return;
    }
    default:
      console.log("commands: sources | run <sourceId|adapterId> [--max N] | backfill <dir...> [--matter id] | tick [--limit N] [--seconds S] | sweep | jobs [--status s] | health");
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
