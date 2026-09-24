import { beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.LECLAUDE_DATA_DIR = `${process.env.TMPDIR || "/tmp"}/intel-vitest-jobs-${process.pid}`;
  process.env.LECLAUDE_BACKGROUND = "off";
  process.env.WORKFLOW_SCHEDULER_DISABLED = "1";
  process.env.INTEL_OFFLINE = "1";
  process.env.OPENAI_API_KEY = "";
});

import { z } from "zod";
import { memoryHttpCache } from "@/lib/ai/toolkit/http";
import { db, resetSqlite } from "@/lib/db";
import { defineAdapter, registerAdapter } from "@/modules/intel/adapters";
import { cancelJob, claimJob, claimNext, completeJob, dueHousekeeping, enqueueJob, executeJob, failJob, getJob, heartbeat, jobCounts, listJobs, reapOrphans, registerJobHandler, retryJob, runDue, runSourceNow, scheduleDueSources } from "@/modules/intel/jobs";
import { createProviders } from "@/modules/intel/providers";
import { createSource, updateSource } from "@/modules/intel/service";
import { intelDocuments, intelJobs, intelSources } from "@/modules/intel/store";

beforeAll(() => {
  resetSqlite(); db();
  // Never touch the network from the seeded system sources in tests.
  for (const s of intelSources().all()) updateSource(s.id, { enabled: false });
});

const providers = () => createProviders({ cache: memoryHttpCache(), offline: true, sleep: async () => {} });

/** Fake adapters registered under built-in ids (the registry is per test process). */
let webListRuns = 0;
registerAdapter(defineAdapter({
  id: "web-list", name: "fake web-list", description: "test", kinds: ["web_page"], family: "web", requires: [],
  configSchema: z.object({ pages: z.number().int().default(2), delayMs: z.number().int().default(0), fail: z.string().optional() }),
  defaults: { pages: 2, delayMs: 0 },
  async run(ctx) {
    webListRuns++;
    if (ctx.config.delayMs) await new Promise((r) => setTimeout(r, ctx.config.delayMs));
    if (ctx.config.fail === "network") throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
    if (ctx.config.fail === "parse") throw new Error("Unexpected token < in JSON");
    for (let i = 0; i < ctx.config.pages; i++) await ctx.ingest({ kind: "web_page", title: `Fake page ${i}`, dates: {}, externalId: `fake:${ctx.source.id}:${i}`, text: `Fake page ${i} text. ` + "Lorem-free content about court rules. ".repeat(20) });
  },
}));
registerAdapter(defineAdapter({
  id: "court-rules", name: "fake court-rules", description: "test", kinds: ["court_rule"], family: "web", requires: [],
  configSchema: z.object({ delayMs: z.number().int().default(0) }), defaults: { delayMs: 0 },
  async run(ctx) { await new Promise((r) => setTimeout(r, ctx.config.delayMs)); await ctx.ingest({ kind: "court_rule", title: "Rule", dates: {}, externalId: `rule:${ctx.source.id}`, text: "Rule text. ".repeat(50) }); },
}));
registerAdapter(defineAdapter({
  id: "ecfr", name: "fake ecfr", description: "test", kinds: ["regulation"], family: "ecfr", requires: [],
  configSchema: z.object({ delayMs: z.number().int().default(0) }), defaults: { delayMs: 0 },
  async run(ctx) { await new Promise((r) => setTimeout(r, ctx.config.delayMs)); await ctx.ingest({ kind: "regulation", title: "Reg", dates: {}, externalId: `reg:${ctx.source.id}`, text: "Regulation text. ".repeat(50) }); },
}));

describe("queue primitives", () => {
  it("enqueues with dedupe, claims, heartbeats, completes and lists", () => {
    const a = enqueueJob({ kind: "sweep", dedupeKey: "sweep" });
    const b = enqueueJob({ kind: "sweep", dedupeKey: "sweep" });
    expect(b.id).toBe(a.id);
    expect(a.status).toBe("queued");
    expect(a.priority).toBe(5);
    const claimed = claimJob(a.id, "w1")!;
    expect(claimed.status).toBe("running");
    expect(claimed.attempts).toBe(1);
    expect(claimJob(a.id, "w2")).toBeNull();
    const c = enqueueJob({ kind: "sweep", dedupeKey: "sweep" });
    expect(c.id).toBe(a.id); // still active
    heartbeat(a.id);
    expect(getJob(a.id)!.heartbeatAt).toBeTruthy();
    const done = completeJob(a.id, { ok: 1 })!;
    expect(done.status).toBe("succeeded");
    expect(done.result).toEqual({ ok: 1 });
    const d = enqueueJob({ kind: "sweep", dedupeKey: "sweep" });
    expect(d.id).not.toBe(a.id);
    expect(listJobs({ kind: "sweep" }).total).toBe(2);
    expect(listJobs({ status: ["succeeded"] }).items.map((j) => j.id)).toContain(a.id);
    cancelJob(d.id);
    expect(getJob(d.id)!.status).toBe("cancelled");
  });
  it("re-queues retryable failures with backoff until attempts run out, then fails for good; retryJob resets", () => {
    const j = enqueueJob({ kind: "scan.run", maxAttempts: 2, priority: 1 });
    claimJob(j.id, "w");
    const now = new Date("2026-09-24T10:00:00Z");
    const first = failJob(j.id, { code: "network", message: "boom" }, { retryable: true, now, backoffMs: 60_000 })!;
    expect(first.status).toBe("queued");
    expect(first.runAfter).toBe("2026-09-24T10:01:00.000Z");
    expect(claimJob(j.id, "w", now)).toBeNull(); // not before runAfter
    expect(claimJob(j.id, "w", new Date("2026-09-24T10:02:00Z"))!.attempts).toBe(2);
    const second = failJob(j.id, { code: "network", message: "boom again" }, { retryable: true, now })!;
    expect(second.status).toBe("failed");
    expect(second.error).toEqual({ code: "network", message: "boom again" });
    expect(second.finishedAt).toBeTruthy();
    const nonRetry = enqueueJob({ kind: "scan.run", maxAttempts: 3 });
    claimJob(nonRetry.id, "w");
    expect(failJob(nonRetry.id, { code: "parse", message: "bad" }, { retryable: false })!.status).toBe("failed");
    const back = retryJob(second.id, { by: "human", note: "try once more" })!;
    expect(back.status).toBe("queued");
    expect(back.fixes.at(-1)).toMatchObject({ action: "retry", by: "human" });
    expect(back.maxAttempts).toBeGreaterThan(second.attempts);
  });
  it("claims by priority then age and skips busy provider families", () => {
    for (const j of intelJobs().find((j) => j.status === "queued")) cancelJob(j.id);
    const low = enqueueJob({ kind: "sweep", priority: 8, dedupeKey: "p8" });
    const high = enqueueJob({ kind: "insight.verify", priority: 2, dedupeKey: "p2" });
    const first = claimNext({ workerId: "w", busyFamilies: new Set(["insight.verify"]) });
    expect(first?.id).toBe(low.id);
    const second = claimNext({ workerId: "w" });
    expect(second?.id).toBe(high.id);
    expect(claimNext({ workerId: "w" })).toBeNull();
    completeJob(low.id, undefined); completeJob(high.id, undefined);
  });
  it("reaps orphaned running jobs and resets their source status", () => {
    const src = createSource({ adapter: "web-list", name: "orphan src", config: { pages: 1 }, schedule: { every: "manual" } });
    const j = enqueueJob({ kind: "source.run", sourceId: src.id });
    claimJob(j.id, "dead-worker", new Date(Date.now() - 20 * 60_000));
    intelSources().update(src.id, (s) => ({ ...s, status: "running" }));
    intelJobs().update(j.id, (x) => ({ ...x, heartbeatAt: new Date(Date.now() - 20 * 60_000).toISOString() }));
    const reaped = reapOrphans(new Date(), 5 * 60_000);
    expect(reaped.map((r) => r.id)).toContain(j.id);
    expect(getJob(j.id)!.status).toBe("queued");
    expect(getJob(j.id)!.error?.code).toBe("timeout");
    expect(intelSources().get(src.id)!.status).toBe("idle");
    cancelJob(j.id);
  });
});

describe("scheduling and execution", () => {
  it("enqueues due sources once and executes a source.run end to end, updating stats, health and nextRunAt", async () => {
    const src = createSource({ adapter: "web-list", name: "scheduled", config: { pages: 3 }, schedule: { every: "1h" } });
    intelSources().update(src.id, (s) => ({ ...s, nextRunAt: new Date(Date.now() - 1000).toISOString() }));
    const due = scheduleDueSources(new Date());
    expect(due.map((j) => j.sourceId)).toEqual([src.id]);
    expect(scheduleDueSources(new Date())).toHaveLength(1); // deduped while queued
    const claimed = claimJob(due[0].id, "w")!;
    const done = await executeJob(claimed, { providers: providers() });
    expect(done.status).toBe("succeeded");
    expect(done.result).toMatchObject({ added: 3, updated: 0, skipped: 0 });
    const after = intelSources().get(src.id)!;
    expect(after.status).toBe("idle");
    expect(after.health).toMatchObject({ ok: true, consecutiveFailures: 0 });
    expect(after.stats).toMatchObject({ documents: 3, lastAdded: 3 });
    expect(after.stats.chunks).toBeGreaterThan(0);
    expect(new Date(after.nextRunAt!).getTime()).toBeGreaterThan(Date.now() + 50 * 60_000);
    expect(intelDocuments().count((d) => d.sourceId === src.id)).toBe(3);
    // A second run with unchanged pages counts them as skipped.
    const j2 = await runSourceNow(src.id, { wait: true, providers: providers() });
    expect(j2.status).toBe("succeeded");
    expect(j2.result).toMatchObject({ added: 0, skipped: 3 });
    expect(j2.priority).toBe(1);
  });
  it("marks the source erroring on a failed run and skips disabled sources", async () => {
    const src = createSource({ adapter: "web-list", name: "failing", config: { fail: "network" }, schedule: { every: "manual" } });
    const job = enqueueJob({ kind: "source.run", sourceId: src.id, maxAttempts: 1 });
    const done = await executeJob(claimJob(job.id, "w")!, { providers: providers(), review: false });
    expect(done.status).toBe("failed");
    expect(done.error?.code).toBe("network");
    const s = intelSources().get(src.id)!;
    expect(s.status).toBe("error");
    expect(s.health).toMatchObject({ ok: false, consecutiveFailures: 1 });
    expect(s.health.lastError).toMatch(/fetch failed/);
    updateSource(src.id, { enabled: false });
    const skip = enqueueJob({ kind: "source.run", sourceId: src.id });
    const skipped = await executeJob(claimJob(skip.id, "w")!, { providers: providers() });
    expect(skipped.status).toBe("succeeded");
    expect(skipped.result).toMatchObject({ skipped: true, reason: "disabled" });
  });
  it("runs due jobs with concurrency 2, never two jobs of the same provider family at once, and respects the limit", async () => {
    for (const j of intelJobs().find((j) => j.status === "queued")) cancelJob(j.id);
    const a = createSource({ adapter: "web-list", name: "fam web a", config: { pages: 1, delayMs: 150 }, schedule: { every: "manual" } });
    const b = createSource({ adapter: "court-rules", name: "fam web b", config: { delayMs: 150 }, schedule: { every: "manual" } });
    const c = createSource({ adapter: "ecfr", name: "fam ecfr", config: { delayMs: 150 }, schedule: { every: "manual" } });
    for (const s of [a, b, c]) enqueueJob({ kind: "source.run", sourceId: s.id, payload: { force: true } });
    const r = await runDue({ limit: 10, deadlineMs: 10_000, providers: providers(), concurrency: 2 });
    expect(r.ran).toBe(3);
    expect(r.succeeded).toBe(3);
    const jobs = r.jobIds.map((id) => getJob(id)!);
    const t = (s?: string) => new Date(s!).getTime();
    // web-family jobs (a, b) never overlap; the ecfr job overlaps with the first web job (concurrency 2).
    const web = jobs.filter((j) => [a.id, b.id].includes(j.sourceId!)).sort((x, y) => x.startedAt!.localeCompare(y.startedAt!));
    const ecfr = jobs.find((j) => j.sourceId === c.id)!;
    expect(t(web[1].startedAt)).toBeGreaterThanOrEqual(t(web[0].finishedAt) - 5);
    expect(t(ecfr.startedAt)).toBeLessThan(t(web[0].finishedAt));
    expect(t(web[0].finishedAt) - t(web[0].startedAt)).toBeGreaterThanOrEqual(140);
    for (const s of [a, b]) enqueueJob({ kind: "source.run", sourceId: s.id, payload: { force: true } });
    const limited = await runDue({ limit: 1, deadlineMs: 5_000, providers: providers() });
    expect(limited.ran).toBe(1);
    expect(listJobs({ status: ["queued"] }).total).toBe(1);
    await runDue({ limit: 5, deadlineMs: 5_000, providers: providers() });
  });
  it("enqueues housekeeping jobs by cadence, once, and only the requested kinds", () => {
    for (const j of intelJobs().find((j) => j.status === "queued")) cancelJob(j.id);
    const now = new Date();
    const inline = dueHousekeeping(now, { sweep: true, reembed: true });
    expect(inline.map((j) => j.kind)).toEqual(["sweep"]); // reembed needs an OpenAI key
    expect(dueHousekeeping(now, { sweep: true, reembed: true })).toHaveLength(0); // cadence recorded
    const cron = dueHousekeeping(now, { sweep: true, reembed: true, workflow: true, scans: true });
    expect(cron.map((j) => j.kind).sort()).toEqual(["scan.run", "workflow.tick"]);
    const queuedBefore = listJobs({ status: ["queued"] }).total;
    const again = dueHousekeeping(new Date(now.getTime() + 61_000), { workflow: true });
    expect(again.map((j) => j.id)).toEqual([cron.find((j) => j.kind === "workflow.tick")!.id]); // still queued → deduped onto the same job
    expect(listJobs({ status: ["queued"] }).total).toBe(queuedBefore);
    for (const j of [...inline, ...cron]) cancelJob(j.id);
    expect(dueHousekeeping(new Date(now.getTime() + 61_000), { workflow: true }).map((j) => j.kind)).toEqual(["workflow.tick"]);
    for (const j of intelJobs().find((j) => j.status === "queued")) cancelJob(j.id);
  });
  it("dispatches registered handlers and fails unknown kinds without retry", async () => {
    registerJobHandler("entities.resolve", async (job) => ({ resolved: job.payload.n }));
    const j = enqueueJob({ kind: "entities.resolve", payload: { n: 7 } });
    const done = await executeJob(claimJob(j.id, "w")!);
    expect(done.status).toBe("succeeded");
    expect(done.result).toEqual({ resolved: 7 });
    const u = enqueueJob({ kind: "analysis.run", maxAttempts: 3 });
    const failed = await executeJob(claimJob(u.id, "w")!, { review: false });
    expect(failed.status).toBe("failed");
    expect(failed.error?.message).toMatch(/No handler/);
    const counts = jobCounts();
    expect(counts.failed24h).toBeGreaterThanOrEqual(1);
    expect(counts.running).toBe(0);
  });
  it("runs housekeeping kinds through the runner (sweep, scan.run, workflow.tick)", async () => {
    const sweep = enqueueJob({ kind: "sweep", maxAttempts: 1 });
    const s = await executeJob(claimJob(sweep.id, "w")!, { providers: providers() });
    expect(s.status).toBe("succeeded");
    expect(s.result).toMatchObject({ contradictions: expect.any(Number), staleFlagged: expect.any(Number) });
    const scan = enqueueJob({ kind: "scan.run", payload: { only: ["intel-sources"] }, maxAttempts: 1 });
    const sc = await executeJob(claimJob(scan.id, "w")!);
    expect(sc.status).toBe("succeeded");
    expect(sc.result).toMatchObject({ reportId: expect.stringMatching(/^scan_/) });
    const wf = enqueueJob({ kind: "workflow.tick", maxAttempts: 1 });
    const w = await executeJob(claimJob(wf.id, "w")!);
    expect(w.status).toBe("succeeded");
    expect(w.result).toMatchObject({ fired: expect.any(Array) });
    expect(webListRuns).toBeGreaterThan(0);
  });
});
