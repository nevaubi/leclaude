"use client";
import * as React from "react";
import { nanoid } from "nanoid";
import { readSSE } from "@/lib/ai/sse";
import type { AgentEvent } from "@/lib/ai/agent";

export interface ToolActivity {
  id: string;
  name: string;
  label: string;
  args: Record<string, unknown>;
  status: "running" | "done" | "error";
  result?: unknown;
  error?: string;
  durationMs?: number;
}

export interface Citation { title: string; url?: string; cite?: string; snippet?: string; source?: string }

export interface AgentAttachment { kind: "image"; name: string; dataUrl: string }

export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  attachments?: AgentAttachment[];
  tools?: ToolActivity[];
  citations?: Citation[];
  reasoning?: string;
  status?: "streaming" | "done" | "error" | "stopped";
  error?: string;
  meta?: Record<string, unknown>;
}

export interface UseAgentOptions<TExtra = Record<string, unknown>> {
  endpoint: string;
  /** Extra JSON merged into each request body (snapshot, mode, scope…). Can be a function evaluated per send. */
  extra?: TExtra | (() => TExtra);
  /** Called for every event (proposals, artifacts, progress…). */
  onEvent?: (event: AgentEvent, ctx: { messageId: string }) => void;
  onDone?: (message: AgentMessage) => void;
  onError?: (error: string) => void;
  initialMessages?: AgentMessage[];
}

export function useAgent<TExtra = Record<string, unknown>>(opts: UseAgentOptions<TExtra>) {
  const [messages, setMessages] = React.useState<AgentMessage[]>(opts.initialMessages ?? []);
  const [status, setStatus] = React.useState<"idle" | "streaming" | "error">("idle");
  const [statusLine, setStatusLine] = React.useState<string | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const responseIdRef = React.useRef<string | null>(null);
  const optsRef = React.useRef(opts);
  optsRef.current = opts;

  const patchMessage = React.useCallback((id: string, fn: (m: AgentMessage) => AgentMessage) => {
    setMessages((ms) => ms.map((m) => (m.id === id ? fn(m) : m)));
  }, []);

  const stop = React.useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("idle");
    setStatusLine(null);
    setMessages((ms) => ms.map((m) => (m.status === "streaming" ? { ...m, status: "stopped" } : m)));
  }, []);

  const send = React.useCallback(
    async (content: string, options: { attachments?: AgentAttachment[]; extra?: Record<string, unknown>; hidden?: boolean } = {}) => {
      const text = content.trim();
      if (!text && !options.attachments?.length) return;
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      const userMsg: AgentMessage = { id: nanoid(8), role: "user", content: text, createdAt: Date.now(), attachments: options.attachments };
      const asstMsg: AgentMessage = { id: nanoid(8), role: "assistant", content: "", createdAt: Date.now(), tools: [], citations: [], status: "streaming" };
      const history = messages.filter((m) => m.status !== "error").map((m) => ({ role: m.role, content: m.content, attachments: m.attachments }));
      setMessages((ms) => [...ms, ...(options.hidden ? [] : [userMsg]), asstMsg]);
      setStatus("streaming");
      setStatusLine("Thinking…");

      const extra = typeof optsRef.current.extra === "function" ? (optsRef.current.extra as () => TExtra)() : optsRef.current.extra;
      const body = { message: text, attachments: options.attachments ?? [], history, previousResponseId: responseIdRef.current, ...(extra ?? {}), ...(options.extra ?? {}) };

      try {
        const res = await fetch(optsRef.current.endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal });
        if (!res.ok || !res.body) {
          let msg = `${res.status} ${res.statusText}`;
          try { const j = (await res.json()) as { error?: string }; if (j.error) msg = j.error; } catch {}
          throw new Error(msg);
        }
        let reasoning = "";
        await readSSE<AgentEvent>(
          res,
          (ev) => {
            optsRef.current.onEvent?.(ev, { messageId: asstMsg.id });
            switch (ev.type) {
              case "text.delta":
                setStatusLine(null);
                patchMessage(asstMsg.id, (m) => ({ ...m, content: m.content + ev.delta }));
                break;
              case "reasoning.delta":
                reasoning += ev.delta;
                setStatusLine("Reasoning…");
                patchMessage(asstMsg.id, (m) => ({ ...m, reasoning }));
                break;
              case "status":
                setStatusLine(ev.message);
                break;
              case "web_search":
                setStatusLine(ev.status === "searching" ? "Searching the web…" : ev.query ? `Searched: ${ev.query}` : "Web search complete");
                if (ev.status === "completed") patchMessage(asstMsg.id, (m) => ({ ...m, tools: [...(m.tools ?? []), { id: nanoid(6), name: "web_search", label: ev.query ? `Web search: ${ev.query}` : "Web search", args: { query: ev.query }, status: "done" }] }));
                break;
              case "tool.call":
                setStatusLine(ev.label);
                patchMessage(asstMsg.id, (m) => ({ ...m, tools: [...(m.tools ?? []), { id: ev.id, name: ev.name, label: ev.label, args: ev.args, status: "running" }] }));
                break;
              case "tool.result":
                patchMessage(asstMsg.id, (m) => ({ ...m, tools: (m.tools ?? []).map((t) => (t.id === ev.id ? { ...t, status: ev.ok ? "done" : "error", result: ev.result, error: ev.error, durationMs: ev.durationMs } : t)) }));
                break;
              case "citation":
                patchMessage(asstMsg.id, (m) => {
                  const key = ev.citation.url ?? ev.citation.cite ?? ev.citation.title;
                  if ((m.citations ?? []).some((c) => (c.url ?? c.cite ?? c.title) === key)) return m;
                  return { ...m, citations: [...(m.citations ?? []), ev.citation] };
                });
                break;
              case "done":
                responseIdRef.current = ev.responseId;
                patchMessage(asstMsg.id, (m) => ({ ...m, status: "done", meta: { ...(m.meta ?? {}), usage: ev.usage } }));
                break;
              case "error":
                patchMessage(asstMsg.id, (m) => ({ ...m, status: "error", error: ev.message }));
                optsRef.current.onError?.(ev.message);
                break;
              default:
                break;
            }
          },
          ctrl.signal,
        );
        setMessages((ms) => {
          const final = ms.find((m) => m.id === asstMsg.id);
          if (final) { optsRef.current.onDone?.(final.status === "streaming" ? { ...final, status: "done" } : final); }
          return ms.map((m) => (m.id === asstMsg.id && m.status === "streaming" ? { ...m, status: "done" } : m));
        });
        setStatus("idle");
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        const message = e instanceof Error ? e.message : String(e);
        patchMessage(asstMsg.id, (m) => ({ ...m, status: "error", error: message }));
        setStatus("error");
        optsRef.current.onError?.(message);
      } finally {
        setStatusLine(null);
        if (abortRef.current === ctrl) abortRef.current = null;
      }
    },
    [messages, patchMessage],
  );

  const reset = React.useCallback(() => {
    stop();
    responseIdRef.current = null;
    setMessages([]);
  }, [stop]);

  return { messages, setMessages, status, statusLine, send, stop, reset, isStreaming: status === "streaming" };
}

/** Read files into data-URL attachments (images only). */
export async function filesToAttachments(files: FileList | File[]): Promise<AgentAttachment[]> {
  const out: AgentAttachment[] = [];
  for (const f of Array.from(files)) {
    if (!f.type.startsWith("image/")) continue;
    const dataUrl = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f); });
    out.push({ kind: "image", name: f.name, dataUrl });
  }
  return out;
}
