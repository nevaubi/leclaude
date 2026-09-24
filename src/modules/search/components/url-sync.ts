/**
 * URL ↔ research state: which action the page should take for the current
 * `?q=` / `?thread=` search params. Pure so the race between
 * history.replaceState and Next's useSearchParams sync (which lags a render)
 * can be pinned in tests: a question is consumed at most once, and opening a
 * thread never re-runs the previous question.
 */
export interface UrlSyncInput {
  hydrated: boolean;
  tool: "research" | "citecheck";
  urlQ: string;
  urlThread: string;
  /** The last `?q=` this page already ran (from the URL or the composer). */
  handledQ: string | null;
  /** The last `?thread=` this page already opened (or created by a run). */
  handledThread: string | null;
  activeThreadId: string | null;
}

export type UrlAction = { type: "none" } | { type: "openThread"; id: string } | { type: "ask"; q: string };

export function urlAction(s: UrlSyncInput): UrlAction {
  if (!s.hydrated || s.tool === "citecheck") return { type: "none" };
  const thread = s.urlThread.trim();
  if (thread) {
    if (thread !== s.activeThreadId && thread !== s.handledThread) return { type: "openThread", id: thread };
    return { type: "none" };
  }
  const q = s.urlQ.trim();
  if (q && q !== (s.handledQ ?? "").trim()) return { type: "ask", q };
  return { type: "none" };
}

/** Build the search-page URL for a state (thread wins over question; the cite checker has its own URL). */
export function searchUrl(next: { q?: string | null; thread?: string | null; tool?: "research" | "citecheck" }): string {
  const sp = new URLSearchParams();
  if (next.tool === "citecheck") sp.set("tool", "citecheck");
  else if (next.thread) sp.set("thread", next.thread);
  else if (next.q) sp.set("q", next.q);
  const qs = sp.toString();
  return qs ? `/search?${qs}` : "/search";
}
