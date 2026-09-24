import { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { moveItems } from "@/modules/library/service";

export const runtime = "nodejs";

/** Move items into a folder (null = root). Rejects cycles, non-folder targets and system folders. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { ids?: string[]; parentId?: string | null } | null;
  if (!body || !Array.isArray(body.ids) || !body.ids.length) return jsonError("`ids` is required");
  try { return Response.json(moveItems(body.ids, body.parentId ?? null)); } catch (e) { return jsonError((e as Error).message, 400); }
}
