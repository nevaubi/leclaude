/**
 * Tool contract (constitution §52): runTool applies authorize → timeout → execute → bounded result → deterministic
 * error shaping, collects provenance out of band, and toProviderToolSpec carries examples to providers.
 */
import { describe, expect, it } from "vitest";
import { AuthError } from "@/lib/auth/errors";
import {
  boundToolResult, defineTool, isToolErrorResult, runTool, sanitizeErrorMessage, shapeToolError, toOpenAITool, toProviderToolSpec, ToolExecutionError, truncationMarker,
  TOOL_DEFAULT_MAX_RESULT_CHARS, TOOL_DEFAULT_TIMEOUT_MS, type AgentEmit, type ToolContext, type ToolDef,
} from "@/lib/ai/tools";
import { INTERNAL_TOOLS } from "@/lib/ai/toolkit/internal";
import { LEGAL_TOOLS, searchCaseLawTool } from "@/lib/ai/toolkit/legal";

function ctx(extra: Partial<ToolContext> = {}): ToolContext & { events: AgentEmit[] } {
  const events: AgentEmit[] = [];
  return { emit: (e) => events.push(e), state: {}, traceId: "trace_1", runId: "run_1", ...extra, events };
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(t); reject(Object.assign(new Error("aborted"), { name: "AbortError" })); }, { once: true });
});

describe("runTool", () => {
  it("returns a bounded, serialized result and emits started/completed traces", async () => {
    const tool = defineTool<{ n: number }, { doubled: number }>({ name: "double", description: "doubles", parameters: { type: "object", properties: { n: { type: "integer" } }, required: ["n"] }, execute: ({ n }) => ({ doubled: n * 2 }) });
    const c = ctx();
    const r = await runTool(tool, { n: 21 }, c);
    expect(r).toMatchObject({ name: "double", ok: true, value: { doubled: 42 }, output: JSON.stringify({ doubled: 42 }), truncated: false, timedOut: false, evidence: [] });
    expect(r.fullChars).toBe(r.output.length);
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
    const phases = c.events.filter((e) => e.type === "trace").map((e) => (e as { trace: { phase: string; traceId?: string; runId?: string } }).trace);
    expect(phases.map((p) => p.phase)).toEqual(["started", "completed"]);
    expect(phases[1]).toMatchObject({ traceId: "trace_1", runId: "run_1", ok: true, truncated: false });
  });

  it("denies through authorize with a deterministic unauthorized shape (never throws)", async () => {
    const tool = defineTool<{ matter: string }>({
      name: "guarded", description: "guarded", parameters: { type: "object", properties: { matter: { type: "string" } }, required: ["matter"] },
      authorize: ({ matter }) => { if (matter !== "m_ok") throw AuthError.forbidden("policy: matter access denied for principal"); },
      execute: () => ({ fine: true }),
    });
    const denied = await runTool(tool, { matter: "m_other" }, ctx());
    expect(denied.ok).toBe(false);
    expect(denied.error).toEqual({ error: "forbidden", code: "unauthorized", status: 403 });
    expect(JSON.parse(denied.output)).toEqual(denied.error);
    expect(denied.output).not.toContain("policy:"); // the policy reason stays in the audit log, not the model context
    const plain = defineTool<Record<string, never>>({ name: "g2", description: "g2", parameters: { type: "object", properties: {} }, authorize: () => { throw new Error("nope\n    at stack frame"); }, execute: () => 1 });
    const d2 = await runTool(plain, {}, ctx());
    expect(d2.error).toMatchObject({ code: "unauthorized", error: "nope" });
    const allowed = await runTool(tool, { matter: "m_ok" }, ctx());
    expect(allowed.ok).toBe(true);
  });

  it("times out with { error: \"timeout\" } and aborts the tool's signal", async () => {
    let sawAbort = false;
    const slow = defineTool<Record<string, never>>({ name: "slow", description: "slow", parameters: { type: "object", properties: {} }, timeoutMs: 40, execute: async (_a, c) => { try { await sleep(2_000, c.signal); } catch { sawAbort = true; throw new Error("aborted"); } return "late"; } });
    const started = Date.now();
    const r = await runTool(slow, {}, ctx());
    expect(Date.now() - started).toBeLessThan(1_500);
    expect(r.ok).toBe(false);
    expect(r.timedOut).toBe(true);
    expect(r.error).toEqual({ error: "timeout", code: "timeout", retryable: true });
    expect(JSON.parse(r.output)).toMatchObject({ error: "timeout" });
    await sleep(5);
    expect(sawAbort).toBe(true);
  });

  it("reports cancellation when the caller's signal is aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const tool = defineTool<Record<string, never>>({ name: "c", description: "c", parameters: { type: "object", properties: {} }, execute: () => "ran" });
    const r = await runTool(tool, {}, ctx({ signal: ctrl.signal }));
    expect(r.error).toEqual({ error: "cancelled", code: "cancelled" });
    const ctrl2 = new AbortController();
    const running = defineTool<Record<string, never>>({ name: "c2", description: "c2", parameters: { type: "object", properties: {} }, execute: async (_a, c) => { await sleep(2_000, c.signal); return "late"; } });
    const p = runTool(running, {}, ctx({ signal: ctrl2.signal }));
    setTimeout(() => ctrl2.abort(), 10);
    expect((await p).error?.code).toBe("cancelled");
  });

  it("truncates oversized results with an explicit marker and keeps JSON valid", async () => {
    const big = defineTool<Record<string, never>>({ name: "big", description: "big", parameters: { type: "object", properties: {} }, maxResultChars: 1_000, execute: () => ({ meta: "ok", text: "lorem ipsum ".repeat(600) }) });
    const r = await runTool(big, {}, ctx());
    expect(r.ok).toBe(true);
    expect(r.truncated).toBe(true);
    expect(r.output.length).toBeLessThanOrEqual(1_000);
    expect(r.fullChars).toBeGreaterThan(7_000);
    const parsed = JSON.parse(r.output) as { meta: string; text: string };
    expect(parsed.meta).toBe("ok");
    expect(parsed.text).toMatch(/\[truncated: \d+ more chars; ask for the next window\]$/);
    const remaining = Number(parsed.text.match(/\[truncated: (\d+) more chars/)![1]);
    expect(remaining).toBeGreaterThan(6_000);
    // A plain string result is hard-cut with the same marker.
    const str = defineTool<Record<string, never>>({ name: "s", description: "s", parameters: { type: "object", properties: {} }, maxResultChars: 200, execute: () => "y".repeat(5_000) });
    const rs = await runTool(str, {}, ctx());
    expect(rs.output.length).toBeLessThanOrEqual(200);
    const m = rs.output.match(/\n\[truncated: (\d+) more chars; ask for the next window\]$/);
    expect(m).not.toBeNull();
    const remainingStr = Number(m![1]);
    expect(rs.output.endsWith(truncationMarker(remainingStr))).toBe(true);
    expect(rs.output.length - truncationMarker(remainingStr).length + remainingStr).toBe(5_000); // head + remaining == full
    expect(rs.value).toBe(rs.output);
    // Defaults.
    expect(TOOL_DEFAULT_MAX_RESULT_CHARS).toBe(12_000);
    expect(TOOL_DEFAULT_TIMEOUT_MS).toBe(30_000);
    const small = boundToolResult({ a: 1 }, 50);
    expect(small).toEqual({ value: { a: 1 }, output: '{"a":1}', truncated: false, fullChars: 7 });
  });

  it("shapes thrown errors deterministically: no HTML, no stack traces, coded", async () => {
    const mk = (fn: () => unknown) => defineTool<Record<string, never>>({ name: "err", description: "err", parameters: { type: "object", properties: {} }, execute: fn });
    const html = await runTool(mk(() => { throw new Error("<html><body><h1>502 Bad Gateway</h1></body></html>\n    at Object.<anonymous> (/srv/app.js:1:1)"); }), {}, ctx());
    expect(html.error).toEqual({ error: "502 Bad Gateway", code: "tool_error" });
    expect(html.output).not.toMatch(/<|at Object/);
    const http = await runTool(mk(() => { throw Object.assign(new Error("503 Service Unavailable from www.courtlistener.com"), { name: "HttpError", status: 503, url: "https://x" }); }), {}, ctx());
    expect(http.error).toEqual({ error: "503 Service Unavailable from www.courtlistener.com", code: "upstream_error", status: 503, retryable: true });
    const scope = await runTool(mk(() => { throw Object.assign(new Error("retrieval without scope"), { name: "ScopeError", code: "scope_required" }); }), {}, ctx());
    expect(scope.error).toEqual({ error: "scope_required", code: "scope_required" });
    const nf = await runTool(mk(() => { throw new ToolExecutionError("not_found", "No document MFC-0000001 in the current matter scope"); }), {}, ctx());
    expect(nf.error).toEqual({ error: "No document MFC-0000001 in the current matter scope", code: "not_found" });
    const returned = await runTool(mk(() => ({ error: "scope_required", code: "scope_required", count: 0, results: [] })), {}, ctx());
    expect(returned.ok).toBe(false);
    expect(returned.error?.code).toBe("scope_required");
    expect(isToolErrorResult({ error: "x", code: "bogus" })).toBe(false);
    expect(shapeToolError(undefined)).toEqual({ error: "Tool failed", code: "tool_error" });
    expect(sanitizeErrorMessage("x".repeat(1_000)).length).toBe(400);
    const phases = html.error && (await runTool(mk(() => { throw new Error("boom"); }), {}, ctx()));
    expect(phases?.error?.error).toBe("boom");
  });

  it("collects evidence provenance emitted by the tool without putting it in the model-facing output", async () => {
    const tool = defineTool<Record<string, never>>({
      name: "ev", description: "ev", parameters: { type: "object", properties: {} },
      execute: (_a, c) => { c.emit({ type: "evidence", evidence: [{ source: "matter://m_1/document/d_1/chunk/0", kind: "document", provider: "ediscovery", tool: "ev", rank: 1, matterId: "m_1", retrievedAt: "2026-09-24T00:00:00Z" }] }); return { results: [{ source: "matter://m_1/document/d_1/chunk/0", passage: "…" }] }; },
    });
    const c = ctx();
    const r = await runTool(tool, {}, c);
    expect(r.evidence).toHaveLength(1);
    expect(r.evidence[0]).toMatchObject({ source: "matter://m_1/document/d_1/chunk/0", provider: "ediscovery" });
    expect(r.output).not.toContain("retrievedAt");
    expect(c.events.some((e) => e.type === "evidence")).toBe(true); // still forwarded to the caller's emit
  });
});

describe("provider tool specs", () => {
  it("maps examples, strict flag and the permissive schema; toOpenAITool is unchanged", () => {
    const def: ToolDef<{ bates: string; page?: number }> = {
      name: "read_doc", description: "read", parameters: { type: "object", properties: { bates: { type: "string" }, page: { type: "integer" } }, required: ["bates"] },
      examples: [{ bates: "MFC-0041877", page: 3 }, { bates: "MFC-0041877" }],
      execute: () => null,
    };
    const spec = toProviderToolSpec(def as ToolDef<never, unknown>);
    expect(spec).toEqual({ name: "read_doc", description: "read", parameters: def.parameters, strict: true, examples: [{ bates: "MFC-0041877", page: 3 }, { bates: "MFC-0041877" }] });
    expect(spec.examples).not.toBe(def.examples); // copied, not shared
    expect(spec.parameters).toBe(def.parameters); // providers apply their own strict transform
    const noEx = toProviderToolSpec({ ...def, examples: undefined, strict: false } as ToolDef<never, unknown>);
    expect(noEx).toEqual({ name: "read_doc", description: "read", parameters: def.parameters, strict: false });
    expect("examples" in noEx).toBe(false);
    const oa = toOpenAITool(def as ToolDef<never, unknown>);
    expect(oa.strict).toBe(true);
    expect((oa.parameters as { required: string[] }).required).toEqual(["bates", "page"]);
    expect((oa.parameters as { properties: { page: { type: unknown } } }).properties.page.type).toEqual(["integer", "null"]);
  });

  it("every internal and legal tool declares examples and a timeout", () => {
    for (const t of [...INTERNAL_TOOLS, ...LEGAL_TOOLS] as ToolDef<never, unknown>[]) {
      expect(t.examples?.length, t.name).toBeGreaterThan(0);
      expect(t.timeoutMs, t.name).toBeGreaterThan(0);
      const spec = toProviderToolSpec(t);
      expect(spec.examples?.length, t.name).toBe(t.examples!.length);
      // Examples only use declared parameters.
      const props = Object.keys((t.parameters.properties ?? {}) as Record<string, unknown>);
      for (const ex of t.examples!) for (const k of Object.keys(ex)) expect(props, `${t.name}.${k}`).toContain(k);
    }
    expect(toProviderToolSpec(searchCaseLawTool as ToolDef<never, unknown>).examples?.[0]).toMatchObject({ jurisdiction: "4th-circuit", filed_after: "2020-01-01" });
  });
});
