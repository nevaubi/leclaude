import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  // A private, empty production database: reference data only, no sample workspace.
  process.env.LECLAUDE_DATA_DIR = `${process.env.VITEST_DATA_DIR || process.env.TMPDIR || "/tmp"}/demo-pack-vitest-${process.pid}`;
  process.env.LECLAUDE_SEED = "reference";
  process.env.LECLAUDE_BACKGROUND = "off";
  process.env.WORKFLOW_SCHEDULER_DISABLED = "1";
  process.env.INTEL_OFFLINE = "1";
  delete process.env.AUTH_MODE;
  delete process.env.AUTH_TRUST_HEADER;
  delete process.env.LECLAUDE_USER_ID;
  delete process.env.CRON_SECRET;
});

import { NextRequest } from "next/server";
import { db, resetSqlite } from "@/lib/db";
import { setWorkspaceUser } from "@/lib/current-user";
import { AUTH_HEADER_USER } from "@/lib/auth/types";
import { hybridSearch, VECTOR_COLLECTIONS } from "@/lib/ai/vector-store";
import { matterRetrievalScope, searchDocuments } from "@/modules/ediscovery/service";
import { createMember, setupWorkspace } from "@/modules/workspace/service";
import { createMatter } from "@/modules/matters/service";
import { listTeam } from "@/modules/workspace/service";
import { ensureLibraryStructure } from "@/modules/library/service";
import { DEMO_MANIFEST_KEY, loadDemoPack, type DemoManifest } from "@/modules/demo";
import { DEMO_MATTERS, DEMO_TEAM } from "@/modules/demo/ids";
import { DEMO_FOLDERS } from "@/modules/demo/workspace";
import { runWithPrincipal } from "@/lib/auth/context";
import { devPrincipal } from "@/lib/auth/principal";
import * as demo from "@/app/api/demo/route";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;
const nreq = (method: string, headers: Record<string, string> = {}) => new NextRequest("http://localhost/api/demo", { method, headers });
const call = async (h: unknown, req: NextRequest) => { const r = await (h as (r: NextRequest) => Promise<Response>)(req); return { status: r.status, body: (await r.json()) as Body }; };
const asHeader = (p: Body) => {
  process.env.AUTH_MODE = "header";
  process.env.AUTH_TRUST_HEADER = "true";
  return { [AUTH_HEADER_USER]: JSON.stringify(p) };
};

const C = DEMO_MATTERS.consumer;
let ownerId = "";
let ownMatterId = "";
let ownMemberId = "";
let firstCounts: Body = {};
let snapshot: Record<string, number> = {};

function collectionSizes(): Record<string, number> {
  const rows = db().raw.prepare("SELECT collection, COUNT(*) AS n FROM docs GROUP BY collection").all() as { collection: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.collection, Number(r.n)]));
}

beforeAll(() => {
  resetSqlite();
  setWorkspaceUser(null);
  db();
});
afterEach(() => { delete process.env.AUTH_MODE; delete process.env.AUTH_TRUST_HEADER; });

describe("demo pack on an empty workspace", () => {
  it("refuses to load before the workspace is set up", async () => {
    // No owner yet: the placeholder principal may not administer the workspace.
    const r = await call(demo.POST, nreq("POST"));
    expect(r.status).toBe(403);
    // The service itself also refuses without a workspace owner.
    await expect(loadDemoPack({ principal: devPrincipal() })).rejects.toMatchObject({ status: 409, code: "not_configured" });
    expect(db().matters.count()).toBe(0);
  });

  it("sets up an owner plus one non-demo matter and member that removal must not touch", () => {
    ownerId = setupWorkspace({ firmName: "Hale & Ortiz LLP", name: "Rebecca Ortiz", email: "rortiz@hale-ortiz.com", role: "Partner" }).owner!.id;
    ownMemberId = createMember({ name: "Daniel Park", email: "dpark@hale-ortiz.com", role: "Associate" }).id;
    ownMatterId = runWithPrincipal(devPrincipal(), () => createMatter({ name: "Valdosta Water Litigation", practiceArea: "Products Liability", clientSide: "plaintiff" })).id as string;
    expect(db().matters.count()).toBe(1);
  });

  it("reports not loaded", async () => {
    const r = await call(demo.GET, nreq("GET"));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ loaded: false, counts: null, matterId: C });
  });

  it("forbids a non-admin principal from loading or removing", async () => {
    const assoc = { id: ownMemberId, name: "Daniel Park", roles: ["associate"], matterIds: "*" };
    expect((await call(demo.POST, nreq("POST", asHeader(assoc)))).status).toBe(403);
    expect((await call(demo.DELETE, nreq("DELETE", asHeader(assoc)))).status).toBe(403);
    const para = { id: "p_someone", name: "Para Legal", roles: ["paralegal"], matterIds: "*" };
    expect((await call(demo.POST, nreq("POST", asHeader(para)))).status).toBe(403);
    expect(db().kv.get(DEMO_MANIFEST_KEY)).toBeNull();
  });

  it("loads the pack through the route (owner)", async () => {
    ensureLibraryStructure();
    snapshot = collectionSizes();
    const r = await call(demo.POST, nreq("POST"));
    expect(r.status).toBe(200);
    expect(r.body.loaded).toBe(true);
    firstCounts = r.body.counts;
    expect(firstCounts.matters).toBe(2);
    expect(firstCounts.teamMembers).toBe(2);
    expect(firstCounts.officeDocs).toBeGreaterThanOrEqual(5);
    expect(firstCounts.tasks).toBeGreaterThanOrEqual(20);
    expect(firstCounts.events).toBeGreaterThanOrEqual(12);
    expect(firstCounts.libraryItems).toBeGreaterThanOrEqual(20);
    expect(firstCounts.edocs).toBeGreaterThan(0);
    expect(firstCounts.depositions).toBeGreaterThan(0);
    expect(r.body.durationMs).toBeLessThan(30_000);
    console.log(`[demo-pack] load ${r.body.durationMs} ms`, JSON.stringify(firstCounts));
  });

  it("wrote the matters, team, folders, office documents, tasks and events", () => {
    const d = db();
    const consumer = d.matters.get(C)!;
    expect(consumer.leadAttorneyId).toBe(ownerId);
    expect(new Set(consumer.teamIds)).toEqual(new Set([ownerId, DEMO_TEAM.associate, DEMO_TEAM.paralegal]));
    expect(consumer.caption).toMatch(/DEMO/);
    expect(d.matters.get(DEMO_MATTERS.doj)).not.toBeNull();
    const team = listTeam();
    expect(team.filter((m) => m.id === DEMO_TEAM.associate || m.id === DEMO_TEAM.paralegal).map((m) => [m.firmRole, m.active])).toEqual(expect.arrayContaining([["Associate", true], ["Paralegal", true]]));
    for (const id of Object.values(DEMO_FOLDERS)) expect(d.library.get(id)?.type).toBe("folder");
    const kinds = d.officeDocs.find((x) => x.matterId === C).map((x) => x.kind);
    expect(new Set(kinds)).toEqual(new Set(["word", "sheet", "slides", "pdf"]));
    for (const doc of d.officeDocs.find((x) => x.matterId === C)) expect(d.library.findOne((l) => l.officeDocId === doc.id)).not.toBeNull();
    const pdf = d.officeDocs.find((x) => x.matterId === C && x.kind === "pdf")[0];
    expect((pdf.content as { pageCount: number }).pageCount).toBeGreaterThan(0);
    const tasks = d.tasks.find((t) => t.matterId === C || t.matterId === DEMO_MATTERS.doj);
    const today = new Date().toISOString().slice(0, 10);
    expect(tasks.some((t) => t.status !== "done" && t.dueAt! < today)).toBe(true);
    expect(tasks.some((t) => t.dueAt! > today)).toBe(true);
    expect(new Set(tasks.map((t) => t.assigneeId))).toEqual(new Set([ownerId, DEMO_TEAM.associate, DEMO_TEAM.paralegal]));
    // Calendar depositions of transcribed witnesses match the transcripts' dates.
    for (const dep of d.depositions.find((x) => x.matterId === C)) {
      expect(d.events.find((e) => e.kind === "deposition" && e.startsAt.slice(0, 10) === dep.date.slice(0, 10)).length).toBeGreaterThan(0);
    }
  });

  it("indexes the e-discovery documents within the matter only", async () => {
    const res = await runWithPrincipal(devPrincipal(), () => searchDocuments({ matterId: C, q: "commission", semantic: true }));
    expect(res.total).toBeGreaterThan(0);
    const hits = await hybridSearch(VECTOR_COLLECTIONS.edocs, "commission", { k: 5, scope: matterRetrievalScope(C) });
    expect(hits.length).toBeGreaterThan(0);
    const elsewhere = await hybridSearch(VECTOR_COLLECTIONS.edocs, "commission", { k: 5, scope: matterRetrievalScope(ownMatterId) });
    expect(elsewhere).toEqual([]);
  });

  it("reloads in place without duplicates", async () => {
    const before = collectionSizes();
    const r = await call(demo.POST, nreq("POST"));
    expect(r.status).toBe(200);
    expect(r.body.counts).toEqual(firstCounts);
    const after = collectionSizes();
    // Office versions are recreated with the documents; everything else is identical in size.
    for (const [name, n] of Object.entries(after)) if (name !== "office_versions" && !/audit/.test(name)) expect([name, n]).toEqual([name, before[name]]);
    expect(db().matters.count((m) => m.id === C)).toBe(1);
  });

  it("removes exactly the manifest and leaves the owner and non-demo records", async () => {
    const manifest = db().kv.get<DemoManifest>(DEMO_MANIFEST_KEY)!;
    expect(manifest.records.people).not.toContain(ownerId);
    const r = await call(demo.DELETE, nreq("DELETE"));
    expect(r.status).toBe(200);
    expect(r.body.loaded).toBe(false);
    console.log(`[demo-pack] remove ${r.body.durationMs} ms`, JSON.stringify(r.body.removed));
    expect(db().kv.get(DEMO_MANIFEST_KEY)).toBeNull();
    for (const [name, ids] of Object.entries(manifest.records)) for (const id of ids) expect(db().collection<{ id: string }>(name).has(id)).toBe(false);
    for (const id of manifest.blobs) expect(db().blobs.meta(id)).toBeNull();
    for (const key of manifest.kv) expect(db().kv.get(key)).toBeNull();
    expect(db().people.get(ownerId)).not.toBeNull();
    expect(db().people.get(ownMemberId)).not.toBeNull();
    expect(db().matters.get(ownMatterId)).not.toBeNull();
    const hits = await hybridSearch(VECTOR_COLLECTIONS.edocs, "commission", { k: 5, scope: matterRetrievalScope(C) });
    expect(hits).toEqual([]);
    // Every collection is back to its pre-load size (audit events are append-only and excluded).
    const after = collectionSizes();
    for (const [name, n] of Object.entries(snapshot)) if (!/audit/.test(name)) expect([name, after[name] ?? 0]).toEqual([name, n]);
    for (const name of Object.keys(after)) if (!/audit/.test(name) && !(name in snapshot)) expect([name, after[name]]).toEqual([name, 0]);
  });

  it("refuses to remove when nothing is loaded", async () => {
    const r = await call(demo.DELETE, nreq("DELETE"));
    expect(r.status).toBe(404);
  });
});
