import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// A production (reference) workspace on a private database: neutral source catalog, no network, no background work.
vi.hoisted(() => {
  process.env.LECLAUDE_DATA_DIR = `${process.env.VITEST_DATA_DIR || process.env.TMPDIR || "/tmp"}/intel-autoconfig-vitest-${process.pid}`;
  process.env.LECLAUDE_SEED = "reference";
  process.env.LECLAUDE_BACKGROUND = "off";
  process.env.WORKFLOW_SCHEDULER_DISABLED = "1";
  process.env.INTEL_OFFLINE = "1";
  process.env.LECLAUDE_CORPUS_DIRS = "";
  process.env.TAVILY_API_KEY = "";
  process.env.FIRECRAWL_API_KEY = "";
  delete process.env.AUTH_MODE;
});

const gen = vi.hoisted(() => ({ impl: null as null | ((opts: Record<string, unknown>) => Promise<unknown>), calls: [] as Record<string, unknown>[] }));

vi.mock("@/lib/ai/agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/agent")>();
  const { AIConfigError } = await import("@/lib/ai/config");
  return {
    ...actual,
    generateJSON: vi.fn(async (opts: Record<string, unknown>) => {
      gen.calls.push(opts);
      if (!gen.impl) throw new AIConfigError();
      return gen.impl(opts);
    }),
  };
});

import { db, resetSqlite } from "@/lib/db";
import { setWorkspaceUser } from "@/lib/current-user";
import type { Matter } from "@/lib/types/domain";
import { setupWorkspace } from "@/modules/workspace/service";
import { buildDemoMatters } from "@/modules/demo/workspace/matters";
import { DEMO_MATTERS } from "@/modules/demo/ids";
import { AUTO_FLAG_KEY, AUTOCONFIG_KEY, applyPlans, courtIdsFor, factsForMatter, maybeAutoConfigure, planForMatter, planForMatters, validateWording } from "@/modules/intel/autoconfig";
import { listJobs } from "@/modules/intel/jobs";
import { SEED_SOURCE_IDS, ensureIntelSeeded } from "@/modules/intel/seed";
import { intelSources } from "@/modules/intel/store";
import type { AutoconfigState } from "@/modules/intel/autoconfig-types";

let consumer: Matter;
let doj: Matter;

const mdlMatter: Matter = {
  id: "m_test_mdl",
  slug: "test-mdl",
  name: "In re: Hair Relaxer Marketing, Sales Practices and Products Liability Litigation",
  shortName: "Hair Relaxer MDL",
  caption: "MDL No. 3060, No. 1:23-cv-00818 (N.D. Ill.)",
  client: "Plaintiffs' steering committee",
  clientSide: "plaintiff",
  practiceArea: "Products Liability",
  court: "U.S. District Court for the Northern District of Illinois",
  jurisdiction: "Federal · 7th Cir.",
  judge: "Hon. Mary M. Rowland",
  status: "active",
  openedAt: "2023-02-01",
  teamIds: [],
  description: "Product liability claims that chemical hair straighteners caused uterine cancer; failure to warn under state law. Labeling at 21 C.F.R. 701.3.",
  tags: ["mass tort", "product liability"],
};

function resetIntel() {
  const col = intelSources();
  for (const s of col.all()) col.delete(s.id);
  db().kv.delete("intel:reference:version");
  db().kv.delete(AUTOCONFIG_KEY);
  db().kv.delete(AUTO_FLAG_KEY);
  for (const j of listJobs({ limit: 1000 }).items) db().collection("intel_jobs").delete(j.id);
  ensureIntelSeeded();
}

beforeAll(() => {
  resetSqlite();
  setWorkspaceUser(null);
  db();
  const ms = buildDemoMatters({ now: new Date("2026-09-01T00:00:00Z"), ownerId: "u_owner_test", ownerName: "Owner", firmName: "Test LLP", emailDomain: "test.example" });
  consumer = ms.find((m) => m.id === DEMO_MATTERS.consumer)!;
  doj = ms.find((m) => m.id === DEMO_MATTERS.doj)!;
});
afterAll(() => { resetSqlite(); });
beforeEach(() => { gen.impl = null; gen.calls = []; delete process.env.TAVILY_API_KEY; });

describe("facts from the matter record", () => {
  it("maps courts through the deterministic table and never guesses", () => {
    expect(courtIdsFor("U.S. District Court for the Northern District of California", "Federal · 9th Cir.")).toEqual(["cand", "ca9"]);
    expect(courtIdsFor("D.S.C.")).toEqual(["dsc"]);
    expect(courtIdsFor("Supreme Court")).toEqual(["scotus"]);
    expect(courtIdsFor("D.D.C.")).toEqual(["dcd"]);
    expect(courtIdsFor("S.D.N.Y.")).toEqual(["nysd"]);
    expect(courtIdsFor("Superior Court of Maricopa County")).toEqual([]);
    expect(courtIdsFor("New York Supreme Court")).toEqual([]);
  });

  it("reads dockets, MDLs, judges and citations from the record only", () => {
    const f = factsForMatter(mdlMatter);
    expect(f.dockets).toEqual(["1:23-cv-00818"]);
    expect(f.mdls).toEqual(["3060"]);
    expect(f.judges).toEqual(["Mary M. Rowland"]);
    expect(f.courts).toEqual(["ilnd", "ca7"]);
    expect(f.cfr).toEqual([{ title: 21, section: "701.3" }]);
    // The demo consumer matter: fictional docket ("5:24-cv-0DEMO") and a judge marked fictional are not watched.
    const c = factsForMatter(consumer);
    expect(c.dockets).toEqual([]);
    expect(c.judges).toEqual([]);
    expect(c.courts).toEqual(["cand", "ca9"]);
    expect(factsForMatter(doj).dockets).toEqual(["2:24-cv-04055"]);
  });
});

describe("wording validation", () => {
  it("drops wildcard case-law searches (slow on CourtListener) and keeps the rest", () => {
    const facts = factsForMatter(doj);
    const { wording, dropped } = validateWording({ caseLaw: ['"App Store" monopol* AND antitrust', '"refusal to deal" AND smartphone'], regulatory: ["app store competition"], statutes: [], news: [], products: [], cfrSections: [] }, facts);
    expect(wording.caseLaw.map((q) => q.text)).toEqual(['"refusal to deal" AND smartphone']);
    expect(wording.regulatory.map((q) => q.text)).toEqual(["app store competition"]);
    expect(dropped).toBe(1);
  });
});

describe("planning", () => {
  it("falls back to record-derived rules without an AI key", async () => {
    const p = await planForMatter(consumer);
    expect(p.method).toBe("rules");
    expect(p.caseLaw.length).toBeGreaterThan(0);
    expect(p.caseLaw.every((q) => q.origin === "rule")).toBe(true);
    expect(p.caseLaw[0].text).toBe('"Smartphone App Distribution Antitrust"');
    expect(p.courts).toEqual(["cand", "ca9"]);
    expect(p.regulatory).toEqual([]);
    expect(p.caseLaw.map((q) => q.text).join(" ")).not.toMatch(/\bdemo\b/i);
  });

  it("uses model wording (internal privacy) and drops invented facts", async () => {
    gen.impl = async () => ({
      caseLaw: [
        '"app store" AND (monopolization OR "anti-steering")',
        '"Sherman Act" AND smartphone AND "tying"',
        'docketNumber:"5:99-cv-12345" AND apple', // field filter + invented docket → dropped
        '"In re Foo" 3:21-cv-99999', // invented docket → dropped
        'see https://example.com', // URL → dropped
        '"app store" AND (monopolization OR "anti-steering")', // duplicate
      ],
      regulatory: ["app store competition", "MDL No. 9999 notice"],
      statutes: ["15 U.S.C. 2"],
      news: ["Apple App Store antitrust class action"],
      products: [],
      cfrSections: [{ title: 16, section: "not-a-section" }],
      dockets: ["1:23-cv-00001"], // not part of the schema; ignored
      judges: ["Hon. Invented Person"],
    });
    const p = await planForMatter(consumer);
    expect(p.method).toBe("model");
    expect(gen.calls[0].privacy).toBe("internal");
    expect(gen.calls[0].fast).toBe(true);
    expect(p.caseLaw.map((q) => q.text)).toEqual(['"app store" AND (monopolization OR "anti-steering")', '"Sherman Act" AND smartphone AND "tying"']);
    expect(p.caseLaw.every((q) => q.origin === "model")).toBe(true);
    expect(p.regulatory.map((q) => q.text)).toEqual(["app store competition"]);
    expect(p.statutes.map((q) => q.text)).toEqual(["15 U.S.C. 2"]);
    expect(p.dockets).toEqual([]);
    expect(p.judges).toEqual([]);
    expect(p.mdls).toEqual([]);
    expect(p.cfrSections).toBeUndefined();
    expect(JSON.stringify(p)).not.toMatch(/12345|99999|1:23-cv-00001|Invented/);
    expect(p.notes?.some((n) => /dropped by validation/.test(n))).toBe(true);
  });

  it("falls back to rules when the model fails", async () => {
    gen.impl = async () => { throw new Error("provider down"); };
    const p = await planForMatter(consumer);
    expect(p.method).toBe("rules");
    expect(p.notes?.some((n) => /Model unavailable/.test(n))).toBe(true);
  });
});

describe("applying plans", () => {
  beforeEach(() => resetIntel());

  it("configures and enables the sources with modest volumes, idempotently", async () => {
    const plans = await planForMatters([consumer, doj, mdlMatter]);
    const r = applyPlans(plans, { run: true, by: { id: "u_test", name: "Tester" } });
    const op = intelSources().get(SEED_SOURCE_IDS.clOpinions)!;
    expect(op.enabled).toBe(true);
    expect((op.config.queries as string[]).length).toBeGreaterThanOrEqual(3);
    expect(String(op.config.courts).split(" ")).toEqual(expect.arrayContaining(["cand", "ca9", "njd", "ca3", "ilnd", "ca7"]));
    expect(op.config.maxResults).toBeLessThanOrEqual(10);
    expect(op.config.sinceDays).toBeGreaterThanOrEqual(30);
    expect(op.config.sinceDays).toBeLessThanOrEqual(90);
    expect(op.scope?.matterIds).toEqual(expect.arrayContaining([consumer.id, doj.id, mdlMatter.id]));
    const dk = intelSources().get(SEED_SOURCE_IDS.clDockets)!;
    expect(dk.enabled).toBe(true);
    expect(dk.config.docketNumbers).toEqual(["2:24-cv-04055", "1:23-cv-00818"]);
    expect(intelSources().get(SEED_SOURCE_IDS.clJudges)!.config.names).toEqual(["Mary M. Rowland"]);
    expect(intelSources().get(SEED_SOURCE_IDS.jpml)!.config.watch).toEqual(["3060"]);
    expect(intelSources().get(SEED_SOURCE_IDS.ecfr)!.config.sections).toEqual([{ title: 21, section: "701.3" }]);
    // No model products → openFDA untouched; web list / court rules untouched.
    expect(intelSources().get(SEED_SOURCE_IDS.openfda)!.enabled).toBe(false);
    expect(intelSources().get(SEED_SOURCE_IDS.webList)!.enabled).toBe(false);
    expect(intelSources().get(SEED_SOURCE_IDS.courtRules)!.enabled).toBe(false);
    // News gets queries but stays off without a key.
    const news = intelSources().get(SEED_SOURCE_IDS.news)!;
    expect(news.enabled).toBe(false);
    expect((news.config.queries as string[]).length).toBeGreaterThan(0);
    expect(r.changes.find((c) => c.adapter === "news")?.skippedReason).toMatch(/TAVILY_API_KEY/);
    // Runs are enqueued (not executed) for enabled changed sources only.
    expect(r.jobs.length).toBeGreaterThan(0);
    for (const j of r.jobs) {
      const job = listJobs({ sourceId: j.sourceId, limit: 1 }).items[0];
      expect(job.status).toBe("queued");
      expect(intelSources().get(j.sourceId)!.enabled).toBe(true);
    }
    expect(r.jobs.some((j) => j.sourceId === SEED_SOURCE_IDS.news)).toBe(false);
    // New searches run over their full look-back window (not the incremental window since a last success).
    const opJob = listJobs({ sourceId: SEED_SOURCE_IDS.clOpinions, limit: 1 }).items[0];
    expect(opJob.payload.since).toBe(new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10));
    expect(opJob.payload.maxDocs).toBeLessThanOrEqual(50);
    const state = db().kv.get<AutoconfigState>(AUTOCONFIG_KEY)!;
    expect(state.appliedBy).toBe("Tester");
    expect(state.plans.length).toBe(3);

    // Second apply: nothing changes.
    const before = JSON.stringify(intelSources().all());
    const jobsBefore = listJobs({ limit: 1000 }).total;
    const again = applyPlans(plans, { run: true });
    expect(JSON.stringify(intelSources().all())).toBe(before);
    expect(again.jobs).toEqual([]);
    expect(again.changes.every((c) => c.added.length === 0 && c.enabledAfter === c.enabledBefore)).toBe(true);
    expect(listJobs({ limit: 1000 }).total).toBe(jobsBefore);
  });

  it("enables news only when a news key is configured", async () => {
    process.env.TAVILY_API_KEY = "tvly-test";
    const r = applyPlans(await planForMatters([consumer]), { run: false });
    expect(intelSources().get(SEED_SOURCE_IDS.news)!.enabled).toBe(true);
    expect(r.changes.find((c) => c.adapter === "news")?.skippedReason).toBeUndefined();
    expect(r.jobs).toEqual([]);
  });

  it("keeps searches the firm already entered", async () => {
    const op = intelSources().get(SEED_SOURCE_IDS.clOpinions)!;
    intelSources().put({ ...op, config: { ...op.config, queries: ['"my own query"'], maxResults: 20 } });
    applyPlans(await planForMatters([consumer]), { run: false });
    const after = intelSources().get(SEED_SOURCE_IDS.clOpinions)!;
    expect((after.config.queries as string[])[0]).toBe('"my own query"');
    expect(after.config.maxResults).toBe(20);
  });
});

describe("one-time automatic apply", () => {
  beforeAll(() => {
    setupWorkspace({ firmName: "Test LLP", name: "Rebecca Ortiz", email: "rortiz@test.example", role: "Partner" });
  });
  beforeEach(() => resetIntel());

  it("does nothing without active matters, then runs exactly once", async () => {
    for (const m of db().matters.all()) db().matters.delete(m.id);
    expect(await maybeAutoConfigure()).toBeNull();
    expect(db().kv.get(AUTO_FLAG_KEY)).toBeNull();

    db().matters.putMany([consumer, doj]);
    const first = await maybeAutoConfigure();
    expect(first?.status).toBe("applied");
    expect(intelSources().get(SEED_SOURCE_IDS.clOpinions)!.enabled).toBe(true);
    const jobs = listJobs({ limit: 1000 }).total;
    expect(jobs).toBeGreaterThan(0);

    // Flag set: never again, even if sources are reset.
    db().matters.put(mdlMatter);
    expect(await maybeAutoConfigure()).toBeNull();
    expect(listJobs({ limit: 1000 }).total).toBe(jobs);
    expect(intelSources().get(SEED_SOURCE_IDS.jpml)!.enabled).toBe(false);
  });

  it("skips (and sets the flag) when the firm already configured sources", async () => {
    const fr = intelSources().get(SEED_SOURCE_IDS.federalRegister)!;
    intelSources().put({ ...fr, config: { ...fr.config, queries: ["firm query"] } });
    const r = await maybeAutoConfigure();
    expect(r?.status).toBe("skipped");
    expect(intelSources().get(SEED_SOURCE_IDS.clOpinions)!.enabled).toBe(false);
    expect(await maybeAutoConfigure()).toBeNull();
  });
});

describe("search provenance", () => {
  it("links records to the matters whose searches found them, exactly and within the served matters", async () => {
    const { mattersForSearch, linkSourceRecordsToMatters } = await import("@/modules/intel/search-provenance");
    const { ingestDocument, intelDocuments } = await import("@/modules/intel/store");
    resetIntel();
    const plan = (matterId: string, caseLaw: string[], dockets: string[] = []) => ({ matterId, matterName: matterId, caseLaw: caseLaw.map((text) => ({ text, origin: "model" as const })), courts: [], dockets, mdls: [], judges: [], regulatory: [], statutes: [], products: [], news: [], method: "model" as const });
    db().kv.set(AUTOCONFIG_KEY, { plans: [plan("m_a", ['"refusal to deal" AND smartphone']), plan("m_b", ["tying AND app store"], ["2:24-cv-04055"])], changes: [], jobs: [] } satisfies AutoconfigState);
    expect(mattersForSearch("courtlistener-opinions", { query: '"Refusal to deal"   AND smartphone' })).toEqual(["m_a"]);
    expect(mattersForSearch("courtlistener-opinions", { query: "refusal to deal" })).toEqual([]);
    expect(mattersForSearch("courtlistener-dockets", { docketNumber: "2:24-cv-04055" })).toEqual(["m_b"]);
    expect(mattersForSearch("federal-register", { query: "tying AND app store" })).toEqual([]);
    const a = await ingestDocument({ sourceId: "src_test_op", adapter: "courtlistener-opinions", kind: "opinion", title: "Op A", externalId: "cl:test:a", dates: {}, text: "text a", meta: { query: '"refusal to deal" AND smartphone' } }, { embed: false });
    const b = await ingestDocument({ sourceId: "src_test_op", adapter: "courtlistener-opinions", kind: "opinion", title: "Op B", externalId: "cl:test:b", dates: {}, text: "text b", meta: { query: "tying AND app store" } }, { embed: false });
    // m_b is not served by this run: only m_a is linked.
    expect(linkSourceRecordsToMatters("src_test_op", "courtlistener-opinions", new Set(["m_a"]))).toBe(1);
    expect(intelDocuments().get(a.doc.id)!.matterIds).toEqual(["m_a"]);
    expect(intelDocuments().get(b.doc.id)!.matterIds).toEqual([]);
    expect(linkSourceRecordsToMatters("src_test_op", "courtlistener-opinions", new Set(["m_a"]))).toBe(0);
    for (const d of [a.doc, b.doc]) intelDocuments().delete(d.id);
  });
});
