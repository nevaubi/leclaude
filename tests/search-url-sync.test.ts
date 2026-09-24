import { describe, expect, it } from "vitest";
import { searchUrl, urlAction, type UrlSyncInput } from "@/modules/search/components/url-sync";

const base: UrlSyncInput = { hydrated: true, tool: "research", urlQ: "", urlThread: "", handledQ: null, handledThread: null, activeThreadId: null };

describe("research page URL sync", () => {
  it("runs a ?q= question once and never again for the same text", () => {
    expect(urlAction({ ...base, urlQ: "Is X preempted?" })).toEqual({ type: "ask", q: "Is X preempted?" });
    expect(urlAction({ ...base, urlQ: "Is X preempted?", handledQ: "Is X preempted?" })).toEqual({ type: "none" });
    expect(urlAction({ ...base, urlQ: "  Is X preempted?  ", handledQ: "Is X preempted?" })).toEqual({ type: "none" });
  });

  it("does not re-run the previous question while the URL still lags behind a thread open (the duplicate-thread race)", () => {
    // The composer asked q1 (handledQ = q1, URL ?q=q1). The user opens thread T2 from the rail; the URL is
    // replaced with ?thread=T2 but useSearchParams still reports ?q=q1 for one render.
    const lagging: UrlSyncInput = { ...base, urlQ: "q1", handledQ: "q1", handledThread: "T2", activeThreadId: "T2" };
    expect(urlAction(lagging)).toEqual({ type: "none" });
    // Once the params catch up nothing runs either.
    expect(urlAction({ ...lagging, urlQ: "", urlThread: "T2" })).toEqual({ type: "none" });
  });

  it("opens a ?thread= once, and not when it is already active", () => {
    expect(urlAction({ ...base, urlThread: "T1" })).toEqual({ type: "openThread", id: "T1" });
    expect(urlAction({ ...base, urlThread: "T1", handledThread: "T1" })).toEqual({ type: "none" });
    expect(urlAction({ ...base, urlThread: "T1", activeThreadId: "T1" })).toEqual({ type: "none" });
    // a thread in the URL wins over a stale question
    expect(urlAction({ ...base, urlThread: "T1", urlQ: "old question" })).toEqual({ type: "openThread", id: "T1" });
  });

  it("stays idle before hydration and on the citation checker", () => {
    expect(urlAction({ ...base, hydrated: false, urlQ: "x" })).toEqual({ type: "none" });
    expect(urlAction({ ...base, tool: "citecheck", urlQ: "x", urlThread: "T" })).toEqual({ type: "none" });
  });

  it("builds URLs with the thread taking precedence over the question", () => {
    expect(searchUrl({})).toBe("/search");
    expect(searchUrl({ q: "a b" })).toBe("/search?q=a+b");
    expect(searchUrl({ q: "a", thread: "T" })).toBe("/search?thread=T");
    expect(searchUrl({ tool: "citecheck", thread: "T" })).toBe("/search?tool=citecheck");
  });
});
