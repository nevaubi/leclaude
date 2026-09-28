import { beforeAll, describe, expect, it, vi } from "vitest";
/**
 * Shared office agent protocol (route-factory + panel helpers):
 * - the prompt prefix (instructions) is identical across turns with different snapshots and scopes, and the
 *   snapshot travels with the user's message, so prompt caching can reuse the prefix;
 * - a module that owns its mode policy (`modeScopedTools`) is not filtered by the shared name pattern, and one
 *   that does not is (Ask mode loses edit-named tools);
 * - per-editor mode guidance replaces the shared text;
 * - a refused edit is classified as stale when the editor says the target changed.
 */
import type { RunAgentOptions } from "@/lib/ai/agent";
import type { ToolDef } from "@/lib/ai/tools";

const calls: RunAgentOptions[] = [];
vi.mock("@/lib/ai/agent", () => ({ runAgent: vi.fn(async (opts: RunAgentOptions) => { calls.push(opts); return { text: "", usage: { input: 0, output: 0, total: 0 } }; }) }));
vi.mock("@/lib/integrity/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/integrity/store", () => ({ putProvenance: vi.fn() }));

type Handler = (req: Request) => Promise<Response>;

function tool(name: string): ToolDef<never, unknown> {
  return { name, description: name, parameters: { type: "object", properties: {} }, execute: () => ({}) } as ToolDef<never, unknown>;
}

async function run(POST: Handler, body: Record<string, unknown>): Promise<RunAgentOptions> {
  const before = calls.length;
  const res = await POST(new Request("http://test/api/office/word/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ docId: "wd_proto", docTitle: "Protocol doc", ...body }) }));
  await res.text();
  expect(calls.length).toBe(before + 1);
  return calls[calls.length - 1];
}

function userText(opts: RunAgentOptions): string {
  const input = opts.input as Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>;
  const last = input[input.length - 1];
  return typeof last.content === "string" ? last.content : last.content.map((c) => c.text ?? "").join("\n");
}

describe("office agent prompt layout", () => {
  let POST: Handler;
  let scoped: Handler;
  beforeAll(async () => {
    // Seed first: the handler looks up matters, and seeding inside a timed test is slow under a loaded full run.
    const { db } = await import("@/lib/db");
    db();
    const { createOfficeAgentHandler } = await import("@/modules/office/shared/route-factory");
    POST = createOfficeAgentHandler<{ text: string }>({
      kind: "word",
      parseSnapshot: (raw) => ({ text: String((raw as { text?: string })?.text ?? "") }),
      instructions: () => "Test editor instructions.",
      tools: () => [tool("read_document"), tool("rewrite_paragraph")],
      renderSnapshot: (s) => `<<${s.text}>>`,
    });
    scoped = createOfficeAgentHandler<{ text: string }>({
      kind: "slides",
      parseSnapshot: (raw) => ({ text: String((raw as { text?: string })?.text ?? "") }),
      instructions: () => "Slides instructions.",
      tools: (ctx) => (ctx.mode === "ask" ? [tool("get_slides"), tool("set_title_probe")] : [tool("get_slides")]),
      renderSnapshot: (s) => s.text,
      modeScopedTools: true,
      modeGuidance: { review: "MODE: REVIEW. Comments only in this editor." },
    });
  });

  it("keeps the instructions identical across turns and sends the snapshot and scope with the user's message", async () => {
    const a = await run(POST, { message: "Tighten ¶2", mode: "draft", snapshot: { text: "First version" } });
    const b = await run(POST, { message: "Now ¶3", mode: "draft", snapshot: { text: "Second version" }, scope: { id: "paragraph:p3", label: "¶3", kind: "paragraph", text: "Scoped paragraph text" } });
    expect(a.instructions).toBe(b.instructions);
    expect(a.instructions).not.toContain("First version");
    expect(b.instructions).not.toContain("Scoped paragraph text");
    expect(a.cacheStablePrefix).toBe(true);
    expect(userText(a)).toContain("<<First version>>");
    expect(userText(a)).toContain("Tighten ¶2");
    expect(userText(b)).toContain("<<Second version>>");
    expect(userText(b)).toContain("Scoped paragraph text");
  });

  it("filters edit-named tools in Ask mode unless the module scopes tools itself", async () => {
    const ask = await run(POST, { message: "What does ¶2 say?", mode: "ask", snapshot: { text: "x" } });
    const names = (ask.tools ?? []).map((t) => t.name);
    expect(names).toContain("read_document");
    expect(names).not.toContain("rewrite_paragraph");

    const own = await run(scoped, { message: "What is on slide 2?", mode: "ask", snapshot: { text: "x" } });
    expect((own.tools ?? []).map((t) => t.name)).toContain("set_title_probe");
  });

  it("uses per-editor mode guidance when given", async () => {
    const review = await run(scoped, { message: "review", mode: "review", snapshot: { text: "x" } });
    expect(review.instructions).toContain("Comments only in this editor.");
    expect(review.instructions).not.toContain("also propose it with an editing tool");
    const shared = await run(POST, { message: "review", mode: "review", snapshot: { text: "x" } });
    expect(shared.instructions).toContain("also propose it with an editing tool");
  });
});

describe("refused proposal status", () => {
  it("classifies stale refusals from the flag or the editor's message", async () => {
    const { failedStatus } = await import("@/modules/office/shared/office-chrome-helpers");
    expect(failedStatus({ error: "anything", stale: true })).toBe("stale");
    expect(failedStatus({ error: "Slide 3 changed since this proposal was made" })).toBe("stale");
    expect(failedStatus({ error: "the paragraph changed after the assistant read it" })).toBe("stale");
    expect(failedStatus({ error: "\"indemnify\" is no longer in the paragraph" })).toBe("stale");
    expect(failedStatus({ error: "Unknown sheet Sheet9" })).toBe("failed");
    expect(failedStatus(undefined)).toBe("failed");
  });
});

describe("per-request routing", () => {
  it("passes the module's routing decision to the runtime", async () => {
    const { createOfficeAgentHandler } = await import("@/modules/office/shared/route-factory");
    const routed = createOfficeAgentHandler<{ text: string }>({
      kind: "sheet",
      parseSnapshot: () => ({ text: "" }),
      instructions: () => "Sheet instructions.",
      tools: () => [],
      renderSnapshot: () => "",
      maxSteps: 28,
      route: (_ctx, message) => (message.length < 20 ? { fast: true, reasoningEffort: "low", reason: "short" } : { fast: false, reasoningEffort: "high", reason: "analysis" }),
    });
    const quick = await run(routed, { message: "Bold row 1", mode: "draft", snapshot: {} });
    expect(quick.fast).toBe(true);
    expect(quick.reasoningEffort).toBe("low");
    expect(quick.maxSteps).toBe(28);
    const deep = await run(routed, { message: "Build a prejudgment interest schedule from the damages table", mode: "draft", snapshot: {} });
    expect(deep.fast).toBe(false);
    expect(deep.reasoningEffort).toBe("high");
  });
});

describe("ask-mode tool classification", () => {
  it("uses the declared access before the name fallback", async () => {
    const { isEditingTool } = await import("@/modules/office/shared/route-factory");
    expect(isEditingTool({ ...tool("get_everything"), access: "edit" })).toBe(true);
    expect(isEditingTool({ ...tool("rewrite_summary_preview"), access: "read" })).toBe(false);
    expect(isEditingTool({ ...tool("add_review_comment"), access: "suggest" })).toBe(true);
    for (const n of ["accept_all_changes", "resolve_comment", "edit_table_cell", "numbering_fix", "legal_caption", "redline_compare", "write_range"]) expect(isEditingTool(tool(n))).toBe(true);
    for (const n of ["get_paragraphs", "read_document", "check_citations", "find_text"]) expect(isEditingTool(tool(n))).toBe(false);
  });
});
