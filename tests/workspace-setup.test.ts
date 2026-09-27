import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.LECLAUDE_DATA_DIR = `${process.env.TMPDIR || "/tmp"}/workspace-setup-vitest-${process.pid}`;
  // A production database: reference data only (no demo matters, people or workspace).
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
import { currentUser, setWorkspaceUser, DEFAULT_USER } from "@/lib/current-user";
import { getWorkspace } from "@/lib/workspace";
import { devPrincipal } from "@/lib/auth/principal";
import { AUTH_HEADER_USER } from "@/lib/auth/types";
import { listAudit } from "@/lib/integrity/audit";
import * as workspace from "@/app/api/workspace/route";
import * as people from "@/app/api/people/route";
import * as person from "@/app/api/people/[id]/route";
import { isSetupExempt } from "@/modules/workspace/gate";
import { titleForRole } from "@/modules/workspace/service";

const nreq = (path: string, init?: RequestInit) => new NextRequest(`http://localhost${path}`, init as ConstructorParameters<typeof NextRequest>[1]);
const send = (path: string, body: unknown, method = "POST", headers: Record<string, string> = {}) => nreq(path, { method, body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
const json = async (r: Response) => ({ status: r.status, body: (await r.json()) as Record<string, unknown> & { [k: string]: any } }); // eslint-disable-line @typescript-eslint/no-explicit-any
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const call = (h: unknown, ...args: unknown[]) => (h as (...a: unknown[]) => Promise<Response>)(...args);

beforeAll(() => {
  resetSqlite();
  setWorkspaceUser(null);
  db();
});
afterEach(() => { delete process.env.AUTH_MODE; delete process.env.AUTH_TRUST_HEADER; });

describe("empty production database", () => {
  it("starts unconfigured with no matters, no people and the placeholder identity", async () => {
    expect(db().matters.count()).toBe(0);
    expect(db().people.count()).toBe(0);
    expect(getWorkspace().configured).toBe(false);
    expect(currentUser().id).toBe(DEFAULT_USER.id);
    const r = await json(await call(workspace.GET, nreq("/api/workspace")));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ configured: false, firmName: expect.any(String), owner: null });
    const team = await json(await call(people.GET, nreq("/api/people")));
    expect(team.body.people).toEqual([]);
  });

  it("gates every page except /setup and the API", () => {
    expect(isSetupExempt("/setup")).toBe(true);
    expect(isSetupExempt("/api/workspace")).toBe(true);
    expect(isSetupExempt("/")).toBe(false);
    expect(isSetupExempt("/matters")).toBe(false);
    expect(isSetupExempt("/setupx")).toBe(false);
  });
});

describe("first-run setup", () => {
  it("validates required fields with per-field messages and refuses bad JSON", async () => {
    const bad = await json(await call(workspace.POST, send("/api/workspace", { firmName: " ", name: "", email: "nope", role: "Boss" })));
    expect(bad.status).toBe(422);
    expect(Object.keys(bad.body.fields).sort()).toEqual(["email", "firmName", "name", "role"]);
    const notJson = await json(await call(workspace.POST, nreq("/api/workspace", { method: "POST", body: "{", headers: { "content-type": "application/json" } })));
    expect(notJson.status).toBe(400);
    expect(getWorkspace().configured).toBe(false);
  });

  let ownerId = "";
  it("creates the owner person and the workspace; the owner becomes the current user", async () => {
    const r = await json(await call(workspace.POST, send("/api/workspace", { firmName: "Hale & Ortiz LLP", name: "Rebecca Ortiz", email: "ROrtiz@hale-ortiz.com", role: "Partner" })));
    expect(r.status).toBe(201);
    expect(r.body.configured).toBe(true);
    expect(r.body.firmName).toBe("Hale & Ortiz LLP");
    ownerId = r.body.owner.id;
    expect(ownerId).toMatch(/^p_[a-z0-9_]+$/);
    expect(r.body.owner).toMatchObject({ name: "Rebecca Ortiz", email: "rortiz@hale-ortiz.com", firmRole: "Partner", title: "Partner", owner: true, active: true });

    const stored = db().people.get(ownerId)!;
    expect(stored).toMatchObject({ role: "attorney", title: "Partner", organization: "Hale & Ortiz LLP" });
    expect(getWorkspace()).toMatchObject({ configured: true, firmName: "Hale & Ortiz LLP", owner: { id: ownerId, name: "Rebecca Ortiz" } });
    expect(currentUser()).toEqual({ id: ownerId, name: "Rebecca Ortiz" });
    // The dev principal is now the owner with the partner role derived from the person record.
    expect(devPrincipal()).toMatchObject({ id: ownerId, roles: ["partner"] });
    expect(listAudit({ targetKind: "workspace" })[0]).toMatchObject({ action: "create", actorId: ownerId });
  });

  it("GET returns only the public shape (no secrets, no settings)", async () => {
    const r = await json(await call(workspace.GET, nreq("/api/workspace")));
    expect(Object.keys(r.body).sort()).toEqual(["configured", "firmName", "owner"]);
    expect(Object.keys(r.body.owner).sort()).toEqual(expect.arrayContaining(["id", "name", "email", "firmRole", "owner"]));
    expect(JSON.stringify(r.body)).not.toMatch(/key|secret|token|password/i);
  });

  it("refuses to re-run setup once configured (409) and leaves the owner unchanged", async () => {
    const r = await json(await call(workspace.POST, send("/api/workspace", { firmName: "Other LLP", name: "Mallory Intruder", email: "m@other.com", role: "Admin" })));
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("already_configured");
    expect(getWorkspace().owner?.id).toBe(ownerId);
    expect(db().people.count()).toBe(1);
  });

  it("PUT lets the owner edit the firm name and profile", async () => {
    const r = await json(await call(workspace.PUT, send("/api/workspace", { firmName: "Hale Ortiz & Park LLP", name: "Rebecca A. Ortiz", title: "Managing Partner" }, "PUT")));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ firmName: "Hale Ortiz & Park LLP", owner: { id: ownerId, name: "Rebecca A. Ortiz", title: "Managing Partner", firmRole: "Partner" } });
    expect(currentUser().name).toBe("Rebecca A. Ortiz");
    const invalid = await json(await call(workspace.PUT, send("/api/workspace", { email: "not-an-email" }, "PUT")));
    expect(invalid.status).toBe(422);
  });

  it("PUT is refused for a principal who is not the owner, a partner or an admin", async () => {
    process.env.AUTH_MODE = "header";
    process.env.AUTH_TRUST_HEADER = "true";
    const hdr = { [AUTH_HEADER_USER]: JSON.stringify({ id: "u_assoc", name: "Assoc", roles: ["associate"], matterIds: "*" }) };
    const r = await call(workspace.PUT, send("/api/workspace", { firmName: "Hijacked LLP" }, "PUT", hdr));
    expect(r.status).toBe(403);
    expect(getWorkspace().firmName).toBe("Hale Ortiz & Park LLP");
  });
});

describe("team", () => {
  let memberId = "";
  it("adds, lists and edits members; duplicate emails are refused", async () => {
    const add = await json(await call(people.POST, send("/api/people", { name: "Daniel Park", email: "dpark@hale-ortiz.com", role: "Associate", title: "Senior Associate" })));
    expect(add.status).toBe(201);
    memberId = add.body.person.id;
    expect(add.body.person).toMatchObject({ firmRole: "Associate", title: "Senior Associate", active: true, owner: false });
    const dup = await json(await call(people.POST, send("/api/people", { name: "D. Park", email: "DPARK@hale-ortiz.com", role: "Paralegal" })));
    expect(dup.status).toBe(409);
    const list = await json(await call(people.GET, nreq("/api/people")));
    expect(list.body.people.map((p: { id: string }) => p.id)).toEqual([ownerIdOf(), memberId]);
    expect(list.body.canManage).toBe(true);
    const edit = await json(await call(person.PATCH, send(`/api/people/${memberId}`, { role: "Paralegal" }, "PATCH"), params(memberId)));
    expect(edit.body.person).toMatchObject({ firmRole: "Paralegal", title: "Paralegal" });
    expect(db().people.get(memberId)?.role).toBe("paralegal");
  });

  it("keeps titles consistent with the role (a title never escalates access)", () => {
    expect(titleForRole("Associate", "Partner")).toBe("Associate");
    expect(titleForRole("Partner", "Managing Partner")).toBe("Managing Partner");
    expect(titleForRole("Admin", "Office manager")).toBe("Administrator");
  });

  it("deactivates instead of deleting, and never deactivates the owner", async () => {
    const off = await json(await call(person.DELETE, nreq(`/api/people/${memberId}`, { method: "DELETE" }), params(memberId)));
    expect(off.status).toBe(200);
    expect(off.body.person).toMatchObject({ active: false });
    expect(db().people.get(memberId)).not.toBeNull();
    const active = await json(await call(people.GET, nreq("/api/people")));
    expect(active.body.people.map((p: { id: string }) => p.id)).not.toContain(memberId);
    const all = await json(await call(people.GET, nreq("/api/people?inactive=1")));
    expect(all.body.people.map((p: { id: string }) => p.id)).toContain(memberId);
    const owner = await json(await call(person.DELETE, nreq(`/api/people/${ownerIdOf()}`, { method: "DELETE" }), params(ownerIdOf())));
    expect(owner.status).toBe(409);
    const again = await json(await call(person.PATCH, send(`/api/people/${memberId}`, { active: true }, "PATCH"), params(memberId)));
    expect(again.body.person.active).toBe(true);
    const missing = await call(person.DELETE, nreq("/api/people/p_nobody", { method: "DELETE" }), params("p_nobody"));
    expect(missing.status).toBe(404);
  });

  it("refuses team management to a paralegal and all access to a client guest", async () => {
    process.env.AUTH_MODE = "header";
    process.env.AUTH_TRUST_HEADER = "true";
    const para = { [AUTH_HEADER_USER]: JSON.stringify({ id: "u_para", name: "Para", roles: ["paralegal"], matterIds: "*" }) };
    expect((await call(people.POST, send("/api/people", { name: "X Y", email: "x@y.com", role: "Partner" }, "POST", para))).status).toBe(403);
    const guest = { [AUTH_HEADER_USER]: JSON.stringify({ id: "u_guest", name: "Guest", roles: ["client_guest"], matterIds: ["m_x"] }) };
    expect((await call(people.GET, nreq("/api/people", { headers: guest }))).status).toBe(403);
    expect((await call(workspace.GET, nreq("/api/workspace", { headers: guest }))).status).toBe(403);
  });
});

function ownerIdOf(): string {
  return getWorkspace().owner!.id;
}
