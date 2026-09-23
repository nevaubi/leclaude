/** Server-sent events helpers shared by API routes (server) and hooks (client). */

export function encodeSSE(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Build a streaming Response from a producer. The producer receives `send`
 * and must resolve when finished; errors are forwarded as {type:"error"}.
 */
export function sseResponse(producer: (send: (event: unknown) => void, signal: AbortSignal) => Promise<void>, init: { headers?: Record<string, string> } = {}): Response {
  const encoder = new TextEncoder();
  const controller = new AbortController();
  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      let closed = false;
      const send = (event: unknown) => {
        if (closed) return;
        try { ctrl.enqueue(encoder.encode(encodeSSE(event))); } catch { closed = true; }
      };
      // keep-alive comments so proxies do not cut idle connections
      const ping = setInterval(() => { if (!closed) { try { ctrl.enqueue(encoder.encode(": ping\n\n")); } catch { closed = true; } } }, 15_000);
      try {
        await producer(send, controller.signal);
      } catch (e) {
        const err = e as { name?: string; message?: string; status?: number; code?: string };
        if (err?.name !== "AbortError") send({ type: "error", message: err?.message ?? String(e), code: err?.code ?? (err?.status ? String(err.status) : undefined) });
      } finally {
        clearInterval(ping);
        closed = true;
        try { ctrl.close(); } catch {}
      }
    },
    cancel() {
      controller.abort();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no", ...(init.headers ?? {}) },
  });
}

/** Client-side: read an SSE response and invoke onEvent for each JSON event. */
export async function readSSE<T = unknown>(res: Response, onEvent: (event: T) => void, signal?: AbortSignal): Promise<void> {
  if (!res.body) throw new Error("No response body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const abort = () => reader.cancel().catch(() => {});
  signal?.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          try { onEvent(JSON.parse(payload) as T); } catch { /* ignore malformed */ }
        }
      }
    }
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

/** Standard JSON error response for API routes. */
export function jsonError(message: string, status = 400, extra: Record<string, unknown> = {}) {
  return Response.json({ error: message, ...extra }, { status });
}
