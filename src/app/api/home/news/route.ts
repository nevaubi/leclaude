import { listNews, refreshNewsFromFederalRegister } from "@/modules/home/service";
import type { NewsItem, PracticeArea } from "@/lib/types/domain";
import { param } from "@/modules/home/api-utils";
import { withAuth } from "@/lib/auth/route";
import { queryParam } from "@/lib/auth/resources";

export const runtime = "nodejs";

async function handleGET(req: Request) {
  const url = new URL(req.url);
  let refresh: Awaited<ReturnType<typeof refreshNewsFromFederalRegister>> | undefined;
  if (url.searchParams.get("refresh") === "1") {
    try { refresh = await refreshNewsFromFederalRegister(); } catch (e) { refresh = { ok: false, added: 0, checked: 0, error: e instanceof Error ? e.message : "offline", fetchedAt: new Date().toISOString() }; }
  }
  const items = listNews({
    category: param(url, "category") as NewsItem["category"] | null,
    practiceArea: param(url, "practiceArea") as PracticeArea | null,
    matterId: param(url, "matter"),
    sort: (param(url, "sort") as "relevance" | "newest" | null) ?? "relevance",
    query: param(url, "q") ?? undefined,
    limit: Number(url.searchParams.get("limit") ?? 0) || undefined,
  });
  return Response.json({ items, refresh });
}

export const GET = withAuth(handleGET, { action: "read", resource: (req) => ({ kind: "news", matterId: queryParam(req, "matter") }) });
