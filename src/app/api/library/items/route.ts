import { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { createItem, listItems } from "@/modules/library/service";
import type { CreateItemInput } from "@/modules/library/types";
import { parseFilters } from "@/modules/library/filters";

export const runtime = "nodejs";

/** List items for a folder or a virtual view (starred/recent/shared/all) with filters. Office documents without a library row are merged in. */
export async function GET(req: NextRequest) {
  try { return Response.json(listItems(parseFilters(req.nextUrl.searchParams))); } catch (e) { return jsonError((e as Error).message, 500); }
}

/** Create a folder, note, clause, link or template entry. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as CreateItemInput | null;
  if (!body || typeof body.name !== "string") return jsonError("`name` is required");
  if (!["folder", "note", "clause", "link", "template"].includes(body.type)) return jsonError("`type` must be folder | note | clause | link | template");
  try { return Response.json({ item: createItem(body) }, { status: 201 }); } catch (e) { return jsonError((e as Error).message, 400); }
}
