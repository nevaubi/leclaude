import "server-only";
import { nanoid } from "nanoid";
import type { ResponseInput, ResponseInputItem, Tool } from "openai/resources/responses/responses";
import { runAgent, type AgentEvent } from "@/lib/ai/agent";
import { AIConfigError } from "@/lib/ai/config";
import { jsonError, sseResponse } from "@/lib/ai/sse";
import { researchToolset } from "@/lib/ai/toolkit";
import type { ToolDef } from "@/lib/ai/tools";
import { db } from "@/lib/db";
import type { Matter, OfficeKind } from "@/lib/types/domain";
import { LEGAL_STYLE_RULES, FIRM_NAME, todayLine } from "@/lib/ai/prompts";
import type { EditProposal, OfficeAgentMode, OfficeAgentRequestBody, OfficeScope, ReviewFinding } from "./types";

export interface OfficeAgentContext<S> {
  mode: OfficeAgentMode;
  scope: OfficeScope | null;
  research: boolean;
  snapshot: S;
  matter: Matter | null;
  docTitle: string;
  docId?: string;
  context: Record<string, unknown>;
  /** Register an edit proposal; it is streamed to the client and returned for chaining. */
  propose: (p: Omit<EditProposal, "id" | "status">) => EditProposal;
  /** Register a review finding (review mode). */
  finding: (f: Omit<ReviewFinding, "id">) => ReviewFinding;
  proposals: EditProposal[];
  findings: ReviewFinding[];
  emit: (e: AgentEvent) => void;
}

export interface OfficeAgentConfig<S> {
  kind: OfficeKind;
  /** Validate/normalize the raw snapshot sent by the editor. Throw on invalid. */
  parseSnapshot: (raw: unknown) => S;
  /** Editor-specific instructions: describe the document model, the tool vocabulary and mode behaviour. */
  instructions: (ctx: OfficeAgentContext<S>) => string;
  /** Document read/edit tools bound to the snapshot. */
  tools: (ctx: OfficeAgentContext<S>) => ToolDef<never, unknown>[];
  /** Compact serialization of the snapshot for the prompt (keep it under ~30k chars). */
  renderSnapshot: (snapshot: S, scope: OfficeScope | null) => string;
  maxSteps?: number;
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
}

const MODE_GUIDANCE: Record<OfficeAgentMode, string> = {
  draft: `MODE: DRAFT. The user wants changes made. Use the editing tools to make every change they asked for (and the obvious consequential ones, e.g. cross-references, numbering, defined terms). Each tool call becomes a previewed edit the user can apply. Do not describe edits you could have made with a tool — make them. After editing, reply with a brief summary (2–6 bullet points) of what you changed and anything that needs the user's judgment. Never paste the full document into chat.`,
  review: `MODE: REVIEW. Do not change the document. Read it carefully (use the read tools to see every part in scope) and record each issue with the report_finding tool: citations that need verification, undefined or inconsistent defined terms, broken cross-references, numbering/formatting defects, missing standard provisions, factual or logical gaps, risk allocation problems, tone/style issues, formula or data errors. Where a fix is mechanical and safe, also propose it with an editing tool so the user can apply it in one click. Finish with a short prioritized summary.`,
  ask: `MODE: ASK. Answer questions about the document (and, if research is enabled, the law and facts around it). Quote the document precisely with paragraph/cell/slide references. Do not modify the document; do not call editing tools.`,
};

/** Build a POST handler that streams the office agent's events for one editor kind. */
export function createOfficeAgentHandler<S>(config: OfficeAgentConfig<S>) {
  return async function POST(req: Request): Promise<Response> {
    let body: OfficeAgentRequestBody;
    try { body = (await req.json()) as OfficeAgentRequestBody; } catch { return jsonError("Invalid JSON body"); }
    if (!body || typeof body.message !== "string") return jsonError("`message` is required");
    const mode: OfficeAgentMode = (["draft", "review", "ask"] as const).includes(body.mode) ? body.mode : "draft";
    let snapshot: S;
    try { snapshot = config.parseSnapshot(body.snapshot); } catch (e) { return jsonError(`Invalid snapshot: ${(e as Error).message}`); }
    const matter = body.matterId ? db().matters.get(body.matterId) : null;

    return sseResponse(async (send, signal) => {
      const proposals: EditProposal[] = [];
      const findings: ReviewFinding[] = [];
      const ctx: OfficeAgentContext<S> = {
        mode,
        scope: body.scope ?? null,
        research: Boolean(body.research),
        snapshot,
        matter,
        docTitle: body.docTitle ?? "Untitled",
        docId: body.docId,
        context: body.context ?? {},
        proposals,
        findings,
        emit: (e) => send(e),
        propose: (p) => {
          const full: EditProposal = { id: nanoid(8), status: "pending", ...p };
          proposals.push(full);
          send({ type: "proposal", proposal: full });
          return full;
        },
        finding: (f) => {
          const full: ReviewFinding = { id: nanoid(8), ...f };
          findings.push(full);
          send({ type: "artifact", artifact: { kind: "review-finding", title: full.title, data: full } });
          return full;
        },
      };

      const docTools = mode === "ask" ? config.tools(ctx).filter((t) => !isEditingTool(t)) : config.tools(ctx);
      const tools: ToolDef<never, unknown>[] = [...docTools];
      let builtinTools: Tool[] = [];
      if (mode === "review") tools.push(reportFindingTool(ctx));
      if (ctx.research) {
        const r = researchToolset({ web: true, legal: true, internal: true, webContextSize: "medium" });
        tools.push(...r.tools);
        builtinTools = r.builtinTools;
      } else {
        // Internal knowledge is always available; only external research is gated by the toggle.
        tools.push(...researchToolset({ web: false, legal: false, internal: true }).tools);
      }

      const instructions = [
        `You are the ${FIRM_NAME} ${KIND_NAME[config.kind]} drafting assistant embedded in the firm's ${KIND_NAME[config.kind]} editor. ${todayLine()}`,
        `You work on the open document "${ctx.docTitle}"${matter ? ` for the matter ${matter.name} (${matter.caption ?? matter.shortName}; client ${matter.client}, ${matter.clientSide}; ${matter.court ?? "no court"}; stage: ${matter.stage ?? "n/a"})` : ""}.`,
        MODE_GUIDANCE[mode],
        ctx.scope && ctx.scope.kind !== "document" ? `SCOPE: The user scoped this request to ${ctx.scope.label} (${ctx.scope.id}). Focus your reads and edits there unless the request clearly needs the whole document.${ctx.scope.text ? `\nScoped text:\n"""\n${ctx.scope.text.slice(0, 8000)}\n"""` : ""}` : "SCOPE: whole document.",
        ctx.research ? "RESEARCH: enabled. You may use web search, case law, statutes/regulations, dockets and the firm library. Read primary sources before relying on them and cite them." : "RESEARCH: external research is OFF. You may still search the firm library, matter documents and matter context. If the task needs outside authority, say so and mark placeholders [VERIFY].",
        LEGAL_STYLE_RULES,
        config.instructions(ctx),
        `CURRENT DOCUMENT SNAPSHOT (the authoritative state; reads through tools return the same content with ids):\n${config.renderSnapshot(snapshot, ctx.scope)}`,
      ].join("\n\n");

      const input: ResponseInput = [];
      for (const h of (body.history ?? []).slice(-12)) input.push({ role: h.role, content: h.content.slice(0, 12_000) } as ResponseInputItem);
      const userContent: Array<{ type: "input_text"; text: string } | { type: "input_image"; image_url: string; detail: "high" | "low" | "auto" }> = [{ type: "input_text", text: body.message }];
      for (const a of body.attachments ?? []) if (a?.dataUrl?.startsWith("data:image/")) userContent.push({ type: "input_image", image_url: a.dataUrl, detail: "high" });
      input.push({ role: "user", content: userContent } as ResponseInputItem);

      try {
        await runAgent({
          instructions,
          input,
          tools,
          builtinTools,
          maxSteps: config.maxSteps ?? 16,
          reasoningEffort: config.reasoningEffort,
          verbosity: "low",
          signal,
          state: { snapshot, mode },
          metadata: { app: "leclaude", surface: `office-${config.kind}`, mode },
          onEvent: (e) => send(e),
        });
      } catch (e) {
        if (e instanceof AIConfigError) { send({ type: "error", message: e.message, code: "no_api_key" }); return; }
        throw e;
      } finally {
        send({ type: "artifact", artifact: { kind: "office-summary", title: "summary", data: { proposals: proposals.length, findings: findings.length } } });
      }
    });
  };
}

const KIND_NAME: Record<OfficeKind, string> = { word: "Word", sheet: "Excel", slides: "PowerPoint", pdf: "PDF" };

function isEditingTool(t: ToolDef<never, unknown>) {
  return /^(rewrite|insert|delete|replace|format|set|add|remove|move|apply|style|sort|fill|merge|split|redact|annotate|rotate|reorder|resize|update|clear|append|prepend|convert|create|polish|fix|renumber|generate|build|transcribe|bates|duplicate|condense|restyle|freeze|rename|conditional|autofit|unmerge|hide|show|protect|group)_/i.test(t.name) || t.name === "find_replace";
}

function reportFindingTool<S>(ctx: OfficeAgentContext<S>): ToolDef<never, unknown> {
  return {
    name: "report_finding",
    description: "Record a review finding for the user. Call once per distinct issue. Include a concrete suggestion. Use target ids from the document snapshot so the finding can be located.",
    parameters: {
      type: "object",
      properties: {
        severity: { type: "string", enum: ["info", "low", "medium", "high", "critical"] },
        category: { type: "string", description: "citation | defined-term | cross-reference | numbering | formatting | missing-provision | risk | logic | style | formula | data | consistency | privilege | other" },
        title: { type: "string" },
        detail: { type: "string", description: "What is wrong and why it matters, 1–3 sentences" },
        target: { type: "string", description: "Paragraph id / cell ref / slide id / page number" },
        target_label: { type: "string", description: "Human label like ¶12, B4, Slide 3, p. 2" },
        suggestion: { type: "string", description: "Concrete fix" },
      },
      required: ["severity", "category", "title", "detail"],
    },
    execute: (args: { severity: ReviewFinding["severity"]; category: string; title: string; detail: string; target?: string; target_label?: string; suggestion?: string }) => {
      const f = ctx.finding({ severity: args.severity, category: args.category, title: args.title, detail: args.detail, target: args.target, targetLabel: args.target_label, suggestion: args.suggestion });
      return { recorded: f.id };
    },
  } as ToolDef<never, unknown>;
}
