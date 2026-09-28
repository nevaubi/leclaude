import { beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.LECLAUDE_DATA_DIR = `${process.env.TMPDIR || "/tmp"}/intel-vitest-coverage-${process.pid}`;
  process.env.LECLAUDE_BACKGROUND = "off";
  process.env.WORKFLOW_SCHEDULER_DISABLED = "1";
  process.env.INTEL_OFFLINE = "1";
  process.env.OPENAI_API_KEY = "";
  process.env.TAVILY_API_KEY = "";
  process.env.FIRECRAWL_API_KEY = "";
  process.env.CRON_SECRET = "";
});

import { NextRequest } from "next/server";
import { db, resetSqlite } from "@/lib/db";
import { MATTERS } from "@/lib/seed/ids";
import { intelAnalysisBootstrap } from "@/modules/intel/analysis/bootstrap";
import { configuredSearches, matterCoverage, sourceNeedsKey, sourceState } from "@/modules/intel/analysis/matter-coverage";
import { claimJob, completeJob, enqueueJob, failJob } from "@/modules/intel/jobs";
import { SEED_SOURCE_IDS } from "@/modules/intel/seed";
import { intelSources, upsertDocument } from "@/modules/intel/store";
import type { IntelSource } from "@/modules/intel/types";
import { changeIsEffective, fmtElapsed, hasActiveJobs, headlineJob, planItems } from "@/modules/intel/components/coverage-models";
import type { MatterIntelPlan } from "@/modules/intel/autoconfig-types";
import * as coverageRoute from "@/app/api/intel/coverage/route";

const NO_KEYS = { tavilyKey: undefined, firecrawlKey: undefined };

beforeAll(() => { resetSqlite(); db(); intelAnalysisBootstrap(); });

describe("coverage view models", () => {
  it("polls only while jobs are queued or running and headlines the running job", () => {
    expect(hasActiveJobs([{ status: "succeeded" }, { status: "failed" }])).toBe(false);
    expect(hasActiveJobs([{ status: "queued" }])).toBe(true);
    const jobs = [
      { id: "f", status: "failed" as const, updatedAt: "2026-01-03" },
      { id: "q", status: "queued" as const, updatedAt: "2026-01-04" },
      { id: "r", status: "running" as const, updatedAt: "2026-01-01" },
    ];
    expect(headlineJob(jobs)?.id).toBe("r");
    expect(headlineJob(jobs.filter((j) => j.id !== "r"))?.id).toBe("q");
    expect(headlineJob([jobs[0]])?.id).toBe("f");
    expect(headlineJob([])).toBeUndefined();
  });

  it("formats elapsed times", () => {
    expect(fmtElapsed(12_400)).toBe("12s");
    expect(fmtElapsed(245_000)).toBe("4m 05s");
    expect(fmtElapsed(4_320_000)).toBe("1h 12m");
    expect(fmtElapsed(Number.NaN)).toBe("—");
  });

  it("keeps record facts and suggested wording apart in plan rows", () => {
    const plan: MatterIntelPlan = {
      matterId: "m1", matterName: "M", method: "model",
      caseLaw: [{ text: '"failure to warn"', origin: "model" }], courts: ["dsc"], dockets: ["2:18-mn-02873"], mdls: ["2873"], judges: ["Richard M. Gergel"],
      regulatory: [{ text: "PFAS drinking water", origin: "rule" }], statutes: [], products: [], news: [{ text: "AFFF litigation", origin: "matter_record" }],
      cfrSections: [{ title: 21, section: "314.70" }],
    };
    const items = planItems(plan);
    expect(items.find((i) => i.text === "2:18-mn-02873")).toMatchObject({ category: "Docket", origin: "record" });
    expect(items.find((i) => i.text === "Richard M. Gergel")).toMatchObject({ category: "Judge", origin: "record" });
    expect(items.find((i) => i.text === '"failure to warn"')).toMatchObject({ category: "Case law", origin: "suggested" });
    // Rule-generated wording is still a suggestion; only values copied from the record are "record".
    expect(items.find((i) => i.text === "PFAS drinking water")?.origin).toBe("suggested");
    expect(items.find((i) => i.text === "AFFF litigation")?.origin).toBe("record");
    expect(items.find((i) => i.category === "CFR")).toMatchObject({ text: "21 CFR 314.70", origin: "unspecified" });
    expect(changeIsEffective({ added: [], enabledBefore: true, enabledAfter: true })).toBe(false);
    expect(changeIsEffective({ added: ["+1 docket"], enabledBefore: true, enabledAfter: true })).toBe(true);
    expect(changeIsEffective({ added: [], enabledBefore: false, enabledAfter: true })).toBe(true);
  });
});

describe("source helpers", () => {
  const base = { id: "s1", adapter: "news", enabled: true, status: "idle", health: { ok: true, consecutiveFailures: 0 }, config: {}, scope: {} } as unknown as IntelSource;

  it("reports a missing news key honestly and reads other key gaps from the last error", () => {
    expect(sourceNeedsKey(base, NO_KEYS)).toBe("TAVILY_API_KEY or FIRECRAWL_API_KEY");
    expect(sourceNeedsKey(base, { tavilyKey: "x", firecrawlKey: undefined })).toBeUndefined();
    const other = { ...base, adapter: "govinfo", health: { ok: true, consecutiveFailures: 0, lastError: "Not configured: add GOVINFO_API_KEY" } } as IntelSource;
    expect(sourceNeedsKey(other, NO_KEYS)).toBe("GOVINFO_API_KEY");
    expect(sourceNeedsKey({ ...other, health: { ok: false, consecutiveFailures: 1, lastError: "HTTP 500 from provider" } }, NO_KEYS)).toBeUndefined();
  });

  it("derives the source state with running and queued ahead of configuration gaps", () => {
    const s = { ...base, adapter: "govinfo" } as IntelSource;
    expect(sourceState(s, [], undefined)).toBe("idle");
    expect(sourceState({ ...s, enabled: false }, [], undefined)).toBe("disabled");
    expect(sourceState({ ...s, status: "error", health: { ok: false, consecutiveFailures: 2 } }, [], undefined)).toBe("failed");
    expect(sourceState(s, [], "X_API_KEY")).toBe("needs_key");
    expect(sourceState(s, [{ status: "queued", sourceId: "s1" }], "X_API_KEY")).toBe("queued");
    expect(sourceState({ ...s, status: "running" }, [], undefined)).toBe("running");
  });

  it("lists configured searches from config and scope without duplicates", () => {
    const s = { ...base, config: { queries: ["a", "a", "b"], docketNumbers: ["1:23-cv-1"], names: ["Judge J"], courts: "ca4 dsc", sections: [{ title: 21, section: "314.70" }, { title: 40, part: "141" }] }, scope: { targets: ["1:23-cv-1", "https://x.test"] } } as unknown as IntelSource;
    const out = configuredSearches(s);
    expect(out.filter((x) => x.kind === "query").map((x) => x.text)).toEqual(["a", "b"]);
    expect(out.filter((x) => x.kind === "court").map((x) => x.text)).toEqual(["ca4", "dsc"]);
    expect(out.filter((x) => x.kind === "cfr").map((x) => x.text)).toEqual(["21 CFR 314.70", "40 CFR Part 141"]);
    expect(out.filter((x) => x.kind === "target").map((x) => x.text)).toEqual(["https://x.test"]);
    expect(out.find((x) => x.kind === "judge")?.text).toBe("Judge J");
  });
});

describe("matterCoverage", () => {
  it("describes only the allowed matters, counted from stored records", () => {
    const v = matterCoverage([MATTERS.afff], { config: { ...NO_KEYS } as never });
    expect(v.matters.map((m) => m.matterId)).toEqual([MATTERS.afff]);
    const afff = v.matters[0];
    expect(afff.records).toBeGreaterThan(0);
    expect(afff.entities).toBeGreaterThan(0);
    const dockets = afff.sources.find((s) => s.id === SEED_SOURCE_IDS.clDockets);
    expect(dockets).toMatchObject({ linked: "matter" });
    expect(dockets!.searches.some((q) => q.kind === "docket" && q.text === "2:18-mn-02873")).toBe(true);
    const news = afff.sources.find((s) => s.id === SEED_SOURCE_IDS.news);
    expect(news?.state).toBe("needs_key");
    expect(v.totals.needsKey).toBeGreaterThanOrEqual(1);
    // The FDA source serves only Depo-Provera: it is not a source for AFFF.
    expect(afff.sources.some((s) => s.id === SEED_SOURCE_IDS.openfda && s.linked !== "records")).toBe(false);
  });

  it("never widens an empty scope", () => {
    const v = matterCoverage([]);
    expect(v.matters).toEqual([]);
    expect(v.totals.matters).toBe(0);
  });

  it("shows a running job with records so far, hides jobs of sources outside the scope, and clears a failure after a later success", () => {
    const fda = enqueueJob({ kind: "source.run", sourceId: SEED_SOURCE_IDS.openfda });
    const running = enqueueJob({ kind: "source.run", sourceId: SEED_SOURCE_IDS.clDockets });
    claimJob(running.id, "test-worker");
    upsertDocument({ sourceId: SEED_SOURCE_IDS.clDockets, adapter: "courtlistener-dockets", kind: "docket_entry", title: "Coverage test entry", dates: { filed: "2026-09-01" }, externalId: "coverage:test:1", text: "Order on coverage test.", matterIds: [MATTERS.afff] });

    const afffOnly = matterCoverage([MATTERS.afff]);
    expect(afffOnly.jobs.some((j) => j.id === fda.id)).toBe(false);
    const r = afffOnly.jobs.find((j) => j.id === running.id)!;
    expect(r).toMatchObject({ status: "running", sourceName: expect.any(String), matterIds: [MATTERS.afff] });
    expect(r.recordsSoFar).toBeGreaterThanOrEqual(1);
    expect(afffOnly.matters[0].activeJobs).toBeGreaterThanOrEqual(1);
    expect(afffOnly.totals.running).toBeGreaterThanOrEqual(1);
    expect(matterCoverage([MATTERS.depo]).jobs.some((j) => j.id === fda.id)).toBe(true);

    failJob(running.id, { code: "network", message: "connect ECONNREFUSED" }, { retryable: false });
    const failed = matterCoverage([MATTERS.afff]).jobs.find((j) => j.id === running.id);
    expect(failed).toMatchObject({ status: "failed", error: expect.stringContaining("ECONNREFUSED") });

    const again = enqueueJob({ kind: "source.run", sourceId: SEED_SOURCE_IDS.clDockets }, new Date(Date.now() + 1000));
    claimJob(again.id, "test-worker");
    completeJob(again.id, { added: 0 }, new Date(Date.now() + 2000));
    expect(matterCoverage([MATTERS.afff]).jobs.some((j) => j.id === running.id)).toBe(false);
    intelSources().update(SEED_SOURCE_IDS.clDockets, (s) => ({ ...s, status: "idle" }));
  });
});

describe("GET /api/intel/coverage", () => {
  const url = "http://localhost/api/intel/coverage";

  it("returns the caller's coverage", async () => {
    const res = await coverageRoute.GET(new NextRequest(url));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.matters.length).toBeGreaterThan(0);
    expect(body).toMatchObject({ totals: expect.any(Object), keys: { news: false }, restricted: false });
  });

  it("narrows to the principal's matters and refuses a matter outside them", async () => {
    const prev = { mode: process.env.AUTH_MODE, trust: process.env.AUTH_TRUST_HEADER };
    process.env.AUTH_MODE = "header";
    process.env.AUTH_TRUST_HEADER = "true";
    try {
      const headers = { "x-leclaude-user": JSON.stringify({ id: "u_scoped", name: "Scoped", roles: ["associate"], matterIds: [MATTERS.afff] }) };
      const ok = await coverageRoute.GET(new NextRequest(url, { headers }));
      expect(ok.status).toBe(200);
      const body = await ok.json();
      expect(body.matters.map((m: { matterId: string }) => m.matterId)).toEqual([MATTERS.afff]);
      expect(body.restricted).toBe(true);
      const denied = await coverageRoute.GET(new NextRequest(`${url}?matterId=${MATTERS.depo}`, { headers }));
      expect(denied.status).toBe(403);
    } finally {
      if (prev.mode === undefined) delete process.env.AUTH_MODE; else process.env.AUTH_MODE = prev.mode;
      if (prev.trust === undefined) delete process.env.AUTH_TRUST_HEADER; else process.env.AUTH_TRUST_HEADER = prev.trust;
    }
  });
});
