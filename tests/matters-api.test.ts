import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.LECLAUDE_DATA_DIR = `${process.env.TMPDIR || "/tmp"}/matters-api-vitest-${process.pid}`;
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
import { listAudit } from "@/lib/integrity/audit";
import { createMember, setupWorkspace } from "@/modules/workspace/service";
import { listMatters } from "@/modules/matters/service";
import * as matters from "@/app/api/matters/route";
import * as matterById from "@/app/api/matters/[id]/route";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;
const nreq = (path: string, init?: RequestInit) => new NextRequest(`http://localhost${path}`, init as ConstructorParameters<typeof NextRequest>[1]);
const send = (path: string, body: unknown, method = "POST", headers: Record<string, string> = {}) => nreq(path, { method, body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
const json = async (r: Response) => ({ status: r.status, body: (await r.json()) as Body });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const call = (h: unknown, ...args: unknown[]) => (h as (...a: unknown[]) => Promise<Response>)(...args);
const asHeader = (p: Body) => {
  process.env.AUTH_MODE = "header";
  process.env.AUTH_TRUST_HEADER = "true";
  return { [AUTH_HEADER_USER]: JSON.stringify(p) };
};

let ownerId = "";
let associateId = "";
let paralegalId = "";

beforeAll(() => {
  resetSqlite();
  setWorkspaceUser(null);
  db();
});
afterEach(() => { delete process.env.AUTH_MODE; delete process.env.AUTH_TRUST_HEADER; });

describe("empty workspace", () => {
  it("lists no matters before anything is created", async () => {
    expect(db().matters.count()).toBe(0);
    const r = await json(await call(matters.GET, nreq("/api/matters")));
    expect(r).toEqual({ status: 200, body: { matters: [], total: 0, archived: 0 } });
  });

  it("sets up the owner and team used below", () => {
    ownerId = setupWorkspace({ firmName: "Hale & Ortiz LLP", name: "Rebecca Ortiz", email: "rortiz@hale-ortiz.com", role: "Partner" }).owner!.id;
    associateId = createMember({ name: "Daniel Park", email: "dpark@hale-ortiz.com", role: "Associate" }).id;
    paralegalId = createMember({ name: "Lena Brandt", email: "lbrandt@hale-ortiz.com", role: "Paralegal" }).id;
    expect(new Set([ownerId, associateId, paralegalId]).size).toBe(3);
  });
});

describe("create", () => {
  let first = "";
  it("creates a matter with defaults, the creator on the team and an audit event", async () => {
    const r = await json(await call(matters.POST, send("/api/matters", { name: "In re: Valdosta Water Contamination Litigation", number: "2026-0141", client: "Valdosta Residents Group", clientSide: "plaintiff", practiceArea: "Products Liability", court: "M.D. Ga.", jurisdiction: "Federal", leadAttorneyId: associateId, teamIds: [paralegalId] })));
    expect(r.status).toBe(201);
    const m = r.body.matter;
    first = m.id;
    expect(m.id).toMatch(/^m_[a-z0-9_]+$/);
    expect(m).toMatchObject({ status: "active", shortName: "Valdosta Water Contamination", leadAttorneyName: "Daniel Park", archived: false, keyDates: [] });
    expect(new Set(m.teamIds)).toEqual(new Set([paralegalId, associateId, ownerId]));
    expect(m.openedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // No sample content is invented for a new matter.
    expect(db().issueCodes.count((c) => c.matterId === m.id)).toBe(0);
    expect(db().edocs.count((d) => d.matterId === m.id)).toBe(0);
    expect(listAudit({ targetKind: "matter", targetId: m.id })[0]).toMatchObject({ action: "create", actorId: ownerId });
  });

  it("rejects missing name/practice area, bad enums, unknown team ids and a non-attorney lead (422)", async () => {
    const r1 = await json(await call(matters.POST, send("/api/matters", { client: "Nobody" })));
    expect(r1.status).toBe(422);
    expect(Object.keys(r1.body.fields).sort()).toEqual(["name", "practiceArea"]);
    const r2 = await json(await call(matters.POST, send("/api/matters", { name: "X v. Y", practiceArea: "Litigation", status: "done", clientSide: "neutral" })));
    expect(Object.keys(r2.body.fields).sort()).toEqual(["clientSide", "status"]);
    const r3 = await json(await call(matters.POST, send("/api/matters", { name: "X v. Y", practiceArea: "Litigation", teamIds: ["p_ghost"] })));
    expect(r3.status).toBe(422);
    expect(r3.body.fields.teamIds).toMatch(/p_ghost/);
    const r4 = await json(await call(matters.POST, send("/api/matters", { name: "X v. Y", practiceArea: "Litigation", leadAttorneyId: paralegalId })));
    expect(r4.body.fields.leadAttorneyId).toBeDefined();
    const r5 = await call(matters.POST, nreq("/api/matters", { method: "POST", body: "not json" }));
    expect(r5.status).toBe(400);
    expect(db().matters.count()).toBe(1);
  });

  it("refuses a duplicate matter number (409), ignoring case and spaces", async () => {
    const r = await json(await call(matters.POST, send("/api/matters", { name: "Another matter", number: " 2026-0141 ", practiceArea: "Commercial" })));
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("duplicate_number");
    expect(r.body.fields.number).toMatch(/Valdosta/);
  });

  it("list filters by status and query", async () => {
    await call(matters.POST, send("/api/matters", { name: "Northfield Bank v. Carrow Holdings", number: "2026-0150", client: "Northfield Bank", practiceArea: "Commercial", status: "pre-suit" }));
    const open = await json(await call(matters.GET, nreq("/api/matters")));
    expect(open.body.total).toBe(2);
    const pre = await json(await call(matters.GET, nreq("/api/matters?status=pre-suit")));
    expect(pre.body.matters.map((m: Body) => m.client)).toEqual(["Northfield Bank"]);
    const q = await json(await call(matters.GET, nreq("/api/matters?q=valdosta")));
    expect(q.body.matters.map((m: Body) => m.id)).toEqual([first]);
    const byNumber = await json(await call(matters.GET, nreq("/api/matters?q=0150")));
    expect(byNumber.body.total).toBe(1);
    const bad = await call(matters.GET, nreq("/api/matters?status=deleted"));
    expect(bad.status).toBe(400);
  });

  it("updates fields, keeps the lead on the team, and validates patches", async () => {
    const r = await json(await call(matterById.PATCH, send(`/api/matters/${first}`, { stage: "Discovery", judge: "Hon. Leslie Abrams Gardner", leadAttorneyId: ownerId, number: "" }, "PATCH"), params(first)));
    expect(r.status).toBe(200);
    expect(r.body.matter).toMatchObject({ stage: "Discovery", judge: "Hon. Leslie Abrams Gardner", leadAttorneyId: ownerId, leadAttorneyName: "Rebecca Ortiz" });
    expect(r.body.matter.number).toBeUndefined();
    const bad = await json(await call(matterById.PATCH, send(`/api/matters/${first}`, { name: "" }, "PATCH"), params(first)));
    expect(bad.status).toBe(422);
    const missing = await call(matterById.PATCH, send("/api/matters/m_missing", { stage: "x" }, "PATCH"), params("m_missing"));
    expect(missing.status).toBe(404);
    const got = await json(await call(matterById.GET, nreq(`/api/matters/${first}`), params(first)));
    expect(got.body.matter.team.map((p: Body) => p.name).sort()).toEqual(["Daniel Park", "Lena Brandt", "Rebecca Ortiz"]);
  });

  it("archives on DELETE (never deletes) and restores with PATCH { archived: false }", async () => {
    const r = await json(await call(matterById.DELETE, nreq(`/api/matters/${first}`, { method: "DELETE" }), params(first)));
    expect(r.status).toBe(200);
    expect(r.body.matter).toMatchObject({ status: "closed", archived: true });
    expect(db().matters.get(first)).not.toBeNull();
    expect(listMatters().map((m) => m.id)).not.toContain(first);
    expect(listMatters({ status: "archived" }).map((m) => m.id)).toEqual([first]);
    expect(listMatters({ status: "closed" }).map((m) => m.id)).not.toContain(first);
    const restored = await json(await call(matterById.PATCH, send(`/api/matters/${first}`, { archived: false, status: "active" }, "PATCH"), params(first)));
    expect(restored.body.matter).toMatchObject({ status: "active", archived: false });
  });
});

describe("authorization", () => {
  it("denies a client guest the matter list and matters outside their share", async () => {
    const [m] = listMatters();
    const guest = asHeader({ id: "u_guest", name: "Client", roles: ["client_guest"], matterIds: ["m_other"] });
    expect((await call(matters.GET, nreq("/api/matters", { headers: guest }))).status).toBe(403);
    expect((await call(matters.POST, send("/api/matters", { name: "Guest matter", practiceArea: "Litigation" }, "POST", guest))).status).toBe(403);
    expect((await call(matterById.GET, nreq(`/api/matters/${m!.id}`, { headers: guest }), params(m!.id))).status).toBe(403);
    expect((await call(matterById.PATCH, send(`/api/matters/${m!.id}`, { stage: "x" }, "PATCH", guest), params(m!.id))).status).toBe(403);
  });

  it("scopes the list to a member's matters and denies a paralegal archiving", async () => {
    const all = listMatters({ status: "all" });
    const target = all[0]!;
    const scoped = asHeader({ id: "u_scoped", name: "Scoped", roles: ["associate"], matterIds: [target.id] });
    const r = await json(await call(matters.GET, nreq("/api/matters?status=all", { headers: scoped })));
    expect(r.body.matters.map((m: Body) => m.id)).toEqual([target.id]);
    const para = asHeader({ id: "u_para", name: "Para", roles: ["paralegal"], matterIds: "*" });
    expect((await call(matterById.DELETE, nreq(`/api/matters/${target.id}`, { method: "DELETE", headers: para }), params(target.id))).status).toBe(403);
    expect(db().matters.get(target.id)?.status).not.toBe("closed");
  });
});
