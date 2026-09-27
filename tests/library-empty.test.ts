import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Library on an empty workspace (reference seed only): the system folders exist without any sample items,
 * matter folders come from real matters, New note/clause/template/folder work, uploads land in the tree, and
 * search on an empty library is an empty result rather than an error.
 */
vi.hoisted(() => {
  process.env.LECLAUDE_DATA_DIR = `${process.env.TMPDIR || "/tmp"}/library-empty-vitest-${process.pid}`;
  process.env.LECLAUDE_SEED = "reference";
  process.env.LECLAUDE_BACKGROUND = "off";
  process.env.WORKFLOW_SCHEDULER_DISABLED = "1";
  process.env.OPENAI_API_KEY = "";
  process.env.ANTHROPIC_API_KEY = "";
});

import { rmSync } from "node:fs";
import { NextRequest } from "next/server";
import { db, resetSqlite } from "@/lib/db";
import type { Matter } from "@/lib/types/domain";
import { LIBRARY_FOLDERS, isSystemFolder, matterFolderId } from "@/modules/library/ids";
import { deleteItem, listItems, treeResponse } from "@/modules/library/service";
import * as itemsRoute from "@/app/api/library/items/route";
import * as searchRoute from "@/app/api/library/search/route";
import * as treeRoute from "@/app/api/library/tree/route";
import * as importRoute from "@/app/api/office/import/route";
import { emptyDoc } from "@/modules/office/word/doc-model";
import * as wordExport from "@/app/api/office/word/export/route";
import * as docsRoute from "@/app/api/office/docs/route";

const post = (url: string, body: unknown) => new NextRequest(`http://localhost${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

beforeAll(() => {
  try { rmSync(process.env.LECLAUDE_DATA_DIR!, { recursive: true, force: true }); } catch { /* fresh */ }
  resetSqlite();
  db();
});

describe("library on an empty workspace", () => {
  it("has the system folders and no items", async () => {
    const res = await treeRoute.GET();
    expect(res.status).toBe(200);
    const tree = (await res.json()) as ReturnType<typeof treeResponse>;
    expect(tree.roots.map((r) => r.id).sort()).toEqual(Object.values(LIBRARY_FOLDERS).sort());
    expect(tree.views.all).toBe(0);
    expect(tree.matters).toEqual([]);
    const matters = tree.roots.find((r) => r.id === LIBRARY_FOLDERS.matters)!;
    expect(matters.children ?? []).toEqual([]);
    expect(db().library.all().filter((i) => i.type !== "folder")).toEqual([]);
    for (const id of Object.values(LIBRARY_FOLDERS)) expect(isSystemFolder(id)).toBe(true);
    expect(listItems({ folder: LIBRARY_FOLDERS.firm }).items).toEqual([]);
  });

  it("creates a matter folder for a real matter, and it is a protected system folder", () => {
    const m: Matter = { id: "m_test_empty", slug: "acme-v-widget", name: "Acme v. Widget", shortName: "Acme", client: "Acme Corp.", clientSide: "plaintiff", practiceArea: "Commercial", status: "active", openedAt: "2026-09-01", teamIds: [] };
    db().matters.put(m);
    const tree = treeResponse();
    const folder = tree.roots.find((r) => r.id === LIBRARY_FOLDERS.matters)!.children!.find((c) => c.id === matterFolderId(m.id));
    expect(folder?.name).toBe("Acme");
    expect(tree.matters.map((x) => x.id)).toEqual([m.id]);
    expect(isSystemFolder(matterFolderId(m.id))).toBe(true);
    expect(() => deleteItem(matterFolderId(m.id))).toThrow(/system folder/);
  });

  it("New note, clause, template and folder work", async () => {
    const cases = [
      { type: "note", name: "Kickoff notes", content: "# Kickoff\n\nAgenda and owners.", parentId: LIBRARY_FOLDERS.myFiles },
      { type: "clause", name: "Mutual waiver", content: "Neither party shall be liable to {{counterparty}} for consequential damages.", parentId: LIBRARY_FOLDERS.clauses, clause: { category: "limitation of liability" } },
      { type: "template", name: "Engagement letter", content: "Dear {{client}},", parentId: LIBRARY_FOLDERS.templates },
      { type: "folder", name: "Pleadings", parentId: matterFolderId("m_test_empty") },
    ];
    for (const c of cases) {
      const res = await itemsRoute.POST(post("/api/library/items", c));
      expect(res.status, `${c.type}: ${await res.clone().text()}`).toBe(201);
      const { item } = (await res.json()) as { item: { id: string; type: string; parentId: string | null; matterId?: string } };
      expect(item.type).toBe(c.type);
      expect(item.parentId).toBe(c.parentId);
      if (c.type === "folder") expect(item.matterId).toBe("m_test_empty");
    }
    expect(treeResponse().views.all).toBe(3);
  });

  it("uploads a .docx into a matter folder through the import path", async () => {
    const created = await docsRoute.POST(post("/api/office/docs", { kind: "word", content: emptyDoc(), addToLibrary: false }));
    const { doc } = (await created.json()) as { doc: { id: string } };
    const exp = await wordExport.POST(post("/api/office/word/export", { docId: doc.id, format: "docx" }));
    const bytes = new Uint8Array(await exp.arrayBuffer());
    const form = new FormData();
    form.append("file", new File([bytes as BlobPart], "Complaint draft.docx"));
    form.append("matterId", "m_test_empty");
    form.append("folderId", matterFolderId("m_test_empty"));
    const res = await importRoute.POST(new NextRequest("http://localhost/api/office/import", { method: "POST", body: form }));
    expect(res.status, await res.clone().text()).toBeLessThan(300);
    const list = listItems({ folder: matterFolderId("m_test_empty") });
    expect(list.items.some((i) => i.name.startsWith("Complaint draft") && i.type === "docx")).toBe(true);
  }, 30_000);

  it("search on a library with no match returns an empty result, not an error", async () => {
    const res = await searchRoute.GET(new NextRequest("http://localhost/api/library/search?q=nonexistent%20zebra%20quantum"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hits: unknown[]; query: string };
    expect(body.hits).toEqual([]);
    expect(body.query).toBe("nonexistent zebra quantum");
  });
});
