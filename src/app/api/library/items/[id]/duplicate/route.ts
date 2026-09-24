import { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { duplicateItem } from "@/modules/library/service";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { parentId?: string | null };
  try {
    const item = duplicateItem(id, { parentId: body.parentId });
    return item ? Response.json({ item }, { status: 201 }) : jsonError("Not found", 404);
  } catch (e) { return jsonError((e as Error).message, 400); }
}
