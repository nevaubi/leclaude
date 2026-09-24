import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import { db, resetSqlite } from "@/lib/db";
import type { EditProposal } from "@/modules/office/shared/types";
import type { OfficeAgentContext } from "@/modules/office/shared/route-factory";
import { ensureBlockIds, type PMNode } from "@/modules/office/word/doc-model";
import { buildSnapshot } from "@/modules/office/word/snapshot";
import { wordAgentTools } from "@/modules/office/word/agent-tools";

beforeAll(() => { resetSqlite(); });

function makeCtx(doc: PMNode) {
  const proposals: EditProposal[] = [];
  const snapshot = buildSnapshot(doc, { title: "Test doc", trackChangesOn: true });
  const ctx: OfficeAgentContext<typeof snapshot> = {
    mode: "draft", scope: null, research: false, snapshot, matter: null, docTitle: "Test doc", context: {}, proposals, findings: [],
    emit: () => {},
    propose: (p) => { const full: EditProposal = { id: `p${proposals.length + 1}`, status: "pending", ...p }; proposals.push(full); return full; },
    finding: (f) => ({ id: "f", ...f }),
  };
  return { ctx, proposals, snapshot };
}
const OUT = "/tmp/claude-0/-home-user-leclaude/1e92e83e-74f3-502e-8533-69680f74d3df/scratchpad/word-proposals.json";

describe("generate word proposals from seeded doc", () => {
  it("runs every edit tool once", async () => {
    const live = process.env.REVIEW_BASE ? ((await (await fetch(`${process.env.REVIEW_BASE}/api/office/docs/wd_afff_motion_brief`)).json()) as { doc: { content: PMNode } }).doc.content : null;
    const d = db().officeDocs.get("wd_afff_motion_brief")!;
    const doc = ensureBlockIds((live ?? d.content) as PMNode);
    const { ctx, proposals, snapshot } = makeCtx(doc);
    const tools = wordAgentTools(ctx);
    const run = async (name: string, args: Record<string, unknown>) => { const t = tools.find((x) => x.name === name)!; return (t.execute as (a: unknown, c: unknown) => unknown)(args, { emit: () => {}, state: {} }); };
    const paras = snapshot.blocks.filter((b) => b.type === "paragraph" && !b.table && !b.listInfo && b.wordCount > 8);
    const heads = snapshot.blocks.filter((b) => b.type === "heading");
    const lists = snapshot.blocks.filter((b) => b.listInfo);
    const tables = snapshot.blocks.filter((b) => b.table);
    console.log("paras", paras.length, "heads", heads.length, "lists", lists.length, "tables", tables.length);
    const p0 = paras[0], p1 = paras[1], p2 = paras[2], p3 = paras[3], p4 = paras[4];
    const word = p0.text.split(" ")[2];
    await run("rewrite_paragraph", { id: p0.id, markdown: `${p0.text} **Added sentence with emphasis.**`, reason: "test" });
    await run("replace_text_in_paragraph", { id: p1.id, find: p1.text.split(" ")[1], replace: "REPLACED", all: true });
    await run("insert_after", { id: p1.id, markdown: "New paragraph after.\n\n- bullet one\n- bullet two\n\n| A | B |\n| --- | --- |\n| 1 | 2 |" });
    await run("insert_before", { id: heads[1].id, markdown: "### Inserted heading\n\nBody under it." });
    await run("delete_paragraph", { id: p2.id });
    await run("move_block", { id: p3.id, after_id: p4.id });
    await run("set_style", { id: p4.id, style: "blockquote" });
    if (lists[0]) await run("set_style", { id: lists[0].id, style: "body" });
    await run("format_text", { id: p1.id, find: "REPLACED", marks: { bold: true, highlight: true } });
    await run("set_alignment", { id: heads[0].id, align: "center" });
    await run("find_replace_all", { find: word, replace: word.toUpperCase(), case_sensitive: true });
    await run("add_comment", { id: p1.id, text: "Please verify", quote: "REPLACED" });
    await run("insert_table_after", { id: heads[0].id, header: ["Date", "Event"], rows: [["2020", "x"], ["2021", "y"]], caption: "Timeline" });
    await run("insert_page_break_after", { id: heads[2].id });
    await run("insert_footnote", { id: p1.id, anchor_text: "REPLACED", footnote_text: "See Rule 56." });
    await run("insert_toc_after", { id: heads[0].id });
    await run("apply_template_section", { id: heads[heads.length - 1].id, template_section: "signature_block", position: "after" });
    await run("set_document_title", { title: "Renamed brief" });
    await run("renumber_lists", { style: "decimal" });
    if (tables[0]) await run("rewrite_paragraph", { id: tables[0].id, markdown: "Cell rewritten" });
    if (lists[1]) await run("replace_text_in_paragraph", { id: lists[1].id, find: lists[1].text.split(" ")[0], replace: "Item" });
    fs.writeFileSync(OUT, JSON.stringify(proposals, null, 1));
    expect(proposals.length).toBeGreaterThan(15);
  }, 120_000);
});
