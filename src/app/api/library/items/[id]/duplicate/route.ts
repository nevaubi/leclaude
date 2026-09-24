import { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { duplicateItem } from "@/modules/library/service";
import { withAuth } from "@/lib/auth/route";
import { refs } from "@/lib/auth/resources";

export const runtime = "nodejs";

async function handlePOST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { parentId?: string | null };
  try {
    const item = duplicateItem(id, { parentId: body.parentId });
    return item ? Response.json({ item }, { status: 201 }) : jsonError("Not found", 404);
  } catch (e) { return jsonError((e as Error).message, 400); }
}

export const POST = withAuth(handlePOST, { action: "write", resource: (_req, { id }) => refs.library(id) });
