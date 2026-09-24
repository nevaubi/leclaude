import { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { deleteItem, getItemDetail, updateItem } from "@/modules/library/service";
import type { UpdateItemInput } from "@/modules/library/types";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const detail = getItemDetail(id);
  return detail ? Response.json(detail) : jsonError("Not found", 404);
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as UpdateItemInput | null;
  if (!body) return jsonError("Invalid body");
  try {
    const item = updateItem(id, body);
    return item ? Response.json({ item }) : jsonError("Not found", 404);
  } catch (e) { return jsonError((e as Error).message, 400); }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const r = deleteItem(id);
    return r.deleted.length ? Response.json(r) : jsonError("Not found", 404);
  } catch (e) { return jsonError((e as Error).message, 400); }
}
