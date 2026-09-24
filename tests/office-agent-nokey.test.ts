import { beforeAll, describe, expect, it, vi } from "vitest";
/**
 * Office agent route without an OpenAI key: the stream must carry an explicit
 * `no_api_key` error plus a degraded summary, and must NOT write an audit event
 * or a provenance record for a generation that never ran. The client panel keeps
 * its dedicated key card because the provenance artifact is not sent.
 */
import { AIConfigError } from "@/lib/ai/config";

const audit = vi.fn();
const putProvenance = vi.fn();
vi.mock("@/lib/ai/agent", () => ({ runAgent: vi.fn(async () => { throw new AIConfigError(); }) }));
vi.mock("@/lib/integrity/audit", () => ({ audit: (...args: unknown[]) => audit(...args) }));
vi.mock("@/lib/integrity/store", () => ({ putProvenance: (...args: unknown[]) => putProvenance(...args) }));

type Ev = { type: string; code?: string; message?: string; artifact?: { kind: string; data: Record<string, unknown> } };

async function readEvents(res: Response): Promise<Ev[]> {
  const text = await res.text();
  return text.split("\n\n").filter((l) => l.startsWith("data:")).map((l) => JSON.parse(l.slice(5)) as Ev);
}

describe("office agent route without an API key", () => {
  let POST: (req: Request) => Promise<Response>;
  beforeAll(async () => {
    const { createOfficeAgentHandler } = await import("@/modules/office/shared/route-factory");
    POST = createOfficeAgentHandler<{ text: string }>({
      kind: "word",
      parseSnapshot: (raw) => ({ text: String((raw as { text?: string })?.text ?? "") }),
      instructions: () => "Test editor instructions.",
      tools: () => [],
      renderSnapshot: (s) => s.text,
    });
  });

  it("streams a no_api_key error and a degraded summary, and records nothing", async () => {
    audit.mockClear(); putProvenance.mockClear();
    const res = await POST(new Request("http://test/api/office/word/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "Tighten the standard", mode: "draft", snapshot: { text: "Some paragraph." }, docId: "wd_test", docTitle: "Test doc" }) }));
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    const events = await readEvents(res);
    const err = events.find((e) => e.type === "error");
    expect(err?.code).toBe("no_api_key");
    expect(err?.message).toMatch(/OPENAI_API_KEY/);
    const summary = events.find((e) => e.type === "artifact" && e.artifact?.kind === "office-summary");
    expect(summary?.artifact?.data).toMatchObject({ proposals: 0, findings: 0, sources: 0, error: "no_api_key" });
    expect(events.some((e) => e.type === "artifact" && e.artifact?.kind === "office-provenance")).toBe(false);
    expect(audit).not.toHaveBeenCalled();
    expect(putProvenance).not.toHaveBeenCalled();
  });

  it("rejects a body without a message before touching the runtime", async () => {
    const res = await POST(new Request("http://test/api/office/word/agent", { method: "POST", body: JSON.stringify({ mode: "draft", snapshot: {} }) }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    const j = (await res.json()) as { error?: string };
    expect(j.error).toMatch(/message/);
  });
});
